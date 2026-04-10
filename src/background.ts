import { getChromeApi } from '@/extension/chrome';
import { loadActiveProfileId, setRuntimeDesiredActive } from '@/extension/storage';
import { createLogger } from '@/lib/observability';
import { createOnboardingService } from '@/background/onboarding-service';
import { createPermissionService } from '@/background/permission-service';
import { createProfileService } from '@/background/profile-service';
import { createPromptRegistry } from '@/background/prompt-registry';
import { createBackgroundRouter } from '@/background/router';
import { createRuntimeService } from '@/background/runtime-service';
import { createStateProjector } from '@/background/state-projector';

const logger = createLogger('igloo.background');
const chromeApi = getChromeApi();

const promptRegistry = createPromptRegistry();
const profileService = createProfileService();
const stateProjector = createStateProjector({
  profileService,
  promptRegistry,
  getRuntimeStatusSnapshot: () => runtimeService.getRuntimeStatusSnapshot(),
});
const runtimeService = createRuntimeService({
  profileService,
  publishStateChanged: () => stateProjector.publishStateChanged(),
});
const permissionService = createPermissionService({
  promptRegistry,
  publishStateChanged: () => stateProjector.publishStateChanged(),
  executeProviderMethod: async (request) => {
    const result = await runtimeService.executeProviderMethod(request);
    if (!result.ok) {
      throw result.error;
    }
    return result.value.result;
  },
});
const onboardingService = createOnboardingService({
  profileService,
  publishStateChanged: () => stateProjector.publishStateChanged(),
  ensureConfiguredRuntime: async (reason) => {
    const result = await runtimeService.ensureConfiguredRuntime(reason);
    if (!result.ok) {
      throw result.error;
    }
  },
  setRuntimeDesiredActive,
  loadActiveProfileId,
  stopRuntime: async (reason) => {
    const result = await runtimeService.stopRuntime(reason);
    if (!result.ok) {
      throw result.error;
    }
  },
});
const handleMessage = createBackgroundRouter({
  onboardingService,
  permissionService,
  profileService,
  runtimeService,
  stateProjector,
});

runtimeService.attachStatusListener();

chromeApi?.runtime?.onInstalled?.addListener((details) => {
  logger.info('extension', 'installed', { reason: details.reason });
  if (details.reason === 'install') {
    void chromeApi.runtime?.openOptionsPage?.();
  }
  void stateProjector.publishStateChanged().catch(() => undefined);
});

chromeApi?.runtime?.onStartup?.addListener(() => {
  logger.info('extension', 'startup');
  void stateProjector.publishStateChanged().catch(() => undefined);
});

void stateProjector.publishStateChanged().catch(() => undefined);

chromeApi?.windows?.onRemoved?.addListener((windowId) => {
  void permissionService.handlePromptWindowRemoved(windowId);
});

chromeApi?.runtime?.onMessage?.addListener(handleMessage);
