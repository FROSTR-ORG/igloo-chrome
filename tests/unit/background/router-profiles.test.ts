import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  clearUnlockedProfileKeys,
  recoverProfileFromSharePackage,
  saveUnlockedProfileKey,
  setActiveProfileId,
  setRuntimeDesiredActive,
  updateActivationLifecycle,
} = vi.hoisted(() => ({
  clearUnlockedProfileKeys: vi.fn(),
  recoverProfileFromSharePackage: vi.fn(),
  saveUnlockedProfileKey: vi.fn(),
  setActiveProfileId: vi.fn(),
  setRuntimeDesiredActive: vi.fn(),
  updateActivationLifecycle: vi.fn(),
}));

vi.mock('../../../../igloo-shared/src/profile-backup-host.ts', () => ({
  recoverProfileFromSharePackage,
}));

vi.mock('@/extension/storage', () => ({
  clearUnlockedProfileKeys,
  saveUnlockedProfileKey,
  setActiveProfileId,
  setRuntimeDesiredActive,
  updateActivationLifecycle,
}));

import { COMMAND_TYPE } from '@/extension/protocol';
import { createProfilesRouter } from '@/background/router-profiles';
import { publicKeyFromSecret, setInjectedWasmProfileModuleForTests } from '@/lib/igloo';

function createProfilePayload() {
  return {
    profileId: 'profile-import-1',
    version: 1,
    device: {
      name: 'Imported Device',
      shareSecret: '11'.repeat(32),
      manualPeerPolicyOverrides: [],
      relays: ['ws://relay.test'],
    },
    groupPackage: {
      groupName: 'Imported Group',
      groupPk: '22'.repeat(32),
      threshold: 1,
      members: [{ idx: 1, pubkey: `02${'33'.repeat(32)}` }],
    },
  };
}

function createInjectedProfileModule() {
  const payload = createProfilePayload();
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  return {
    bf_package_version: () => 1,
    bfshare_prefix: () => 'bfshare1',
    bfonboard_prefix: () => 'bfonboard1',
    bfprofile_prefix: () => 'bfprofile1',
    profile_backup_event_kind: () => 30078,
    profile_backup_key_domain: () => 'profile-backup',
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
      }),
    derive_profile_id_from_share_secret: () => payload.profileId,
    derive_profile_id_from_share_pubkey: () => payload.profileId,
    encode_bfprofile_package: () => 'bfprofile1encoded',
    decode_bfprofile_package: () => JSON.stringify(payload),
    create_profile_package_pair: () =>
      JSON.stringify({
        profileString: 'bfprofile1-generated',
        shareString: 'bfshare1-generated',
      }),
    create_encrypted_profile_backup: () => JSON.stringify({ ciphertext: 'backup-ciphertext' }),
    derive_profile_backup_conversation_key_hex: () => '44'.repeat(32),
    encrypt_profile_backup_content: () => 'backup-ciphertext',
    decrypt_profile_backup_content: () => JSON.stringify({}),
    build_profile_backup_event: () => JSON.stringify({ id: 'backup-event' }),
    parse_profile_backup_event: () =>
      JSON.stringify({
        version: 1,
        device: {
          name: payload.device.name,
          sharePublicKey,
          manualPeerPolicyOverrides: [],
          relays: payload.device.relays,
        },
        groupPackage: payload.groupPackage,
      }),
    recover_profile_from_share_and_backup: () => JSON.stringify(payload),
  };
}

describe('profiles router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInjectedWasmProfileModuleForTests(createInjectedProfileModule() as never);
    recoverProfileFromSharePackage.mockResolvedValue({
      share: {
        shareSecret: createProfilePayload().device.shareSecret,
        relays: createProfilePayload().device.relays,
      },
      backup: {
        version: 1,
        device: {
          name: createProfilePayload().device.name,
          sharePublicKey: publicKeyFromSecret(createProfilePayload().device.shareSecret),
          manualPeerPolicyOverrides: [],
          relays: createProfilePayload().device.relays,
        },
        groupPackage: createProfilePayload().groupPackage,
      },
      profile: createProfilePayload(),
      event: {
        id: 'backup-event',
        pubkey: publicKeyFromSecret(createProfilePayload().device.shareSecret),
        kind: 30078,
        tags: [],
        content: 'ciphertext',
        created_at: 1,
        sig: 'sig',
      },
    });
    setRuntimeDesiredActive.mockResolvedValue(undefined);
    updateActivationLifecycle.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setInjectedWasmProfileModuleForTests(null);
  });

  test('imports a bfprofile through the real shared save path and activates the saved profile', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockImplementation(async (storedPayload) => ({
      runtimeProfile: {
        id: storedPayload.profile.profileId,
        label: storedPayload.profile.device.name,
      },
    }));
    const ensureConfiguredRuntime = vi.fn().mockResolvedValue({ ok: true, value: { ensured: true } });
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const handlers = createProfilesRouter({
      profileService: {
        storeProfileBlobAndUnlock,
      } as never,
      runtimeService: {
        ensureConfiguredRuntime,
      } as never,
      stateProjector: {
        publishStateChanged,
      } as never,
    });
    const sendResponse = vi.fn();

    expect(
      handlers[COMMAND_TYPE.PROFILES_IMPORT](
        {
          packageText: 'bfprofile1-imported',
          password: 'secret',
        } as never,
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(storeProfileBlobAndUnlock).toHaveBeenCalledTimes(1);
      expect(ensureConfiguredRuntime).toHaveBeenCalledWith('import_bfprofile');
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: {
          id: 'profile-import-1',
          label: 'Imported Device',
        },
      });
    });

    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(publishStateChanged).toHaveBeenCalled();
    expect(updateActivationLifecycle).not.toHaveBeenCalled();
  });

  test('keeps the imported profile when runtime activation fails after persistence', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockImplementation(async (storedPayload) => ({
      runtimeProfile: {
        id: storedPayload.profile.profileId,
        label: storedPayload.profile.device.name,
      },
    }));
    const ensureConfiguredRuntime = vi.fn().mockRejectedValue(new Error('runtime offline'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const handlers = createProfilesRouter({
      profileService: {
        storeProfileBlobAndUnlock,
      } as never,
      runtimeService: {
        ensureConfiguredRuntime,
      } as never,
      stateProjector: {
        publishStateChanged,
      } as never,
    });
    const sendResponse = vi.fn();

    handlers[COMMAND_TYPE.PROFILES_IMPORT](
      {
        packageText: 'bfprofile1-imported',
        password: 'secret',
      } as never,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(storeProfileBlobAndUnlock).toHaveBeenCalledTimes(1);
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: {
          id: 'profile-import-1',
          label: 'Imported Device',
        },
      });
    });

    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'degraded',
      'background',
      'cold',
      {
        reason: 'import_bfprofile',
        profileId: 'profile-import-1',
      },
      expect.objectContaining({
        lastError: expect.objectContaining({
          code: 'runtime_unavailable',
          message: expect.stringContaining('runtime offline'),
        }),
        restoredFromSnapshot: false,
      }),
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('recovers a bfshare through the real shared save path and activates the recovered profile', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockImplementation(async (storedPayload) => ({
      runtimeProfile: {
        id: storedPayload.profile.profileId,
        label: storedPayload.profile.device.name,
      },
    }));
    const ensureConfiguredRuntime = vi.fn().mockResolvedValue({ ok: true, value: { ensured: true } });
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const handlers = createProfilesRouter({
      profileService: {
        storeProfileBlobAndUnlock,
      } as never,
      runtimeService: {
        ensureConfiguredRuntime,
      } as never,
      stateProjector: {
        publishStateChanged,
      } as never,
    });
    const sendResponse = vi.fn();

    expect(
      handlers[COMMAND_TYPE.PROFILES_RECOVER](
        {
          packageText: 'bfshare1-imported',
          password: 'secret',
        } as never,
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(recoverProfileFromSharePackage).toHaveBeenCalledWith('bfshare1-imported', 'secret');
      expect(storeProfileBlobAndUnlock).toHaveBeenCalledTimes(1);
      expect(ensureConfiguredRuntime).toHaveBeenCalledWith('recover_bfshare');
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: {
          id: 'profile-import-1',
          label: 'Imported Device',
        },
      });
    });

    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(true);
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('keeps the recovered profile when runtime activation fails after persistence', async () => {
    const storeProfileBlobAndUnlock = vi.fn().mockImplementation(async (storedPayload) => ({
      runtimeProfile: {
        id: storedPayload.profile.profileId,
        label: storedPayload.profile.device.name,
      },
    }));
    const ensureConfiguredRuntime = vi.fn().mockRejectedValue(new Error('runtime offline'));
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const handlers = createProfilesRouter({
      profileService: {
        storeProfileBlobAndUnlock,
      } as never,
      runtimeService: {
        ensureConfiguredRuntime,
      } as never,
      stateProjector: {
        publishStateChanged,
      } as never,
    });
    const sendResponse = vi.fn();

    handlers[COMMAND_TYPE.PROFILES_RECOVER](
      {
        packageText: 'bfshare1-imported',
        password: 'secret',
      } as never,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(recoverProfileFromSharePackage).toHaveBeenCalledWith('bfshare1-imported', 'secret');
      expect(storeProfileBlobAndUnlock).toHaveBeenCalledTimes(1);
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: {
          id: 'profile-import-1',
          label: 'Imported Device',
        },
      });
    });

    expect(updateActivationLifecycle).toHaveBeenCalledWith(
      'degraded',
      'background',
      'cold',
      {
        reason: 'recover_bfshare',
        profileId: 'profile-import-1',
      },
      expect.objectContaining({
        lastError: expect.objectContaining({
          code: 'runtime_unavailable',
          message: expect.stringContaining('runtime offline'),
        }),
        restoredFromSnapshot: false,
      }),
    );
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('exports the active profile package through the shared encoder', async () => {
    const handlers = createProfilesRouter({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue({
          payload: {
            profile: createProfilePayload(),
          },
        }),
      } as never,
      runtimeService: {} as never,
      stateProjector: {} as never,
    });
    const sendResponse = vi.fn();

    expect(
      handlers[COMMAND_TYPE.PROFILES_EXPORT_PACKAGE](
        {
          format: 'bfprofile',
          password: 'secret-password',
        } as never,
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: {
          packageText: 'bfprofile1encoded',
        },
      });
    });
  });

  test('exports the active share package through the shared encoder', async () => {
    const handlers = createProfilesRouter({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue({
          payload: {
            profile: createProfilePayload(),
          },
        }),
      } as never,
      runtimeService: {} as never,
      stateProjector: {} as never,
    });
    const sendResponse = vi.fn();

    handlers[COMMAND_TYPE.PROFILES_EXPORT_PACKAGE](
      {
        format: 'bfshare',
        password: 'secret-password',
      } as never,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: {
          packageText: 'bfshare1encoded',
        },
      });
    });
  });

  test('rejects export when the package password is missing', async () => {
    const handlers = createProfilesRouter({
      profileService: {} as never,
      runtimeService: {} as never,
      stateProjector: {} as never,
    });
    const sendResponse = vi.fn();

    expect(
      handlers[COMMAND_TYPE.PROFILES_EXPORT_PACKAGE](
        {
          format: 'bfprofile',
          password: '',
        } as never,
        sendResponse,
      ),
    ).toBe(true);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: 'Invalid profile package export payload',
    });
  });

  test('rejects export when no active unlocked profile is available', async () => {
    const handlers = createProfilesRouter({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(null),
      } as never,
      runtimeService: {} as never,
      stateProjector: {} as never,
    });
    const sendResponse = vi.fn();

    handlers[COMMAND_TYPE.PROFILES_EXPORT_PACKAGE](
      {
        format: 'bfprofile',
        password: 'secret-password',
      } as never,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: 'Active profile is locked or unavailable.',
      });
    });
  });

  test('deletes an inactive stored profile without touching runtime state', async () => {
    const deleteStoredProfileRecord = vi.fn().mockResolvedValue(undefined);
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const stopRuntime = vi.fn();
    const handlers = createProfilesRouter({
      profileService: {
        loadActiveProfileId: vi.fn().mockResolvedValue('profile-other'),
        deleteStoredProfileRecord,
      } as never,
      runtimeService: {
        stopRuntime,
      } as never,
      stateProjector: {
        publishStateChanged,
      } as never,
    });
    const sendResponse = vi.fn();

    expect(
      handlers[COMMAND_TYPE.PROFILES_DELETE](
        {
          profileId: 'profile-import-1',
        } as never,
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => {
      expect(deleteStoredProfileRecord).toHaveBeenCalledWith('profile-import-1');
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: true,
      });
    });

    expect(stopRuntime).not.toHaveBeenCalled();
    expect(setRuntimeDesiredActive).not.toHaveBeenCalled();
    expect(setActiveProfileId).not.toHaveBeenCalled();
    expect(updateActivationLifecycle).not.toHaveBeenCalled();
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('deletes the active stored profile and clears the active runtime selection', async () => {
    const deleteStoredProfileRecord = vi.fn().mockResolvedValue(undefined);
    const stopRuntime = vi.fn().mockResolvedValue({ ok: true, value: true });
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const handlers = createProfilesRouter({
      profileService: {
        loadActiveProfileId: vi.fn().mockResolvedValue('profile-import-1'),
        deleteStoredProfileRecord,
      } as never,
      runtimeService: {
        stopRuntime,
      } as never,
      stateProjector: {
        publishStateChanged,
      } as never,
    });
    const sendResponse = vi.fn();

    handlers[COMMAND_TYPE.PROFILES_DELETE](
      {
        profileId: 'profile-import-1',
      } as never,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(stopRuntime).toHaveBeenCalledWith('delete_profile');
      expect(deleteStoredProfileRecord).toHaveBeenCalledWith('profile-import-1');
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: true,
      });
    });

    expect(setRuntimeDesiredActive).toHaveBeenCalledWith(false);
    expect(setActiveProfileId).toHaveBeenCalledWith(null);
    expect(updateActivationLifecycle).toHaveBeenCalledWith('idle', 'background', 'cold');
    expect(publishStateChanged).toHaveBeenCalled();
  });
});
