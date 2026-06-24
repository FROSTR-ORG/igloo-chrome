import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { updateActivationLifecycle, updateOnboardingLifecycle } = vi.hoisted(() => ({
  updateActivationLifecycle: vi.fn(),
  updateOnboardingLifecycle: vi.fn(),
}));

vi.mock('@/extension/storage', () => ({
  updateActivationLifecycle,
  updateOnboardingLifecycle,
}));

vi.mock('@/lib/extension-runtime-host', () => ({
  captureOnboardingProfile: vi.fn(),
}));

import { createOnboardingService } from '@/background/onboarding-service';
import { publicKeyFromSecret, setInjectedWasmProfileModuleForTests } from '@/lib/igloo';

const sessionKey = {} as CryptoKey;

function makeProfilePayload(overrides: Partial<{
  profileId: string;
  device: Partial<{
    name: string;
    shareSecret: string;
    manualPeerPolicyOverrides: [];
    relays: string[];
  }>;
  groupPackage: Partial<{
    groupPk: string;
    groupName: string;
    threshold: number;
    members: Array<{ idx: number; pubkey: string }>;
  }>;
}> = {}) {
  const shareSecret = overrides.device?.shareSecret ?? '11'.repeat(32);
  return {
    profileId: overrides.profileId ?? 'profile-1',
    version: 1,
    device: {
      name: 'Device 1',
      shareSecret,
      manualPeerPolicyOverrides: [],
      relays: ['ws://relay.test'],
      ...overrides.device,
    },
    groupPackage: {
      groupPk: '22'.repeat(32),
      groupName: 'Group 1',
      threshold: 1,
      members: [{ idx: 1, pubkey: `02${publicKeyFromSecret(shareSecret)}` }],
      ...overrides.groupPackage,
    },
  };
}

function createInjectedProfileModule() {
  const payload = makeProfilePayload();
  return {
    bf_package_version: () => 1,
    bfshare_prefix: () => 'bfshare1',
    bfonboard_prefix: () => 'bfonboard1',
    bfprofile_prefix: () => 'bfprofile1',
    encode_bfshare_package: () => 'bfshare1encoded',
    decode_bfshare_package: () =>
      JSON.stringify({
        shareSecret: payload.device.shareSecret,
        relays: payload.device.relays,
      }),
    encode_bfonboard_package: () => 'bfonboard1encoded',
    decode_bfonboard_package: () =>
      JSON.stringify({
        shareSecret: payload.device.shareSecret,
        relays: payload.device.relays,
        peerPubkey: 'aa'.repeat(32),
      }),
    derive_profile_id_from_share_secret: () => payload.profileId,
    derive_profile_id_from_share_pubkey: () => payload.profileId,
    encode_bfprofile_package: () => 'bfprofile1encoded',
    decode_bfprofile_package: () => JSON.stringify(payload),
    create_profile_package_pair: () =>
      JSON.stringify({
        profileString: 'bfprofile1-onboarded',
        shareString: 'bfshare1-onboarded',
      }),
  };
}

describe('onboarding-service real shared save seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateActivationLifecycle.mockResolvedValue(undefined);
    updateOnboardingLifecycle.mockResolvedValue(undefined);
    setInjectedWasmProfileModuleForTests(createInjectedProfileModule() as never);
  });

  afterEach(() => {
    setInjectedWasmProfileModuleForTests(null);
  });

  test('persists and activates onboarding through the real shared save helper', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockImplementation(async (storedPayload) => ({
      runtimeProfile: {
        id: storedPayload.profile.profileId,
        label: storedPayload.profile.device.name,
      },
    }));
    const setRuntimeDesiredActive = vi.fn().mockResolvedValue(undefined);
    const ensureConfiguredRuntime = vi.fn().mockResolvedValue(undefined);
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createOnboardingService({
      profileService: {
        storeProfileBlobAndUnlock,
      } as never,
      publishStateChanged,
      ensureConfiguredRuntime,
      setRuntimeDesiredActive,
      loadActiveProfileId: vi.fn(),
    });

    const result = await service.completeOnboarding(
      {
        profilePayload: makeProfilePayload({
          profileId: 'profile-2',
          device: { name: 'Original Device' },
        }),
        relays: ['ws://relay.test'],
        signerSettings: { sign_timeout_secs: 30 },
        runtimeSnapshotJson: '{"snapshot":true}',
        peerPubkey: 'aa'.repeat(32),
      } as never,
      'Saved Device',
      'secret',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        profile: {
          id: 'profile-2',
          label: 'Saved Device',
        },
      },
    });
    expect(storeProfileBlobAndUnlock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          profileId: 'profile-2',
          device: expect.objectContaining({
            name: 'Saved Device',
            relays: ['ws://relay.test'],
          }),
        }),
        signerSettings: expect.objectContaining({ sign_timeout_secs: 30 }),
        peerPubkey: 'aa'.repeat(32),
        runtimeSnapshotJson: '{"snapshot":true}',
      }),
      'secret',
    );
    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(ensureConfiguredRuntime).toHaveBeenCalledWith('complete_onboarding');
    expect(updateOnboardingLifecycle).toHaveBeenNthCalledWith(
      1,
      'profile_persisted',
      'background',
      expect.objectContaining({ profileId: 'profile-2' }),
    );
    expect(updateOnboardingLifecycle).toHaveBeenNthCalledWith(
      2,
      'idle',
      'background',
      { profileId: 'profile-2' },
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('keeps onboarding successful when runtime activation is unavailable through the real shared save helper', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockImplementation(async (storedPayload) => ({
      runtimeProfile: {
        id: storedPayload.profile.profileId,
        label: storedPayload.profile.device.name,
      },
    }));
    const setRuntimeDesiredActive = vi.fn().mockResolvedValue(undefined);
    const ensureConfiguredRuntime = vi.fn().mockRejectedValue(new Error('runtime failed'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createOnboardingService({
      profileService: {
        storeProfileBlobAndUnlock,
      } as never,
      publishStateChanged,
      ensureConfiguredRuntime,
      setRuntimeDesiredActive,
      loadActiveProfileId: vi.fn(),
    });

    const result = await service.completeOnboarding(
      {
        profilePayload: makeProfilePayload({
          profileId: 'profile-3',
          device: { name: 'Original Device' },
        }),
        relays: ['ws://relay.test'],
        signerSettings: { sign_timeout_secs: 30 },
        runtimeSnapshotJson: '{"snapshot":true}',
        peerPubkey: 'bb'.repeat(32),
      } as never,
      'Saved Device',
      'secret',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        profile: {
          id: 'profile-3',
          label: 'Saved Device',
        },
      },
    });
    expect(storeProfileBlobAndUnlock).toHaveBeenCalledTimes(1);
    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'degraded',
      'background',
      'cold',
      expect.objectContaining({
        reason: 'complete_onboarding',
        profileId: 'profile-3',
      }),
      expect.objectContaining({
        lastError: expect.objectContaining({
          code: 'runtime_unavailable',
        }),
      }),
    );
    expect(updateOnboardingLifecycle).toHaveBeenNthCalledWith(
      1,
      'profile_persisted',
      'background',
      expect.objectContaining({ profileId: 'profile-3' }),
    );
    expect(updateOnboardingLifecycle).toHaveBeenNthCalledWith(
      2,
      'idle',
      'background',
      { profileId: 'profile-3' },
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('replaces the active profile during rotation through the real shared save helper', async () => {
    const records = new Map([
      ['profile-1', { id: 'profile-1', label: 'Original Device' }],
    ]);
    let activeProfileId: string | null = 'profile-1';
    const replaceStoredProfileBlob = vi.fn().mockImplementation(
      async ({ targetProfileId, nextPayload }) => {
        records.delete(targetProfileId);
        records.set(nextPayload.profile.profileId, {
          id: nextPayload.profile.profileId,
          label: nextPayload.profile.device.name,
        });
        activeProfileId = nextPayload.profile.profileId;
        return {
          id: nextPayload.profile.profileId,
          label: nextPayload.profile.device.name,
          groupName: nextPayload.profile.groupPackage.groupName,
          relays: nextPayload.profile.device.relays,
          groupPublicKey: nextPayload.profile.groupPackage.groupPk,
          publicKey: nextPayload.profile.groupPackage.groupPk,
          sharePublicKey: publicKeyFromSecret(nextPayload.profile.device.shareSecret),
          peerPubkey: nextPayload.peerPubkey ?? undefined,
          signerSettings: nextPayload.signerSettings,
          runtimeSnapshotJson: nextPayload.runtimeSnapshotJson ?? undefined,
        };
      },
    );
    const ensureConfiguredRuntime = vi.fn().mockResolvedValue(undefined);
    const setRuntimeDesiredActive = vi.fn().mockResolvedValue(undefined);
    const stopRuntime = vi.fn().mockResolvedValue(undefined);
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createOnboardingService({
      profileService: {
        loadProfileForReplacement: vi.fn().mockResolvedValue({
          record: { id: 'profile-1', label: 'Original Device', blob: { version: 1 }, createdAt: 1, updatedAt: 2 },
          payload: {
            profile: makeProfilePayload({
              profileId: 'profile-1',
              device: { name: 'Original Device' },
            }),
            signerSettings: { sign_timeout_secs: 30 },
            runtimeSnapshotJson: '{"runtime":"old"}',
            peerPubkey: 'peer-1',
          },
          runtimeProfile: {
            id: 'profile-1',
          },
          sessionKey,
        }),
        replaceStoredProfileBlob,
      } as never,
      publishStateChanged,
      ensureConfiguredRuntime,
      setRuntimeDesiredActive,
      loadActiveProfileId: vi.fn().mockImplementation(async () => activeProfileId),
      stopRuntime,
    });

    const result = await service.completeRotation(
      {
        profilePayload: makeProfilePayload({
          profileId: 'profile-2',
          device: { name: 'Rotated Device' },
        }),
        relays: ['ws://relay.test'],
        signerSettings: { sign_timeout_secs: 45 },
        runtimeSnapshotJson: '{"runtime":"new"}',
        peerPubkey: 'peer-2',
      } as never,
      'profile-1',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        profile: {
          id: 'profile-2',
          label: 'Original Device',
        },
      },
    });
    expect(stopRuntime).toHaveBeenCalledWith('apply_rotation_update_prepare');
    expect(replaceStoredProfileBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        targetProfileId: 'profile-1',
        nextPayload: expect.objectContaining({
          profile: expect.objectContaining({
            profileId: 'profile-2',
            device: expect.objectContaining({
              name: 'Original Device',
            }),
          }),
        }),
      }),
    );
    expect(records.has('profile-1')).toBe(false);
    expect(records.get('profile-2')).toEqual({ id: 'profile-2', label: 'Original Device' });
    expect(activeProfileId).toBe('profile-2');
    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(ensureConfiguredRuntime).toHaveBeenCalledWith('apply_rotation_update');
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('keeps rotation successful when runtime activation is unavailable through the real shared save helper', async () => {
    let activeProfileId: string | null = 'profile-1';
    const replaceStoredProfileBlob = vi.fn().mockImplementation(
      async ({ nextPayload }) => {
        activeProfileId = nextPayload.profile.profileId;
        return {
          id: nextPayload.profile.profileId,
          label: nextPayload.profile.device.name,
          groupName: nextPayload.profile.groupPackage.groupName,
          relays: nextPayload.profile.device.relays,
          groupPublicKey: nextPayload.profile.groupPackage.groupPk,
          publicKey: nextPayload.profile.groupPackage.groupPk,
          sharePublicKey: publicKeyFromSecret(nextPayload.profile.device.shareSecret),
          peerPubkey: nextPayload.peerPubkey ?? undefined,
          signerSettings: nextPayload.signerSettings,
          runtimeSnapshotJson: nextPayload.runtimeSnapshotJson ?? undefined,
        };
      },
    );
    const ensureConfiguredRuntime = vi.fn().mockRejectedValue(new Error('runtime failed'));
    const setRuntimeDesiredActive = vi.fn().mockResolvedValue(undefined);
    const stopRuntime = vi.fn().mockResolvedValue(undefined);
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createOnboardingService({
      profileService: {
        loadProfileForReplacement: vi.fn().mockResolvedValue({
          record: { id: 'profile-1', label: 'Original Device', blob: { version: 1 }, createdAt: 1, updatedAt: 2 },
          payload: {
            profile: makeProfilePayload({
              profileId: 'profile-1',
              device: { name: 'Original Device' },
            }),
            signerSettings: { sign_timeout_secs: 30 },
            runtimeSnapshotJson: '{"runtime":"old"}',
            peerPubkey: 'peer-1',
          },
          runtimeProfile: {
            id: 'profile-1',
          },
          sessionKey,
        }),
        replaceStoredProfileBlob,
      } as never,
      publishStateChanged,
      ensureConfiguredRuntime,
      setRuntimeDesiredActive,
      loadActiveProfileId: vi.fn().mockImplementation(async () => activeProfileId),
      stopRuntime,
    });

    const result = await service.completeRotation(
      {
        profilePayload: makeProfilePayload({
          profileId: 'profile-3',
          device: { name: 'Rotated Device' },
        }),
        relays: ['ws://relay.test'],
        signerSettings: { sign_timeout_secs: 45 },
        runtimeSnapshotJson: '{"runtime":"new"}',
        peerPubkey: 'peer-3',
      } as never,
      'profile-1',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        profile: {
          id: 'profile-3',
          label: 'Original Device',
        },
      },
    });
    expect(stopRuntime).toHaveBeenCalledWith('apply_rotation_update_prepare');
    expect(replaceStoredProfileBlob).toHaveBeenCalledTimes(1);
    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'degraded',
      'background',
      'cold',
      expect.objectContaining({
        reason: 'apply_rotation_update',
        profileId: 'profile-3',
      }),
      expect.objectContaining({
        lastError: expect.objectContaining({
          code: 'runtime_unavailable',
        }),
      }),
    );
    expect(activeProfileId).toBe('profile-3');
    expect(publishStateChanged).toHaveBeenCalled();
  });
});
