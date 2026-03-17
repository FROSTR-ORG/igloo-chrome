import {
  loadExtensionProfile,
  clearRuntimeSnapshotInExtensionStorage,
  clearMirroredProfileInExtensionStorage,
  mirrorProfileToExtensionStorage
} from '@/extension/storage';
import type { StoredExtensionProfile } from '@/extension/protocol';
import { normalizeRelays } from './igloo';
import {
  normalizeSignerSettings,
  type SignerSettings
} from './signer-settings';

export type StoredProfile = StoredExtensionProfile & {
  signerSettings?: SignerSettings;
};

const STORAGE_KEY = 'igloo.v2.profile';
export const RUNTIME_SNAPSHOT_LOCAL_STORAGE_KEY = 'igloo.ext.runtimeSnapshot';

export function hasStoredProfile(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

export async function saveStoredProfile(data: StoredProfile): Promise<void> {
  const { relays } = normalizeRelays(data.relays);
  const payload = {
    ...data,
    relays,
    signerSettings: normalizeSignerSettings(data.signerSettings)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  await mirrorProfileToExtensionStorage(payload);
}

export function loadStoredProfile(): StoredProfile {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('No saved profile');
  const payload = JSON.parse(raw) as StoredProfile;
  const { relays } = normalizeRelays(payload.relays ?? []);
  return {
    ...payload,
    relays,
    signerSettings: normalizeSignerSettings(payload.signerSettings)
  };
}

export async function rehydrateStoredProfileFromExtensionStorage(): Promise<StoredProfile | null> {
  const payload = await loadExtensionProfile();
  if (!payload) {
    return null;
  }
  const { relays } = normalizeRelays(payload.relays ?? []);
  const next = {
    ...payload,
    relays,
    signerSettings: normalizeSignerSettings(payload.signerSettings)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearStoredProfile() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(RUNTIME_SNAPSHOT_LOCAL_STORAGE_KEY);
  clearMirroredProfileInExtensionStorage();
  clearRuntimeSnapshotInExtensionStorage();
}

export function saveRuntimeSnapshot(snapshotJson: string): void {
  localStorage.setItem(RUNTIME_SNAPSHOT_LOCAL_STORAGE_KEY, snapshotJson);
}

export function loadRuntimeSnapshot(): string | null {
  return localStorage.getItem(RUNTIME_SNAPSHOT_LOCAL_STORAGE_KEY);
}

export function clearRuntimeSnapshot(): void {
  localStorage.removeItem(RUNTIME_SNAPSHOT_LOCAL_STORAGE_KEY);
}
