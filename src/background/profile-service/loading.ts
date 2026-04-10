import {
  loadActiveProfileId,
  loadStoredProfileRecord,
  loadUnlockedProfileKey,
} from '@/extension/storage';
import { decryptLocalProfileBlobWithPassword, decryptLocalProfileBlobWithSessionKey } from '@/lib/profile-blob';
import { toRuntimeProfile } from './projection';
import type { ActiveRuntimeProfile, LoadedRuntimeProfile } from './types';

export async function loadUnlockedRuntimeProfile(
  profileId: string,
): Promise<LoadedRuntimeProfile> {
  const [record, sessionKeyB64] = await Promise.all([
    loadStoredProfileRecord(profileId),
    loadUnlockedProfileKey(profileId),
  ]);
  if (!record) {
    throw new Error('Selected profile was not found.');
  }
  if (!sessionKeyB64) {
    return {
      record,
      payload: null,
      runtimeProfile: null,
      sessionKeyB64: null,
    };
  }
  const payload = await decryptLocalProfileBlobWithSessionKey(record.blob, sessionKeyB64);
  return {
    record,
    payload,
    runtimeProfile: toRuntimeProfile(payload),
    sessionKeyB64,
  };
}

export async function loadProfileForReplacement(
  profileId: string,
  password?: string | null,
) {
  const unlocked = await loadUnlockedRuntimeProfile(profileId);
  if (unlocked.payload && unlocked.sessionKeyB64) {
    return unlocked;
  }
  const record = unlocked.record ?? (await loadStoredProfileRecord(profileId));
  if (!record) {
    throw new Error('Selected profile was not found.');
  }
  if (!password?.trim()) {
    throw new Error('Selected profile is locked.');
  }
  let decrypted: Awaited<ReturnType<typeof decryptLocalProfileBlobWithPassword>>;
  try {
    decrypted = await decryptLocalProfileBlobWithPassword(record.blob, password);
  } catch {
    throw new Error('Invalid profile password.');
  }
  return {
    record,
    payload: decrypted.payload,
    runtimeProfile: toRuntimeProfile(decrypted.payload),
    sessionKeyB64: decrypted.sessionKeyB64,
  };
}

export async function loadActiveRuntimeProfile(): Promise<ActiveRuntimeProfile | null> {
  const activeProfileId = await loadActiveProfileId();
  if (!activeProfileId) {
    return null;
  }
  const unlocked = await loadUnlockedRuntimeProfile(activeProfileId);
  if (!unlocked.runtimeProfile || !unlocked.payload) {
    return null;
  }
  return {
    activeProfileId,
    ...unlocked,
  };
}
