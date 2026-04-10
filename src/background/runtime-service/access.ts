import { loadRuntimeDesiredActive } from '@/extension/storage';
import {
  RuntimeServiceError,
  type RuntimeBuild,
  type RuntimeEnsureResult,
  type RuntimeServiceDependencies,
  type RuntimeServiceResult,
} from '@/background/runtime-service/types';

export function createRuntimeAccess(input: {
  profileService: RuntimeServiceDependencies['profileService'];
  ensureConfiguredRuntime: (reason: string) => Promise<RuntimeServiceResult<RuntimeEnsureResult>>;
  isRuntimeActive: () => boolean;
}) {
  const { profileService, ensureConfiguredRuntime, isRuntimeActive } = input;

  async function buildRuntimeProfile(): Promise<RuntimeBuild | null> {
    const activeProfile = await profileService.loadActiveRuntimeProfile();
    if (!activeProfile?.runtimeProfile || !activeProfile.payload) {
      return null;
    }
    return {
      profile: activeProfile.runtimeProfile,
      runtimeProfile: activeProfile.runtimeProfile,
      localPayload: activeProfile.payload,
      sessionKeyB64: activeProfile.sessionKeyB64!,
      restored:
        typeof activeProfile.runtimeProfile.runtimeSnapshotJson === 'string' &&
        activeProfile.runtimeProfile.runtimeSnapshotJson.trim().length > 0,
    };
  }

  async function maybeEnsureDesiredRuntime(reason: string) {
    if (!(await loadRuntimeDesiredActive()) || isRuntimeActive()) {
      return;
    }
    const result = await ensureConfiguredRuntime(reason);
    if (!result.ok) {
      throw result.error;
    }
  }

  async function ensureDesiredRuntimeAccess(reason: string) {
    if (!(await loadRuntimeDesiredActive())) {
      throw new RuntimeServiceError(
        'runtime_stopped',
        'Signer runtime is stopped. Start the signer and try again.'
      );
    }
    await maybeEnsureDesiredRuntime(reason);
    if (!isRuntimeActive()) {
      throw new RuntimeServiceError('runtime_unavailable', 'Signer runtime is unavailable.');
    }
  }

  return {
    buildRuntimeProfile,
    ensureDesiredRuntimeAccess,
    maybeEnsureDesiredRuntime,
  };
}
