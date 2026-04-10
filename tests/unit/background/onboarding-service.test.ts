import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  updateActivationLifecycle,
  updateOnboardingLifecycle,
  captureOnboardingProfile,
  saveConnectedBrowserProfileAndMaybeActivate,
  saveRotatedBrowserProfileAndMaybeActivate,
} = vi.hoisted(() => ({
  updateActivationLifecycle: vi.fn(),
  updateOnboardingLifecycle: vi.fn(),
  captureOnboardingProfile: vi.fn(),
  saveConnectedBrowserProfileAndMaybeActivate: vi.fn(),
  saveRotatedBrowserProfileAndMaybeActivate: vi.fn(),
}));

vi.mock('@/extension/storage', () => ({
  updateActivationLifecycle,
  updateOnboardingLifecycle,
}));

vi.mock('@/lib/extension-runtime-host', () => ({
  captureOnboardingProfile,
}));

vi.mock('@/lib/igloo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/igloo')>('@/lib/igloo');
  return {
    ...actual,
    saveConnectedBrowserProfileAndMaybeActivate,
    saveRotatedBrowserProfileAndMaybeActivate,
  };
});

import { createOnboardingService, OnboardingServiceError } from '@/background/onboarding-service';

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
  return {
    profileId: overrides.profileId ?? 'profile-1',
    version: 1,
    device: {
      name: 'Device 1',
      shareSecret: '11'.repeat(32),
      manualPeerPolicyOverrides: [],
      relays: ['ws://relay'],
      ...overrides.device,
    },
    groupPackage: {
      groupPk: 'group-1',
      groupName: 'Group 1',
      threshold: 1,
      members: [{ idx: 1, pubkey: `02${'22'.repeat(32)}` }],
      ...overrides.groupPackage,
    },
  };
}

describe('onboarding-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateActivationLifecycle.mockResolvedValue(undefined);
    updateOnboardingLifecycle.mockResolvedValue(undefined);
    saveConnectedBrowserProfileAndMaybeActivate.mockImplementation(async ({ persistProfile, activate }) => {
      const profile = await persistProfile({
        finalized: { storedPayload: { version: 1 } },
        password: 'secret',
      });
      if (activate) {
        await activate();
      }
      return {
        profile,
        runtime: null,
        runtimeWarning: null,
      };
    });
    saveRotatedBrowserProfileAndMaybeActivate.mockImplementation(async ({ persistProfile, activate }) => {
      const profile = await persistProfile({
        finalized: { storedPayload: { version: 1 } },
        password: 'secret',
      });
      if (activate) {
        await activate();
      }
      return {
        profile,
        runtime: null,
        runtimeWarning: null,
      };
    });
  });

  test('propagates onboarding progress and rejects duplicate profiles after capture', async () => {
    const pendingProfile = {
      profilePayload: makeProfilePayload(),
      relays: ['ws://relay'],
      signerSettings: { sign_timeout_secs: 30 },
      peerPubkey: 'peer-1',
    };
    captureOnboardingProfile.mockImplementation(async ({ onProgress }) => {
      await onProgress('connecting', { relayCount: 1 });
      return pendingProfile;
    });
    const profileService = {
      rejectDuplicateProfileId: vi.fn().mockResolvedValue(undefined),
    };
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createOnboardingService({
      profileService: profileService as never,
      publishStateChanged,
      ensureConfiguredRuntime: vi.fn(),
      setRuntimeDesiredActive: vi.fn(),
      loadActiveProfileId: vi.fn(),
    });

    const result = await service.startOnboarding({
      input: {
        onboardPackage: ' package ',
        onboardPassword: 'pass',
      },
    });

    expect(result).toEqual({ ok: true, value: { pendingProfile } });
    expect(updateOnboardingLifecycle).toHaveBeenCalledWith('connecting', 'background', { relayCount: 1 });
    expect(profileService.rejectDuplicateProfileId).toHaveBeenCalledWith('profile-1');
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('classifies timeouts as onboarding timeout failures', async () => {
    captureOnboardingProfile.mockRejectedValue(new Error('Timed out waiting for relay response'));
    const service = createOnboardingService({
      profileService: {
        rejectDuplicateProfileId: vi.fn(),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      ensureConfiguredRuntime: vi.fn(),
      setRuntimeDesiredActive: vi.fn(),
      loadActiveProfileId: vi.fn(),
    });

    const result = await service.startOnboarding({
      input: {
        onboardPackage: 'pkg',
        onboardPassword: 'pass',
      },
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'onboard_timeout',
        message: 'Timed out waiting for relay response',
      },
    });

    expect(updateOnboardingLifecycle).toHaveBeenLastCalledWith(
      'failed',
      'background',
      { packageLength: 3 },
      expect.objectContaining({ code: 'onboard_timeout' })
    );
  });

  test('persists and activates an onboarded profile', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockResolvedValue({
      runtimeProfile: { id: 'profile-2' },
    });
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
        relays: ['ws://relay'],
        signerSettings: { sign_timeout_secs: 30 },
        runtimeSnapshotJson: '{}',
        peerPubkey: 'peer-2',
      } as never,
      'Saved Device',
      'secret'
    );

    expect(result).toEqual({ ok: true, value: { profile: { id: 'profile-2' } } });
    expect(storeProfileBlobAndUnlock).toHaveBeenCalled();
    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(ensureConfiguredRuntime).toHaveBeenCalledWith('complete_onboarding');
    expect(updateOnboardingLifecycle).toHaveBeenNthCalledWith(
      1,
      'profile_persisted',
      'background',
      expect.objectContaining({ profileId: 'profile-2' })
    );
    expect(updateOnboardingLifecycle).toHaveBeenNthCalledWith(
      2,
      'idle',
      'background',
      { profileId: 'profile-2' }
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('persists onboarding and returns success when runtime activation fails after persistence', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockResolvedValue({
      runtimeProfile: { id: 'profile-2' },
    });
    const setRuntimeDesiredActive = vi.fn().mockResolvedValue(undefined);
    const ensureConfiguredRuntime = vi.fn().mockRejectedValue(new Error('runtime failed'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    saveConnectedBrowserProfileAndMaybeActivate.mockImplementationOnce(
      async ({ persistProfile, activate, onRuntimeUnavailable }) => {
        const profile = await persistProfile({
          finalized: { storedPayload: { version: 1 } },
          password: 'secret',
        });
        try {
          await activate?.();
        } catch (error) {
          await onRuntimeUnavailable?.({
            code: 'runtime_unavailable',
            message:
              'Profile saved, but the signer is unavailable. Start it again when relays are reachable.',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        return {
          profile,
          runtime: null,
          runtimeWarning: {
            code: 'runtime_unavailable',
            message:
              'Profile saved, but the signer is unavailable. Start it again when relays are reachable.',
            detail: 'runtime failed',
          },
        };
      },
    );
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
        relays: ['ws://relay'],
        signerSettings: { sign_timeout_secs: 30 },
        runtimeSnapshotJson: '{}',
        peerPubkey: 'peer-2',
      } as never,
      'Saved Device',
      'secret'
    );

    expect(result).toEqual({ ok: true, value: { profile: { id: 'profile-2' } } });

    expect(updateOnboardingLifecycle).toHaveBeenCalledWith(
      'profile_persisted',
      'background',
      expect.objectContaining({ profileId: 'profile-2' })
    );
    expect(updateOnboardingLifecycle).toHaveBeenCalledWith(
      'idle',
      'background',
      { profileId: 'profile-2' }
    );
    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'degraded',
      'background',
      'cold',
      expect.objectContaining({ reason: 'complete_onboarding', profileId: 'profile-2' }),
      expect.objectContaining({
        lastError: expect.objectContaining({ code: 'runtime_unavailable' }),
      }),
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('does not partially activate onboarding when profile persistence fails', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockRejectedValue(new Error('store failed'));
    const setRuntimeDesiredActive = vi.fn().mockResolvedValue(undefined);
    const ensureConfiguredRuntime = vi.fn().mockResolvedValue(undefined);
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    saveConnectedBrowserProfileAndMaybeActivate.mockImplementationOnce(async ({ persistProfile }) => {
      await persistProfile({
        finalized: { storedPayload: { version: 1 } },
        password: 'secret',
      });
      throw new Error('store failed');
    });
    const service = createOnboardingService({
      profileService: {
        storeProfileBlobAndUnlock,
      } as never,
      publishStateChanged,
      ensureConfiguredRuntime,
      setRuntimeDesiredActive,
      loadActiveProfileId: vi.fn(),
    });

    await expect(
      service.completeOnboarding(
        {
          profilePayload: makeProfilePayload({
            profileId: 'profile-2',
            device: { name: 'Original Device' },
          }),
          relays: ['ws://relay'],
          signerSettings: { sign_timeout_secs: 30 },
          runtimeSnapshotJson: '{}',
          peerPubkey: 'peer-2',
        } as never,
        'Saved Device',
        'secret'
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'profile_persist_failed',
        message: 'store failed',
      },
    });

    expect(setRuntimeDesiredActive).not.toHaveBeenCalled();
    expect(ensureConfiguredRuntime).not.toHaveBeenCalled();
    expect(updateOnboardingLifecycle).not.toHaveBeenCalledWith(
      'profile_persisted',
      'background',
      expect.anything()
    );
    expect(publishStateChanged).not.toHaveBeenCalled();
  });

  test('classifies non-timeout onboarding failures as rejected', async () => {
    captureOnboardingProfile.mockRejectedValue(new Error('peer rejected onboarding'));
    const service = createOnboardingService({
      profileService: {
        rejectDuplicateProfileId: vi.fn(),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      ensureConfiguredRuntime: vi.fn(),
      setRuntimeDesiredActive: vi.fn(),
      loadActiveProfileId: vi.fn(),
    });

    await expect(
      service.startOnboarding({
        input: {
          onboardPackage: 'pkg',
          onboardPassword: 'pass',
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'onboard_rejected',
        message: 'peer rejected onboarding',
      },
    });

    expect(updateOnboardingLifecycle).toHaveBeenLastCalledWith(
      'failed',
      'background',
      { packageLength: 3 },
      expect.objectContaining({ code: 'onboard_rejected' })
    );
  });

  test('rejects rotation packages for a different group public key', async () => {
    const service = createOnboardingService({
      profileService: {
        loadProfileForReplacement: vi.fn().mockResolvedValue({
          payload: {
            profile: makeProfilePayload({
              profileId: 'current-profile',
              device: { name: 'Current Device' },
            }),
            signerSettings: {},
            peerPubkey: 'peer-1',
          },
          sessionKeyB64: 'session-key',
          record: { createdAt: 1 },
        }),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      ensureConfiguredRuntime: vi.fn(),
      setRuntimeDesiredActive: vi.fn(),
      loadActiveProfileId: vi.fn(),
    });

    const result = await service.completeRotation(
      {
        profilePayload: makeProfilePayload({
          profileId: 'next-profile',
          device: { name: 'Next Device' },
          groupPackage: { groupPk: 'group-2', groupName: 'Group 2' },
        }),
      } as never,
      'current-profile'
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'rotation_group_mismatch',
        message: 'Rotation package does not match the selected profile group public key.',
      },
    });
  });

  test('rejects rotation packages that do not produce a new profile id', async () => {
    const service = createOnboardingService({
      profileService: {
        loadProfileForReplacement: vi.fn().mockResolvedValue({
          payload: {
            profile: makeProfilePayload({
              profileId: 'current-profile',
              device: { name: 'Current Device' },
            }),
            signerSettings: {},
            peerPubkey: 'peer-1',
          },
          sessionKeyB64: 'session-key',
          record: { createdAt: 1 },
        }),
      } as never,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      ensureConfiguredRuntime: vi.fn(),
      setRuntimeDesiredActive: vi.fn(),
      loadActiveProfileId: vi.fn(),
    });

    const result = await service.completeRotation(
      {
        profilePayload: makeProfilePayload({
          profileId: 'current-profile',
          device: { name: 'Next Device' },
        }),
      } as never,
      'current-profile'
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'rotation_same_profile',
        message: 'Rotation package did not produce a new device profile id.',
      },
    });
  });

  test('replaces the active profile during rotation and restarts against the rotated id', async () => {
    const records = new Map([
      [
        'profile-1',
        {
          id: 'profile-1',
          label: 'Original Device',
        },
      ],
    ]);
    let activeProfileId: string | null = 'profile-1';
    const replaceStoredProfileBlob = vi.fn().mockImplementation(async ({ targetProfileId, nextPayload }) => {
      records.delete(targetProfileId);
      records.set(nextPayload.profile.profileId, {
        id: nextPayload.profile.profileId,
        label: nextPayload.profile.device.name,
      });
      activeProfileId = nextPayload.profile.profileId;
      return { id: nextPayload.profile.profileId };
    });
    const ensureConfiguredRuntime = vi.fn().mockResolvedValue(undefined);
    const setRuntimeDesiredActive = vi.fn().mockResolvedValue(undefined);
    const stopRuntime = vi.fn().mockResolvedValue(undefined);
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    saveRotatedBrowserProfileAndMaybeActivate.mockImplementationOnce(
      async ({ targetProfile, connectedProfilePayload, persistProfile, activate }) => {
        const profile = await persistProfile({
          finalized: {
            storedPayload: {
              version: 1,
              profile: {
                ...connectedProfilePayload,
                device: {
                  ...connectedProfilePayload.device,
                  name: targetProfile.label,
                },
              },
              signerSettings: { sign_timeout_secs: 45 },
              runtimeSnapshotJson: '{"runtime":"new"}',
              peerPubkey: 'peer-2',
            },
          },
          password: 'session-key',
        });
        await activate?.();
        return {
          profile,
          runtime: null,
          runtimeWarning: null,
        };
      },
    );
    const service = createOnboardingService({
      profileService: {
        loadProfileForReplacement: vi.fn().mockResolvedValue({
          record: { id: 'profile-1', label: 'Original Device', blob: { version: 1 }, createdAt: 1, updatedAt: 2 },
          payload: {
            profile: makeProfilePayload({
              profileId: 'profile-1',
              device: {
                name: 'Original Device',
                shareSecret: '11'.repeat(32),
                manualPeerPolicyOverrides: [],
                relays: ['ws://relay'],
              },
              groupPackage: {
                groupName: 'Group 1',
                groupPk: 'group-1',
                threshold: 1,
                members: [{ idx: 1, pubkey: `02${'22'.repeat(32)}` }],
              },
            }),
            signerSettings: { sign_timeout_secs: 30 },
            runtimeSnapshotJson: '{"runtime":"old"}',
            peerPubkey: 'peer-1',
          },
          runtimeProfile: {
            sharePublicKey: '22'.repeat(32),
          },
          sessionKeyB64: 'session-key',
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
          groupPackage: {
            groupName: 'Group 1',
            groupPk: 'group-1',
            threshold: 1,
            members: [{ idx: 1, pubkey: `02${'22'.repeat(32)}` }],
          },
        }),
        relays: ['ws://relay'],
        signerSettings: { sign_timeout_secs: 45 },
        runtimeSnapshotJson: '{"runtime":"new"}',
        peerPubkey: 'peer-2',
      } as never,
      'profile-1'
    );

    expect(result).toEqual({ ok: true, value: { profile: { id: 'profile-2' } } });
    expect(stopRuntime).toHaveBeenCalledWith('apply_rotation_update_prepare');
    expect(replaceStoredProfileBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        targetProfileId: 'profile-1',
        nextPayload: expect.objectContaining({
          profile: expect.objectContaining({
            profileId: 'profile-2',
            device: expect.objectContaining({ name: 'Original Device' }),
          }),
        }),
      })
    );
    expect(records.has('profile-1')).toBe(false);
    expect(records.get('profile-2')).toEqual({ id: 'profile-2', label: 'Original Device' });
    expect(activeProfileId).toBe('profile-2');
    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(ensureConfiguredRuntime).toHaveBeenCalledWith('apply_rotation_update');
    expect(publishStateChanged).toHaveBeenCalled();
  });
});
