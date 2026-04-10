import {
  getRuntimeSnapshotDetails,
  getRuntimeStatusSnapshot,
} from '@/lib/extension-runtime-host';
import { isRuntimeActive } from '@/lib/extension-runtime-host';
import { createRuntimeAccess } from '@/background/runtime-service/access';
import { createRuntimeLifecycle } from '@/background/runtime-service/lifecycle';
import { createRuntimeMutations } from '@/background/runtime-service/mutations';
import { RuntimeServiceError } from '@/background/runtime-service/types';
import type {
  RuntimeEnsureResult,
  RuntimeServiceDependencies,
  RuntimeServiceResult,
  RuntimeServiceState,
} from '@/background/runtime-service/types';

export function createRuntimeService(input: RuntimeServiceDependencies) {
  const state: RuntimeServiceState = {
    ensuringConfiguredRuntime: null,
    ensuringProfileId: null,
  };

  let ensureConfiguredRuntimeImpl: ((reason: string) => Promise<RuntimeServiceResult<RuntimeEnsureResult>>) | null = null;
  const access = createRuntimeAccess({
    profileService: input.profileService,
    ensureConfiguredRuntime: async (reason) => {
      if (!ensureConfiguredRuntimeImpl) {
        throw new RuntimeServiceError('runtime_unavailable', 'Runtime lifecycle is not initialized.');
      }
      return await ensureConfiguredRuntimeImpl(reason);
    },
    isRuntimeActive,
  });

  const lifecycle = createRuntimeLifecycle({
    state,
    buildRuntimeProfile: access.buildRuntimeProfile,
    publishStateChanged: input.publishStateChanged,
  });
  ensureConfiguredRuntimeImpl = lifecycle.ensureConfiguredRuntime;

  const mutations = createRuntimeMutations({
    profileService: input.profileService,
    publishStateChanged: input.publishStateChanged,
    buildRuntimeProfile: access.buildRuntimeProfile,
    ensureDesiredRuntimeAccess: access.ensureDesiredRuntimeAccess,
    maybeEnsureDesiredRuntime: access.maybeEnsureDesiredRuntime,
  });

  return {
    attachStatusListener: lifecycle.attachStatusListener,
    buildRuntimeProfile: access.buildRuntimeProfile,
    clearPeerPolicyOverrides: mutations.clearPeerPolicyOverrides,
    ensureConfiguredRuntime: lifecycle.ensureConfiguredRuntime,
    ensureDesiredRuntimeAccess: access.ensureDesiredRuntimeAccess,
    executeProviderMethod: mutations.executeProviderMethod,
    getDiagnostics: mutations.getDiagnostics,
    getRuntimeSnapshotDetails,
    getRuntimeStatusSnapshot,
    maybeEnsureDesiredRuntime: access.maybeEnsureDesiredRuntime,
    readConfiguredRuntimeConfig: mutations.readConfiguredRuntimeConfig,
    refreshPeers: mutations.refreshPeers,
    reloadConfiguredRuntime: lifecycle.reloadConfiguredRuntime,
    startRuntime: lifecycle.startRuntime,
    stopRuntime: lifecycle.stopRuntime,
    updatePeerPolicy: mutations.updatePeerPolicy,
    updateRuntimeConfig: mutations.updateRuntimeConfig,
    prepareRuntime: mutations.prepareRuntime,
  };
}
