import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  clearUnlockedProfileKeys,
  deleteStoredProfileRecord,
  loadActiveProfileId,
  loadStoredProfileRecord,
  loadStoredProfileRecords,
  loadUnlockedProfileIds,
  loadUnlockedProfileKey,
  replaceStoredProfileRecord,
  saveStoredProfileRecord,
  saveUnlockedProfileKey,
  setActiveProfileId,
  createBrowserStoredRuntimeProfile,
  normalizeBrowserStoredProfilePayload,
  normalizeSignerSettings,
  normalizeRelays,
  decryptLocalProfileBlobWithPassword,
  decryptLocalProfileBlobWithSessionKey,
  encryptLocalProfileBlobPayload,
  reencryptLocalProfileBlobWithSessionKey,
} = vi.hoisted(() => ({
  clearUnlockedProfileKeys: vi.fn(),
  deleteStoredProfileRecord: vi.fn(),
  loadActiveProfileId: vi.fn(),
  loadStoredProfileRecord: vi.fn(),
  loadStoredProfileRecords: vi.fn(),
  loadUnlockedProfileIds: vi.fn(),
  loadUnlockedProfileKey: vi.fn(),
  replaceStoredProfileRecord: vi.fn(),
  saveStoredProfileRecord: vi.fn(),
  saveUnlockedProfileKey: vi.fn(),
  setActiveProfileId: vi.fn(),
  createBrowserStoredRuntimeProfile: vi.fn((payload) => ({
    id: payload.profile.profileId,
    groupName: payload.profile.groupPackage.groupName?.trim() || undefined,
    relays: payload.profile.device.relays,
    groupPublicKey: payload.profile.groupPackage.groupPk?.toLowerCase?.() ?? 'group-pk',
    sharePublicKey: 'share-pk',
    publicKey: payload.profile.groupPackage.groupPk?.toLowerCase?.() ?? 'group-pk',
    peerPubkey: payload.peerPubkey ?? undefined,
    signerSettings: payload.signerSettings ?? {},
    runtimeSnapshotJson: payload.runtimeSnapshotJson ?? undefined,
  })),
  normalizeBrowserStoredProfilePayload: vi.fn((payload) => payload),
  normalizeSignerSettings: vi.fn((value = {}) => value),
  normalizeRelays: vi.fn((relays) => ({ relays })),
  decryptLocalProfileBlobWithPassword: vi.fn(),
  decryptLocalProfileBlobWithSessionKey: vi.fn(),
  encryptLocalProfileBlobPayload: vi.fn(),
  reencryptLocalProfileBlobWithSessionKey: vi.fn(),
}));

vi.mock('@/extension/storage', () => ({
  clearUnlockedProfileKeys,
  deleteStoredProfileRecord,
  loadActiveProfileId,
  loadStoredProfileRecord,
  loadStoredProfileRecords,
  loadUnlockedProfileIds,
  loadUnlockedProfileKey,
  replaceStoredProfileRecord,
  saveStoredProfileRecord,
  saveUnlockedProfileKey,
  setActiveProfileId,
}));

vi.mock('@/lib/signer-settings', () => ({
  normalizeSignerSettings,
}));

vi.mock('@/lib/igloo', () => ({
  createBrowserStoredRuntimeProfile,
  normalizeBrowserStoredProfilePayload,
  DEFAULT_RELAYS: ['ws://default-relay'],
  normalizeRelays,
}));

vi.mock('@/lib/profile-blob', () => ({
  decryptLocalProfileBlobWithPassword,
  decryptLocalProfileBlobWithSessionKey,
  encryptLocalProfileBlobPayload,
  reencryptLocalProfileBlobWithSessionKey,
}));

import { createProfileService } from '@/background/profile-service';

describe('profile-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadStoredProfileRecords.mockResolvedValue([]);
    loadStoredProfileRecord.mockResolvedValue({
      id: 'profile-1',
      label: 'Example',
      blob: { version: 1 },
      createdAt: 1,
      updatedAt: 2,
    });
    loadUnlockedProfileKey.mockResolvedValue(null);
  });

  test('returns a locked runtime profile when no session key is available', async () => {
    const service = createProfileService();

    const result = await service.loadUnlockedRuntimeProfile('profile-1');

    expect(result).toEqual({
      record: expect.objectContaining({ id: 'profile-1' }),
      payload: null,
      runtimeProfile: null,
      sessionKeyB64: null,
    });
  });

  test('normalizes identifiers, relays, and peer pubkeys', async () => {
    normalizeRelays.mockReturnValue({ relays: ['ws://relay-1'] });
    const service = createProfileService();

    const result = await service.normalizeProfileInput({
      id: ' PROFILE-2 ',
      groupName: ' Group ',
      groupPublicKey: ' ABCD ',
      sharePublicKey: ' 1234 ',
      publicKey: ' FEDC ',
      peerPubkey: ' BEEF ',
      relays: ['ws://relay-1'],
      signerSettings: { sign_timeout_secs: 25 },
    } as never);

    expect(result).toEqual(
      expect.objectContaining({
        id: 'profile-2',
        groupName: 'Group',
        groupPublicKey: 'abcd',
        sharePublicKey: '1234',
        publicKey: 'fedc',
        peerPubkey: 'beef',
        relays: ['ws://relay-1'],
      })
    );
  });

  test('atomically replaces a stored profile blob during rotation', async () => {
    reencryptLocalProfileBlobWithSessionKey.mockResolvedValue({ version: 1, encrypted: true });
    const service = createProfileService();
    const nextPayload = {
      profile: {
        profileId: 'profile-2',
        device: {
          name: 'Rotated Device',
          relays: ['ws://relay'],
        },
        groupPackage: {
          groupName: 'Group 2',
          groupPk: 'group-2',
        },
      },
      signerSettings: {},
    };

    const result = await service.replaceStoredProfileBlob({
      targetProfileId: 'profile-1',
      nextPayload: nextPayload as never,
      sessionKeyB64: 'session-key',
      existingRecord: {
        id: 'profile-1',
        label: 'Old Device',
        blob: { version: 1 },
        createdAt: 1,
        updatedAt: 2,
      },
    });

    expect(replaceStoredProfileRecord).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        id: 'profile-2',
        label: 'Rotated Device',
      }),
    );
    expect(saveUnlockedProfileKey).toHaveBeenCalledWith('profile-2', 'session-key');
    expect(setActiveProfileId).toHaveBeenCalledWith('profile-2');
    expect(result).toEqual(expect.objectContaining({ id: 'profile-2' }));
  });
});
