import {
  loadRuntimeDesiredActive,
  setRuntimeDesiredActive,
  updateActivationLifecycle,
} from '@/extension/storage';
import {
  ensureRuntime as ensureWorkerRuntime,
  getRuntimeStatusSnapshot,
  prepareSign as prepareWorkerSign,
  setRuntimeHostStatusListener,
  stopRuntime as stopWorkerRuntime,
} from '@/lib/extension-runtime-host';
import { createLogger } from '@/lib/observability';
import { activationFailure, activationStageForRuntime, profileKey, toErrorMessage } from '@/background/utils';
import type {
  RuntimeServiceResult,
  RuntimeBuild,
  RuntimeServiceDependencies,
  RuntimeEnsureResult,
  RuntimeReloadResult,
  RuntimeServiceState,
  RuntimeStartResult,
  RuntimeStatusUpdate,
  RuntimeStopResult,
} from '@/background/runtime-service/types';
import {
  RuntimeServiceError,
  asRuntimeServiceError,
  runtimeServiceError,
  runtimeServiceOk,
} from '@/background/runtime-service/types';

const logger = createLogger('igloo.background');

export function createRuntimeLifecycle(input: {
  state: RuntimeServiceState;
  buildRuntimeProfile: () => Promise<RuntimeBuild | null>;
  publishStateChanged: RuntimeServiceDependencies['publishStateChanged'];
}) {
  const { state, buildRuntimeProfile, publishStateChanged } = input;

  async function ensureRuntimeForBuiltProfile(built: RuntimeBuild, reason: string) {
    logger.info('runtime', 'ensure_begin', {
      reason,
      profile_id: built.profile.id,
      profile_key: profileKey(built.profile),
      restored: built.restored,
    });
    await updateActivationLifecycle(
      'restoring_runtime',
      'background',
      'restoring',
      {
        reason,
        profileId: built.profile.id,
        restoredFromSnapshot: built.restored,
      },
      {
        restoredFromSnapshot: built.restored,
        lastError: null,
      }
    ).catch(() => undefined);
    await ensureWorkerRuntime(
      built.runtimeProfile,
      built.localPayload.profile,
      built.sessionKeyB64
    );
    const runtimeStatus = await getRuntimeStatusSnapshot();
    await updateActivationLifecycle(
      activationStageForRuntime(runtimeStatus.runtime),
      'background',
      runtimeStatus.runtime,
      {
        reason,
        profileId: built.profile.id,
        restoredFromSnapshot: built.restored,
      },
      {
        restoredFromSnapshot: built.restored,
        lastError: null,
      }
    ).catch(() => undefined);
    void prepareWorkerSign()
      .then(() => publishStateChanged())
      .catch((error) => {
        logger.info('runtime', 'prepare_sign_warmup_skipped', {
          reason,
          profile_id: built.profile.id,
          error_message: toErrorMessage(error),
        });
      });
    logger.info('runtime', 'ensure_ok', {
      reason,
      profile_id: built.profile.id,
      profile_key: profileKey(built.profile),
      runtime: runtimeStatus.runtime,
      restored: built.restored,
    });
  }

  async function ensureConfiguredRuntime(reason: string): Promise<RuntimeServiceResult<RuntimeEnsureResult>> {
    if (state.ensuringConfiguredRuntime) {
      const pendingProfileId = state.ensuringProfileId;
      await state.ensuringConfiguredRuntime.catch(() => undefined);
      if (!(await loadRuntimeDesiredActive())) {
        return runtimeServiceOk({ ensured: true });
      }
      if (pendingProfileId) {
        const builtAfterWait = await buildRuntimeProfile();
        if (builtAfterWait?.profile.id === pendingProfileId) {
          return runtimeServiceOk({ ensured: true });
        }
      }
    }

    state.ensuringConfiguredRuntime = Promise.resolve()
      .then(async () => {
        const desiredActive = await loadRuntimeDesiredActive();
        if (!desiredActive) {
          await updateActivationLifecycle('idle', 'background', 'cold', {
            reason,
            desiredActive: false,
          }).catch(() => undefined);
          await publishStateChanged();
          return;
        }

        const built = await buildRuntimeProfile();
        if (!built) {
          throw new RuntimeServiceError('profile_missing', 'Selected profile is locked or missing.');
        }
        state.ensuringProfileId = built.profile.id;

        await ensureRuntimeForBuiltProfile(built, reason);
        await publishStateChanged();
      })
      .catch(async (error) => {
        const serviceError = asRuntimeServiceError(
          error,
          'runtime_restore_failed',
          'Failed to restore signer runtime'
        );
        const failure = activationFailure('runtime_restore_failed', serviceError.message);
        await setRuntimeDesiredActive(false).catch(() => undefined);
        await stopWorkerRuntime().catch(() => undefined);
        await updateActivationLifecycle(
          'failed',
          'background',
          'cold',
          {
            reason,
          },
          {
            lastError: failure,
            restoredFromSnapshot: false,
          }
        ).catch(() => undefined);
        logger.warn('runtime', 'ensure_failed', {
          reason,
          error_message: serviceError.message,
        });
        await publishStateChanged().catch(() => undefined);
        throw serviceError;
      })
      .finally(() => {
        state.ensuringConfiguredRuntime = null;
        state.ensuringProfileId = null;
      });

    try {
      await state.ensuringConfiguredRuntime;
      return runtimeServiceOk({ ensured: true });
    } catch (error) {
      return runtimeServiceError(
        asRuntimeServiceError(error, 'runtime_restore_failed', 'Failed to restore signer runtime')
          .code,
        asRuntimeServiceError(error, 'runtime_restore_failed', 'Failed to restore signer runtime')
          .message,
        { cause: error }
      );
    }
  }

  async function reloadConfiguredRuntime(reason: string): Promise<RuntimeServiceResult<RuntimeReloadResult>> {
    if (!(await loadRuntimeDesiredActive())) {
      return runtimeServiceOk({ reloaded: true });
    }
    await stopWorkerRuntime().catch(() => undefined);
    await updateActivationLifecycle('idle', 'background', 'cold', {
      reason,
    }).catch(() => undefined);
    const ensured = await ensureConfiguredRuntime(reason);
    if (!ensured.ok) {
      return ensured;
    }
    return runtimeServiceOk({ reloaded: true });
  }

  async function startRuntime(reason: string): Promise<RuntimeServiceResult<RuntimeStartResult>> {
    await setRuntimeDesiredActive(true);
    const ensured = await ensureConfiguredRuntime(reason);
    if (!ensured.ok) {
      return ensured;
    }
    return runtimeServiceOk({ started: true });
  }

  async function stopRuntime(reason = 'runtime_stop'): Promise<RuntimeServiceResult<RuntimeStopResult>> {
    try {
      await setRuntimeDesiredActive(false);
      await stopWorkerRuntime();
      await updateActivationLifecycle('idle', 'background', 'cold', {
        reason,
      }).catch(() => undefined);
      await publishStateChanged();
      return runtimeServiceOk({ stopped: true });
    } catch (error) {
      const serviceError = asRuntimeServiceError(
        error,
        'runtime_update_failed',
        'Failed to stop signer runtime'
      );
      return runtimeServiceError(serviceError.code, serviceError.message, { cause: serviceError.cause });
    }
  }

  async function syncRuntimeStatusUpdate(update: RuntimeStatusUpdate) {
    if (update.runtime !== 'cold') {
      await updateActivationLifecycle(
        activationStageForRuntime(update.runtime),
        'background',
        update.runtime
      ).catch(() => undefined);
    }
    await publishStateChanged().catch(() => undefined);
  }

  function attachStatusListener() {
    setRuntimeHostStatusListener((update) => {
      void syncRuntimeStatusUpdate(update);
    });
  }

  return {
    attachStatusListener,
    ensureConfiguredRuntime,
    ensureRuntimeForBuiltProfile,
    reloadConfiguredRuntime,
    startRuntime,
    stopRuntime,
    syncRuntimeStatusUpdate,
  };
}
