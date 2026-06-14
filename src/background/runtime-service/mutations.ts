import { PROVIDER_METHOD, type ProviderRequestEnvelope } from '@/extension/protocol';
import { setRuntimeDesiredActive } from '@/extension/storage';
import { normalizeSignerSettings, type SignerSettings } from '@/lib/signer-settings';
import {
  clearRuntimePeerPolicyOverrides,
  executeProviderMethod as executeRuntimeProviderMethod,
  getRuntimeDiagnosticsSnapshot,
  getRuntimeStatusSnapshot,
  isRuntimeActive,
  prepareEcdh as prepareWorkerEcdh,
  prepareSign as prepareWorkerSign,
  readRuntimeConfig,
  refreshAllPeers,
  resolveRuntimeApproval,
  updateRuntimeConfig as updateWorkerRuntimeConfig,
  updateRuntimePeerPolicy,
} from '@/lib/extension-runtime-host';
import { createLogger } from '@/lib/observability';
import type {
  RuntimeServiceResult,
  RuntimeBuild,
  RuntimeConfigResult,
  RuntimeDiagnosticsEnvelope,
  RuntimeServiceDependencies,
  RuntimePeerPolicyResult,
  RuntimePrepareResult,
  RuntimeProviderExecutionResult,
  RuntimeRefreshPeersResult,
} from '@/background/runtime-service/types';
import {
  RuntimeServiceError,
  asRuntimeServiceError,
  runtimeServiceError,
  runtimeServiceOk,
} from '@/background/runtime-service/types';

const logger = createLogger('igloo.background');

export function createRuntimeMutations(input: {
  profileService: RuntimeServiceDependencies['profileService'];
  publishStateChanged: RuntimeServiceDependencies['publishStateChanged'];
  buildRuntimeProfile: () => Promise<RuntimeBuild | null>;
  ensureDesiredRuntimeAccess: (reason: string) => Promise<void>;
  maybeEnsureDesiredRuntime: (reason: string) => Promise<void>;
}) {
  const {
    profileService,
    publishStateChanged,
    buildRuntimeProfile,
    ensureDesiredRuntimeAccess,
    maybeEnsureDesiredRuntime,
  } = input;

  async function executeProviderMethod(
    request: ProviderRequestEnvelope
  ): Promise<RuntimeServiceResult<RuntimeProviderExecutionResult>> {
    logger.info('provider', 'request_execute', {
      request_id: request.id,
      method: request.type,
      host: request.host,
    });
    const built = await buildRuntimeProfile();
    if (!built) {
      return runtimeServiceError(
        'runtime_not_configured',
        'Signer is not configured yet. Open the extension dashboard first.'
      );
    }

    try {
      switch (request.type) {
        case PROVIDER_METHOD.GET_PUBLIC_KEY: {
          const publicKey =
            built.profile.groupPublicKey ??
            built.profile.publicKey ??
            built.profile.sharePublicKey ??
            null;
          if (!publicKey) {
            return runtimeServiceError(
              'missing_public_key',
              'Signer is configured without a public key'
            );
          }
          return runtimeServiceOk({ result: publicKey });
        }
        case PROVIDER_METHOD.GET_RELAYS:
          return runtimeServiceOk({
            result: Object.fromEntries(
              built.profile.relays.map((relay) => [relay, { read: true, write: true }])
            ),
          });
        default:
          await ensureDesiredRuntimeAccess('provider_request');
          return runtimeServiceOk({
            result: await executeRuntimeProviderMethod({
              profile: built.runtimeProfile,
              profilePayload: built.localPayload.profile,
              sessionKeyB64: built.sessionKeyB64,
              method: request.type,
              params: request.params ?? {},
            }),
          });
      }
    } catch (error) {
      const serviceError =
        error instanceof RuntimeServiceError
          ? error
          : asRuntimeServiceError(error, 'runtime_provider_failed', 'Provider request failed');
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function readConfiguredRuntimeConfig(): Promise<RuntimeServiceResult<RuntimeConfigResult>> {
    try {
      const profile = (await profileService.loadActiveRuntimeProfile())?.runtimeProfile ?? null;
      await maybeEnsureDesiredRuntime('read_runtime_config').catch(() => undefined);
      if (isRuntimeActive()) {
        return runtimeServiceOk({ settings: await readRuntimeConfig() });
      }
      return runtimeServiceOk({ settings: normalizeSignerSettings(profile?.signerSettings) });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_config_failed',
        'Failed to read signer settings'
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function refreshPeers(): Promise<RuntimeServiceResult<RuntimeRefreshPeersResult>> {
    try {
      await ensureDesiredRuntimeAccess('refresh_all_peers');
      await refreshAllPeers();
      await publishStateChanged();
      return runtimeServiceOk({ refreshed: true });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_refresh_failed',
        'Failed to refresh signer peers'
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function prepareRuntime(
    operation: 'sign' | 'ecdh'
  ): Promise<RuntimeServiceResult<RuntimePrepareResult>> {
    try {
      await setRuntimeDesiredActive(true);
      await ensureDesiredRuntimeAccess(operation === 'sign' ? 'prepare_sign' : 'prepare_ecdh');
      const result = operation === 'sign' ? await prepareWorkerSign() : await prepareWorkerEcdh();
      await publishStateChanged();
      const runtimeStatus = await getRuntimeStatusSnapshot();
      return runtimeServiceOk({
        runtime: runtimeStatus.runtime,
        readiness: result,
      });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_prepare_failed',
        `Failed to prepare signer runtime for ${operation}`
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function updateRuntimeConfig(
    settings: Partial<SignerSettings>
  ): Promise<RuntimeServiceResult<RuntimeConfigResult>> {
    try {
      await ensureDesiredRuntimeAccess('update_runtime_config');
      return runtimeServiceOk({ settings: await updateWorkerRuntimeConfig(settings) });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_update_failed',
        'Failed to update signer settings'
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function updatePeerPolicy(
    pubkey: string,
    patch: { direction: 'request' | 'respond'; method: 'ping' | 'onboard' | 'sign' | 'ecdh'; value: 'unset' | 'allow' | 'deny' | 'ask' }
  ): Promise<RuntimeServiceResult<RuntimePeerPolicyResult>> {
    try {
      await ensureDesiredRuntimeAccess('update_runtime_peer_policy');
      const status = await updateRuntimePeerPolicy(pubkey, patch);
      await publishStateChanged();
      return runtimeServiceOk({
        peerPermissionStates: status?.peer_permission_states ?? [],
      });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_peer_policy_failed',
        'Failed to update runtime peer policy'
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function clearPeerPolicyOverrides(): Promise<RuntimeServiceResult<RuntimePeerPolicyResult>> {
    try {
      await ensureDesiredRuntimeAccess('clear_runtime_peer_policy_overrides');
      const status = await clearRuntimePeerPolicyOverrides();
      await publishStateChanged();
      return runtimeServiceOk({
        peerPermissionStates: status?.peer_permission_states ?? [],
      });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_peer_policy_failed',
        'Failed to clear runtime peer policy overrides'
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function resolveApproval(
    requestId: string,
    approved: boolean
  ): Promise<RuntimeServiceResult<{ resolved: boolean }>> {
    try {
      await ensureDesiredRuntimeAccess('resolve_runtime_approval');
      await resolveRuntimeApproval(requestId, approved);
      await publishStateChanged();
      return runtimeServiceOk({ resolved: true });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_resolve_approval_failed',
        'Failed to resolve approval request'
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function getDiagnostics(): Promise<RuntimeDiagnosticsEnvelope> {
    return {
      diagnostics: await getRuntimeDiagnosticsSnapshot(),
    };
  }

  return {
    clearPeerPolicyOverrides,
    executeProviderMethod,
    getDiagnostics,
    readConfiguredRuntimeConfig,
    refreshPeers,
    prepareRuntime,
    resolveApproval,
    updatePeerPolicy,
    updateRuntimeConfig,
  };
}
