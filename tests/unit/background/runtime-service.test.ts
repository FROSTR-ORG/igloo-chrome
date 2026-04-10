import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PROVIDER_METHOD } from '@/extension/protocol';

let desiredActive = false;
const {
  loadRuntimeDesiredActive,
  setRuntimeDesiredActive,
  updateActivationLifecycle,
  clearRuntimePeerPolicyOverrides,
  ensureRuntime,
  executeProviderMethod,
  getRuntimeDiagnosticsSnapshot,
  getRuntimeSnapshotDetails,
  getRuntimeStatusSnapshot,
  isRuntimeActive,
  prepareEcdh,
  prepareSign,
  readRuntimeConfig,
  refreshAllPeers,
  setRuntimeHostStatusListener,
  stopRuntime,
  updateRuntimeConfig,
  updateRuntimePeerPolicy,
  wipeRuntimeState,
} = vi.hoisted(() => ({
  loadRuntimeDesiredActive: vi.fn(async () => desiredActive),
  setRuntimeDesiredActive: vi.fn(async (value: boolean) => {
    desiredActive = value;
  }),
  updateActivationLifecycle: vi.fn(),
  clearRuntimePeerPolicyOverrides: vi.fn(),
  ensureRuntime: vi.fn(),
  executeProviderMethod: vi.fn(),
  getRuntimeDiagnosticsSnapshot: vi.fn(),
  getRuntimeSnapshotDetails: vi.fn(),
  getRuntimeStatusSnapshot: vi.fn(),
  isRuntimeActive: vi.fn(),
  prepareEcdh: vi.fn(),
  prepareSign: vi.fn(),
  readRuntimeConfig: vi.fn(),
  refreshAllPeers: vi.fn(),
  setRuntimeHostStatusListener: vi.fn(),
  stopRuntime: vi.fn(),
  updateRuntimeConfig: vi.fn(),
  updateRuntimePeerPolicy: vi.fn(),
  wipeRuntimeState: vi.fn(),
}));

vi.mock('@/extension/storage', () => ({
  loadRuntimeDesiredActive,
  setRuntimeDesiredActive,
  updateActivationLifecycle,
}));

vi.mock('@/lib/extension-runtime-host', () => ({
  clearRuntimePeerPolicyOverrides,
  ensureRuntime,
  executeProviderMethod,
  getRuntimeDiagnosticsSnapshot,
  getRuntimeSnapshotDetails,
  getRuntimeStatusSnapshot,
  isRuntimeActive,
  prepareEcdh,
  prepareSign,
  readRuntimeConfig,
  refreshAllPeers,
  setRuntimeHostStatusListener,
  stopRuntime,
  updateRuntimeConfig,
  updateRuntimePeerPolicy,
  wipeRuntimeState,
}));

import { createRuntimeService } from '@/background/runtime-service';

describe('runtime-service', () => {
  const activeProfile = {
    runtimeProfile: {
      id: 'profile-1',
      relays: ['ws://relay'],
      groupPublicKey: 'group-pubkey',
      signerSettings: { sign_timeout_secs: 45 },
      runtimeSnapshotJson: '{}',
    },
    payload: {
      profile: {
        profileId: 'profile-1',
      },
    },
    sessionKeyB64: 'session-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    desiredActive = false;
    updateActivationLifecycle.mockResolvedValue(undefined);
    ensureRuntime.mockResolvedValue(undefined);
    getRuntimeStatusSnapshot.mockResolvedValue({ runtime: 'ready', status: null });
    prepareSign.mockResolvedValue({ sign_ready: true });
    prepareEcdh.mockResolvedValue({ ecdh_ready: true });
    readRuntimeConfig.mockResolvedValue({ sign_timeout_secs: 60 });
    refreshAllPeers.mockResolvedValue(undefined);
    stopRuntime.mockResolvedValue(undefined);
    updateRuntimeConfig.mockResolvedValue({ sign_timeout_secs: 50 });
    updateRuntimePeerPolicy.mockResolvedValue({ peer_permission_states: [] });
    clearRuntimePeerPolicyOverrides.mockResolvedValue({ peer_permission_states: [] });
    wipeRuntimeState.mockResolvedValue(undefined);
    isRuntimeActive.mockReturnValue(true);
    getRuntimeDiagnosticsSnapshot.mockResolvedValue({ runtime: 'ready', runtimeStatus: {} });
    getRuntimeSnapshotDetails.mockResolvedValue({ snapshot: null, snapshotError: null, lifecycle: null });
  });

  test('starts a configured runtime and records the restore lifecycle', async () => {
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged,
    });

    const result = await service.startRuntime('runtime_start');

    expect(result).toEqual({
      ok: true,
      value: { started: true },
    });

    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(ensureRuntime).toHaveBeenCalledWith(
      activeProfile.runtimeProfile,
      activeProfile.payload.profile,
      activeProfile.sessionKeyB64
    );
    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'restoring_runtime',
      'background',
      'restoring',
      expect.objectContaining({ reason: 'runtime_start', profileId: 'profile-1' }),
      expect.objectContaining({ restoredFromSnapshot: true })
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('clears desired-active and records failure when runtime ensure fails', async () => {
    desiredActive = true;
    ensureRuntime.mockRejectedValue(new Error('runtime exploded'));
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
    });

    const result = await service.ensureConfiguredRuntime('runtime_start');

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'runtime_restore_failed',
        message: 'runtime exploded',
      }),
    });

    expect(setRuntimeDesiredActive).toHaveBeenLastCalledWith(false);
    expect(stopRuntime).toHaveBeenCalled();
    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'failed',
      'background',
      'cold',
      { reason: 'runtime_start' },
      expect.objectContaining({
        restoredFromSnapshot: false,
        lastError: expect.objectContaining({ code: 'runtime_restore_failed' }),
      })
    );
  });

  test('reads stored signer settings when the runtime is inactive', async () => {
    desiredActive = false;
    isRuntimeActive.mockReturnValue(false);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
    });

    const result = await service.readConfiguredRuntimeConfig();

    expect(result).toEqual({
      ok: true,
      value: { settings: expect.objectContaining({ sign_timeout_secs: 45 }) },
    });
    expect(readRuntimeConfig).not.toHaveBeenCalled();
  });

  test('prepares signing readiness and republishes state', async () => {
    desiredActive = false;
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged,
    });

    const result = await service.prepareRuntime('sign');

    expect(result).toEqual({
      ok: true,
      value: {
        runtime: 'ready',
        readiness: { sign_ready: true },
      },
    });
    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(prepareSign).toHaveBeenCalled();
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('does not boot the runtime when desired-active is false during ensure', async () => {
    desiredActive = false;
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged,
    });

    const result = await service.ensureConfiguredRuntime('startup_sync');

    expect(result).toEqual({
      ok: true,
      value: { ensured: true },
    });

    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'idle',
      'background',
      'cold',
      expect.objectContaining({ reason: 'startup_sync', desiredActive: false })
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('reload failure clears desired-active and records activation failure', async () => {
    desiredActive = true;
    stopRuntime.mockResolvedValue(undefined);
    ensureRuntime.mockRejectedValue(new Error('reload failed'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged,
    });

    const result = await service.reloadConfiguredRuntime('runtime_reload');

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'runtime_restore_failed',
        message: 'reload failed',
      }),
    });

    expect(stopRuntime).toHaveBeenCalled();
    expect(setRuntimeDesiredActive).toHaveBeenLastCalledWith(false);
    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'failed',
      'background',
      'cold',
      { reason: 'runtime_reload' },
      expect.objectContaining({
        lastError: expect.objectContaining({ code: 'runtime_restore_failed' }),
      })
    );
  });

  test('propagates runtime config update failures without publishing success state', async () => {
    desiredActive = true;
    updateRuntimeConfig.mockRejectedValue(new Error('config rejected'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged,
    });

    const result = await service.updateRuntimeConfig({ sign_timeout_secs: 10 });

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'runtime_update_failed',
        message: 'config rejected',
      }),
    });

    expect(publishStateChanged).not.toHaveBeenCalled();
  });

  test('fails ensure when the selected profile is locked or missing', async () => {
    desiredActive = true;
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(null),
      } as never,
      publishStateChanged,
    });

    const result = await service.ensureConfiguredRuntime('runtime_start');

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'profile_missing',
        message: 'Selected profile is locked or missing.',
      }),
    });

    expect(setRuntimeDesiredActive).toHaveBeenLastCalledWith(false);
    expect(stopRuntime).toHaveBeenCalled();
  });

  test('denies provider runtime access while desired-active is false', async () => {
    desiredActive = false;
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
    });

    const result = await service.executeProviderMethod({
      id: 'request-1',
      host: 'example.com',
      type: PROVIDER_METHOD.SIGN_EVENT,
      params: { event: { kind: 1 } },
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'runtime_stopped',
        message: 'Signer runtime is stopped. Start the signer and try again.',
      }),
    });

    expect(executeProviderMethod).not.toHaveBeenCalled();
  });

  test('rejects sign requests when the active profile is missing', async () => {
    desiredActive = true;
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(null),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
    });

    const result = await service.executeProviderMethod({
      id: 'request-2',
      host: 'example.com',
      type: PROVIDER_METHOD.SIGN_EVENT,
      params: { event: { kind: 1 } },
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'runtime_not_configured',
        message: 'Signer is not configured yet. Open the extension dashboard first.',
      }),
    });

    expect(executeProviderMethod).not.toHaveBeenCalled();
  });

  test('surfaces provider execution failures without publishing a false success state', async () => {
    desiredActive = true;
    executeProviderMethod.mockRejectedValue(new Error('remote signer rejected request'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged,
    });

    const result = await service.executeProviderMethod({
      id: 'request-3',
      host: 'example.com',
      type: PROVIDER_METHOD.SIGN_EVENT,
      params: { event: { kind: 1 } },
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'runtime_provider_failed',
        message: 'remote signer rejected request',
      }),
    });

    expect(publishStateChanged).not.toHaveBeenCalled();
  });

  test('does not publish success state when peer policy update fails', async () => {
    desiredActive = true;
    updateRuntimePeerPolicy.mockRejectedValue(new Error('policy rejected'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createRuntimeService({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(activeProfile),
      } as never,
      publishStateChanged,
    });

    const result = await service.updatePeerPolicy('peer-1', {
      direction: 'request',
      method: 'sign',
      value: 'allow',
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: 'runtime_peer_policy_failed',
        message: 'policy rejected',
      }),
    });

    expect(publishStateChanged).not.toHaveBeenCalled();
  });
});
