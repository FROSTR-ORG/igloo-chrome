import { getChromeApi } from '@/extension/chrome';
import { COMMAND_TYPE, DEBUG_COMMAND_TYPE } from '@/extension/protocol';
import {
  clearUnlockedProfileKeys,
  loadLifecycleHistory,
  loadLifecycleStatus,
  saveUnlockedProfileKey,
  setActiveProfileId,
} from '@/extension/storage';
import { decryptLocalProfileBlobWithPassword } from '@/lib/profile-blob';
import type { BackgroundHandlerMap, BackgroundRouterDependencies } from '@/background/router-types';
import { responseError, responseOk, UNKNOWN_RUNTIME_LIFECYCLE } from '@/background/utils';

export function createStateRouter(
  input: Pick<BackgroundRouterDependencies, 'profileService' | 'runtimeService' | 'stateProjector'>
): BackgroundHandlerMap {
  const { profileService, runtimeService, stateProjector } = input;
  const handlers: BackgroundHandlerMap = {
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
  };

  if (import.meta.env.IGLOO_CHROME_RELEASE !== '1') {
    handlers[DEBUG_COMMAND_TYPE.RELOAD] = (_message, sendResponse) => {
      sendResponse(responseOk(true));
      setTimeout(() => {
        try {
          getChromeApi()?.runtime?.reload?.();
        } catch {
          // Ignore reload failures in test control flow.
        }
      }, 0);
      return true;
    };
    handlers[DEBUG_COMMAND_TYPE.CLEAR_PROFILE_UNLOCKS] = (_message, sendResponse) => {
      void clearUnlockedProfileKeys()
        .then(() => stateProjector.publishStateChanged())
        .then(() => sendResponse(responseOk(true)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    };
    handlers[DEBUG_COMMAND_TYPE.SEED_PROFILE_UNLOCK] = (message, sendResponse) => {
      const profileId = typeof message.profileId === 'string' ? message.profileId.trim().toLowerCase() : '';
      const password = typeof message.password === 'string' ? message.password : '';
      if (!profileId || !password) {
        sendResponse(responseError(new Error('Invalid profile seed unlock payload')));
        return true;
      }
      void (async () => {
        const record = await profileService.loadStoredProfileRecord(profileId);
        if (!record) {
          throw new Error('Selected profile was not found.');
        }
        const unlocked = await decryptLocalProfileBlobWithPassword(record.blob, password);
        await saveUnlockedProfileKey(profileId, unlocked.sessionKey);
        await setActiveProfileId(profileId);
        await stateProjector.publishStateChanged();
        return true;
      })()
        .then((result) => sendResponse(responseOk(result)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    };
  }

  return handlers;
}
