import type { createOnboardingService } from '@/background/onboarding-service';
import type { createPermissionService } from '@/background/permission-service';
import type { createProfileService } from '@/background/profile-service';
import type { createRuntimeService } from '@/background/runtime-service';
import type { createStateProjector } from '@/background/state-projector';
import type { ExtensionCommandByType } from '@/extension/messages';

export type RuntimeService = ReturnType<typeof createRuntimeService>;
export type ProfileService = ReturnType<typeof createProfileService>;
export type StateProjector = ReturnType<typeof createStateProjector>;
export type PermissionService = ReturnType<typeof createPermissionService>;
export type OnboardingService = ReturnType<typeof createOnboardingService>;

export type BackgroundRouterDependencies = {
  onboardingService: OnboardingService;
  permissionService: PermissionService;
  profileService: ProfileService;
  runtimeService: RuntimeService;
  stateProjector: StateProjector;
};

export type BackgroundResponseSender = (response?: unknown) => void;

export type BackgroundCommandType = keyof ExtensionCommandByType;

export type BackgroundRouteHandler<K extends BackgroundCommandType = BackgroundCommandType> = (
  message: ExtensionCommandByType[K],
  sendResponse: BackgroundResponseSender
) => boolean | void;

export type BackgroundHandlerMap = Partial<{
  [K in BackgroundCommandType]: BackgroundRouteHandler<K>;
}>;

export type UnknownBackgroundRouteHandler = (
  message: Record<string, unknown>,
  sendResponse: (response?: unknown) => void
) => boolean | void;
