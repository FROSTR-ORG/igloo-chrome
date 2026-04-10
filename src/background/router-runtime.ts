import { COMMAND_TYPE, isRecord } from '@/extension/protocol';
import type { BackgroundHandlerMap, BackgroundRouterDependencies } from '@/background/router-types';
import { responseError, responseOk } from '@/background/utils';

export function createRuntimeRouter(
  input: Pick<BackgroundRouterDependencies, 'runtimeService'>
): BackgroundHandlerMap {
  const { runtimeService } = input;

  return {
    [COMMAND_TYPE.RUNTIME_CONFIG_GET]: (_message, sendResponse) => {
      void runtimeService.readConfiguredRuntimeConfig()
        .then((result) => sendResponse(result.ok ? responseOk(result.value.settings) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.RUNTIME_CONFIG_UPDATE]: (message, sendResponse) => {
      void runtimeService.updateRuntimeConfig(isRecord(message.settings) ? message.settings : {})
        .then((result) => sendResponse(result.ok ? responseOk(result.value.settings) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.RUNTIME_PEER_POLICY_UPDATE]: (message, sendResponse) => {
      const pubkey = typeof message.pubkey === 'string' ? message.pubkey.trim().toLowerCase() : '';
      const patch = isRecord(message.patch) ? message.patch : null;
      if (
        !pubkey ||
        !patch ||
        (patch.direction !== 'request' && patch.direction !== 'respond') ||
        !['ping', 'onboard', 'sign', 'ecdh'].includes(String(patch.method)) ||
        !['unset', 'allow', 'deny'].includes(String(patch.value))
      ) {
        sendResponse(responseError(new Error('Invalid runtime peer policy update payload')));
        return true;
      }
      void runtimeService.updatePeerPolicy(pubkey, {
        direction: patch.direction,
        method: patch.method,
        value: patch.value,
      })
        .then((result) =>
          sendResponse(result.ok ? responseOk(result.value.peerPermissionStates) : responseError(result.error))
        );
      return true;
    },
    [COMMAND_TYPE.RUNTIME_PEER_POLICY_CLEAR_OVERRIDES]: (_message, sendResponse) => {
      void runtimeService.clearPeerPolicyOverrides()
        .then((result) =>
          sendResponse(result.ok ? responseOk(result.value.peerPermissionStates) : responseError(result.error))
        );
      return true;
    },
    [COMMAND_TYPE.RUNTIME_START]: (_message, sendResponse) => {
      void runtimeService.startRuntime('runtime_start')
        .then((result) => sendResponse(result.ok ? responseOk(result.value.started) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.RUNTIME_STOP]: (_message, sendResponse) => {
      void runtimeService.stopRuntime()
        .then((result) => sendResponse(result.ok ? responseOk(result.value.stopped) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.RUNTIME_RELOAD]: (_message, sendResponse) => {
      void runtimeService.reloadConfiguredRuntime('runtime_reload')
        .then((result) => sendResponse(result.ok ? responseOk(result.value.reloaded) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.RUNTIME_REFRESH_PEERS]: (_message, sendResponse) => {
      void runtimeService.refreshPeers()
        .then((result) => sendResponse(result.ok ? responseOk(result.value.refreshed) : responseError(result.error)));
      return true;
    },
    [COMMAND_TYPE.RUNTIME_PREPARE]: (message, sendResponse) => {
      const operation = message.operation === 'sign' || message.operation === 'ecdh' ? message.operation : null;
      if (!operation) {
        sendResponse(responseError(new Error('Invalid runtime prepare payload')));
        return true;
      }
      void runtimeService.prepareRuntime(operation)
        .then((result) => sendResponse(result.ok ? responseOk(result.value) : responseError(result.error)));
      return true;
    },
  };
}
