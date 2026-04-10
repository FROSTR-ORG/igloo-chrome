import { getChromeApi } from '@/extension/chrome';
import { COMMAND_TYPE, DEBUG_COMMAND_TYPE } from '@/extension/protocol';
import { loadLifecycleHistory, loadLifecycleStatus } from '@/extension/storage';
import type { BackgroundHandlerMap, BackgroundRouterDependencies } from '@/background/router-types';
import { responseError, responseOk, UNKNOWN_RUNTIME_LIFECYCLE } from '@/background/utils';

export function createStateRouter(
  input: Pick<BackgroundRouterDependencies, 'runtimeService' | 'stateProjector'>
): BackgroundHandlerMap {
  const { runtimeService, stateProjector } = input;

  return {
    [COMMAND_TYPE.STATE_GET]: (_message, sendResponse) => {
      void stateProjector.buildAppState()
        .then((result) => sendResponse(responseOk(result)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    },
    [COMMAND_TYPE.DIAGNOSTICS_GET]: (_message, sendResponse) => {
      void Promise.all([
        runtimeService.getDiagnostics(),
        loadLifecycleStatus(),
        loadLifecycleHistory(),
      ])
        .then(([result, lifecycle, lifecycleHistory]) =>
          sendResponse(
            responseOk({
              ...result.diagnostics,
              runtimeLifecycle: result.diagnostics.runtimeLifecycle ?? UNKNOWN_RUNTIME_LIFECYCLE,
              lifecycle,
              lifecycleHistory,
            })
          )
        )
        .catch((error) => sendResponse(responseError(error)));
      return true;
    },
    [COMMAND_TYPE.UI_OPEN_DASHBOARD]: (_message, sendResponse) => {
      const openOptionsPage = getChromeApi()?.runtime?.openOptionsPage;
      if (!openOptionsPage) {
        sendResponse(responseError(new Error('Options page is unavailable')));
        return true;
      }
      void openOptionsPage()
        .then(() => sendResponse(responseOk(true)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    },
    [DEBUG_COMMAND_TYPE.RELOAD]: (_message, sendResponse) => {
      sendResponse(responseOk(true));
      setTimeout(() => {
        try {
          getChromeApi()?.runtime?.reload?.();
        } catch {
          // Ignore reload failures in test control flow.
        }
      }, 0);
      return true;
    },
  };
}
