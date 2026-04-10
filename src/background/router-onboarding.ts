import { COMMAND_TYPE, isRecord, type PendingOnboardingProfile } from '@/extension/protocol';
import type { BackgroundHandlerMap, BackgroundRouterDependencies } from '@/background/router-types';
import { responseError, responseOk } from '@/background/utils';

export function createOnboardingRouter(
  input: Pick<BackgroundRouterDependencies, 'onboardingService'>
): BackgroundHandlerMap {
  const { onboardingService } = input;

  return {
    [COMMAND_TYPE.ONBOARDING_START]: (message, sendResponse) => {
      void onboardingService.startOnboarding(message)
        .then((result) => sendResponse(result.ok ? responseOk(result.value.pendingProfile) : responseError(result.error)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    },
    [COMMAND_TYPE.ONBOARDING_COMPLETE]: (message, sendResponse) => {
      const pendingProfile = isRecord(message.pendingProfile)
        ? (message.pendingProfile as PendingOnboardingProfile)
        : null;
      const label = typeof message.label === 'string' ? message.label.trim() : '';
      const password = typeof message.password === 'string' ? message.password : '';
      if (!pendingProfile || !label || !password) {
        sendResponse(responseError(new Error('Invalid onboarding completion payload')));
        return true;
      }
      void onboardingService.completeOnboarding(pendingProfile, label, password)
        .then((result) => sendResponse(result.ok ? responseOk(result.value.profile) : responseError(result.error)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    },
    [COMMAND_TYPE.ROTATION_COMPLETE]: (message, sendResponse) => {
      const pendingProfile = isRecord(message.pendingProfile)
        ? (message.pendingProfile as PendingOnboardingProfile)
        : null;
      const targetProfileId =
        typeof message.targetProfileId === 'string' ? message.targetProfileId.trim().toLowerCase() : '';
      if (!pendingProfile || !targetProfileId) {
        sendResponse(responseError(new Error('Invalid rotation onboarding payload')));
        return true;
      }
      void onboardingService.completeRotation(pendingProfile, targetProfileId)
        .then((result) => sendResponse(result.ok ? responseOk(result.value.profile) : responseError(result.error)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    },
  };
}
