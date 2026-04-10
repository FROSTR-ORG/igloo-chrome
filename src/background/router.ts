import { isRecord } from '@/extension/protocol';
import { createOnboardingRouter } from '@/background/router-onboarding';
import { createProfilesRouter } from '@/background/router-profiles';
import { createProviderRouter } from '@/background/router-provider';
import { createRuntimeRouter } from '@/background/router-runtime';
import { createStateRouter } from '@/background/router-state';
import type { BackgroundCommandType, BackgroundHandlerMap, BackgroundRouterDependencies } from '@/background/router-types';

export function createBackgroundRouter(input: BackgroundRouterDependencies) {
  const handlers: BackgroundHandlerMap = {
    ...createStateRouter(input),
    ...createProviderRouter(input),
    ...createOnboardingRouter(input),
    ...createProfilesRouter(input),
    ...createRuntimeRouter(input),
  };

  return function handleMessage(
    message: unknown,
    _sender: unknown,
    sendResponse: (response?: unknown) => void
  ) {
    if (!isRecord(message) || typeof message.type !== 'string') return;
    const handler = handlers[message.type as BackgroundCommandType];
    if (!handler) return;
    return handler(message as never, sendResponse);
  };
}
