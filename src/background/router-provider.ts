import { COMMAND_TYPE, isProviderMethod, isRecord, type PromptResponseMessage, type ProviderRequestEnvelope, type StoredPermissionPolicy } from '@/extension/protocol';
import type { BackgroundHandlerMap, BackgroundRouterDependencies } from '@/background/router-types';
import { responseError, responseOk } from '@/background/utils';

export function createProviderRouter(
  input: Pick<BackgroundRouterDependencies, 'permissionService'>
): BackgroundHandlerMap {
  const { permissionService } = input;

  return {
    [COMMAND_TYPE.PROVIDER_REQUEST]: (message, sendResponse) => {
      const request = message.request;
      if (!isRecord(request) || !isProviderMethod(request.type)) {
        sendResponse(responseError(new Error('Invalid provider request payload')));
        return true;
      }
      void permissionService.handleProviderRequest(request as ProviderRequestEnvelope)
        .then((result) => sendResponse(result.ok ? responseOk(result.value.result) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.PROMPTS_RESPOND]: (message, sendResponse) => {
      void permissionService.handlePromptResponse(message as PromptResponseMessage)
        .then((result) => sendResponse(result.ok ? responseOk(result.value.handled) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.PERMISSIONS_CLEAR_ALL]: (_message, sendResponse) => {
      void permissionService.clearAllPermissions()
        .then((result) => sendResponse(result.ok ? responseOk(result.value.cleared) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.PERMISSIONS_REVOKE]: (message, sendResponse) => {
      const policy = isRecord(message.policy) ? (message.policy as StoredPermissionPolicy) : null;
      if (!policy) {
        sendResponse(responseError(new Error('Invalid permission revoke payload')));
        return true;
      }
      void permissionService.revokePermission(policy)
        .then((result) => sendResponse(result.ok ? responseOk(result.value.revoked) : responseError(result.error)));
      return true;
    },
  };
}
