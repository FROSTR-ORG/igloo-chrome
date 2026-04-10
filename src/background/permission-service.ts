import { getChromeApi } from '@/extension/chrome';
import {
  getPermissionLabel,
  PROMPT_DOCUMENT_PATH,
  PROMPT_HEIGHT,
  PROMPT_WIDTH,
  type PromptResponseMessage,
  type ProviderRequestEnvelope,
} from '@/extension/protocol';
import {
  clearPermissionPolicies as clearStoredPermissionPolicies,
  removePermissionPolicy,
  resolvePermissionDecision,
  savePermissionDecision,
} from '@/extension/storage';
import type { StoredPermissionPolicy } from '@/extension/protocol';
import { createLogger } from '@/lib/observability';
import type { createPromptRegistry } from '@/background/prompt-registry';
import { serviceError, serviceOk, toErrorMessage, type ServiceResult } from '@/background/utils';

const logger = createLogger('igloo.background');

type PromptRegistry = ReturnType<typeof createPromptRegistry>;

export type ProviderPermissionPayload = {
  result: unknown;
};

export type ProviderPermissionResult = ServiceResult<
  ProviderPermissionPayload,
  PermissionServiceError
>;

export type PromptResponsePayload = {
  handled: boolean;
};

export type PromptResponseResult = ServiceResult<PromptResponsePayload, PermissionServiceError>;

export type PromptWindowRemovalPayload = {
  closed: boolean;
};

export type PromptWindowRemovalResult = ServiceResult<
  PromptWindowRemovalPayload,
  PermissionServiceError
>;

export type PermissionClearPayload = {
  cleared: true;
};

export type PermissionClearResult = ServiceResult<PermissionClearPayload, PermissionServiceError>;

export type PermissionRevokePayload = {
  revoked: true;
};

export type PermissionRevokeResult = ServiceResult<
  PermissionRevokePayload,
  PermissionServiceError
>;

export type PermissionServiceErrorCode =
  | 'prompt_unavailable'
  | 'prompt_create_failed'
  | 'prompt_response_failed'
  | 'permissions_clear_failed'
  | 'permission_revoke_failed'
  | 'request_denied'
  | 'runtime_execution_failed';

export class PermissionServiceError extends Error {
  readonly code: PermissionServiceErrorCode;
  readonly cause?: unknown;

  constructor(code: PermissionServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PermissionServiceError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export function createPermissionService(input: {
  promptRegistry: PromptRegistry;
  publishStateChanged: () => Promise<unknown>;
  executeProviderMethod: (request: ProviderRequestEnvelope) => Promise<unknown>;
}) {
  const { promptRegistry, publishStateChanged, executeProviderMethod } = input;

  async function requestPermission(request: ProviderRequestEnvelope) {
    const chromeApi = getChromeApi();
    const createWindow = chromeApi?.windows?.create;
    const getRuntimeUrl = chromeApi?.runtime?.getURL;
    if (!createWindow || !getRuntimeUrl) {
      throw new PermissionServiceError(
        'prompt_unavailable',
        'Permission prompt is unavailable in this runtime'
      );
    }

    const query = new URLSearchParams({
      id: request.id,
      host: request.host,
      type: request.type,
      label: getPermissionLabel(request.type),
      params: JSON.stringify(request.params ?? {}),
    });

    return await new Promise<boolean>(async (resolve, reject) => {
      logger.info('permission', 'prompt_open', {
        request_id: request.id,
        method: request.type,
        host: request.host,
      });
      promptRegistry.set(request.id, { request, resolve });
      void publishStateChanged();
      try {
        const created = await createWindow({
          url: `${getRuntimeUrl(PROMPT_DOCUMENT_PATH)}?${query.toString()}`,
          type: 'popup',
          width: PROMPT_WIDTH,
          height: PROMPT_HEIGHT,
        });
        const pending = promptRegistry.get(request.id);
        if (!pending) {
          reject(new Error('Permission request was cancelled'));
          return;
        }
        if (typeof created.id === 'number') {
          promptRegistry.setWindowId(request.id, created.id);
        }
      } catch (error) {
        promptRegistry.delete(request.id);
        void publishStateChanged();
        reject(
          new PermissionServiceError(
            'prompt_create_failed',
            toErrorMessage(error, 'Failed to open permission prompt'),
            { cause: error }
          )
        );
      }
    });
  }

  async function ensurePermission(request: ProviderRequestEnvelope) {
    const existing = await resolvePermissionDecision(request.host, request.type, request.params);
    if (existing !== null) return existing;
    return await requestPermission(request);
  }

  async function handleProviderRequest(request: ProviderRequestEnvelope): Promise<ProviderPermissionResult> {
    try {
      const allowed = await ensurePermission(request);
      if (!allowed) {
        logger.warn('permission', 'request_denied', {
          request_id: request.id,
          method: request.type,
          host: request.host,
        });
        return serviceError(new PermissionServiceError('request_denied', 'User denied the request'));
      }
      logger.info('permission', 'request_allowed', {
        request_id: request.id,
        method: request.type,
        host: request.host,
      });
      return serviceOk({
        result: await executeProviderMethod(request),
      });
    } catch (error) {
      if (error instanceof PermissionServiceError) {
        return serviceError(error);
      }
      return serviceError(
        new PermissionServiceError(
          'runtime_execution_failed',
          toErrorMessage(error, 'Provider request failed'),
          { cause: error }
        )
      );
    }
  }

  async function handlePromptResponse(message: PromptResponseMessage): Promise<PromptResponseResult> {
    try {
      const chromeApi = getChromeApi();
      const pending = promptRegistry.delete(message.id);
      if (!pending) return serviceOk({ handled: false });

      void publishStateChanged();

      if (message.scope !== 'once') {
        await savePermissionDecision(
          pending.request.host,
          pending.request.type,
          message.allow,
          pending.request.params,
          message.scope
        );
        void publishStateChanged();
      }

      pending.resolve(message.allow);
      logger.info('permission', 'prompt_resolved', {
        request_id: message.id,
        scope: message.scope,
        allow: message.allow,
      });

      if (typeof pending.windowId === 'number' && chromeApi?.windows?.remove) {
        try {
          await chromeApi.windows.remove(pending.windowId);
        } catch {
          // Ignore user-closed prompt windows.
        }
      }
      return serviceOk({ handled: true });
    } catch (error) {
      return serviceError(
        new PermissionServiceError(
          'prompt_response_failed',
          toErrorMessage(error, 'Failed to resolve permission prompt'),
          { cause: error }
        )
      );
    }
  }

  async function handlePromptWindowRemoved(windowId: number): Promise<PromptWindowRemovalResult> {
    const pending = promptRegistry.deleteByWindowId(windowId);
    if (!pending) {
      return serviceOk({ closed: false });
    }
    void publishStateChanged();
    logger.warn('permission', 'prompt_window_closed', {
      request_id: pending.request.id,
      window_id: windowId,
    });
    pending.resolve(false);
    return serviceOk({ closed: true });
  }

  async function clearAllPermissions(): Promise<PermissionClearResult> {
    try {
      await clearStoredPermissionPolicies();
      await publishStateChanged();
      return serviceOk({ cleared: true });
    } catch (error) {
      return serviceError(
        new PermissionServiceError(
          'permissions_clear_failed',
          toErrorMessage(error, 'Failed to clear permission policies'),
          { cause: error }
        )
      );
    }
  }

  async function revokePermission(policy: StoredPermissionPolicy): Promise<PermissionRevokeResult> {
    try {
      await removePermissionPolicy(policy);
      await publishStateChanged();
      return serviceOk({ revoked: true });
    } catch (error) {
      return serviceError(
        new PermissionServiceError(
          'permission_revoke_failed',
          toErrorMessage(error, 'Failed to revoke permission policy'),
          { cause: error }
        )
      );
    }
  }

  return {
    clearAllPermissions,
    handlePromptResponse,
    handlePromptWindowRemoved,
    handleProviderRequest,
    revokePermission,
  };
}
