import { getChromeApi } from '@/extension/chrome';
import {
  extractEventKind,
  type ProviderMethod,
  type StoredExtensionProfile,
  type StoredPeerPolicy,
  type StoredPermissionPolicy
} from '@/extension/protocol';

export const PROFILE_STORAGE_KEY = 'igloo.ext.profile';
export const PEER_POLICIES_STORAGE_KEY = 'igloo.ext.peerPolicies';
export const PERMISSIONS_STORAGE_KEY = 'igloo.ext.permissions';
export const RUNTIME_SNAPSHOT_STORAGE_KEY = 'igloo.ext.runtimeSnapshot';

async function storageGet<T>(key: string): Promise<T | undefined> {
  const chromeApi = getChromeApi();
  if (!chromeApi?.storage?.local?.get) return undefined;
  const payload = await chromeApi.storage.local.get(key);
  return payload[key] as T | undefined;
}

async function storageSet<T>(key: string, value: T): Promise<void> {
  const chromeApi = getChromeApi();
  if (!chromeApi?.storage?.local?.set) return;
  await chromeApi.storage.local.set({ [key]: value });
}

async function storageRemove(key: string): Promise<void> {
  const chromeApi = getChromeApi();
  if (!chromeApi?.storage?.local?.remove) return;
  await chromeApi.storage.local.remove(key);
}

export function mirrorProfileToExtensionStorage(profile: StoredExtensionProfile) {
  void storageSet(PROFILE_STORAGE_KEY, profile);
}

export function clearMirroredProfileInExtensionStorage() {
  void storageRemove(PROFILE_STORAGE_KEY);
}

export function clearRuntimeSnapshotInExtensionStorage() {
  void storageRemove(RUNTIME_SNAPSHOT_STORAGE_KEY);
}

export function mirrorPeerPoliciesToExtensionStorage(policies: StoredPeerPolicy[]) {
  void storageSet(PEER_POLICIES_STORAGE_KEY, policies);
}

export function clearMirroredPeerPoliciesInExtensionStorage() {
  void storageRemove(PEER_POLICIES_STORAGE_KEY);
}

export async function loadExtensionProfile() {
  return (await storageGet<StoredExtensionProfile>(PROFILE_STORAGE_KEY)) ?? null;
}

export async function loadRuntimeSnapshot(profileKey: string) {
  const payload = await storageGet<{
    profileKey?: string;
    snapshotJson?: string;
    updatedAt?: number;
  }>(RUNTIME_SNAPSHOT_STORAGE_KEY);

  if (!payload || payload.profileKey !== profileKey || typeof payload.snapshotJson !== 'string') {
    return null;
  }

  return payload.snapshotJson;
}

export async function saveRuntimeSnapshot(profileKey: string, snapshotJson: string) {
  await storageSet(RUNTIME_SNAPSHOT_STORAGE_KEY, {
    profileKey,
    snapshotJson,
    updatedAt: Date.now()
  });
}

export async function clearRuntimeSnapshot() {
  await storageRemove(RUNTIME_SNAPSHOT_STORAGE_KEY);
}

export async function loadExtensionPeerPolicies() {
  return (await storageGet<StoredPeerPolicy[]>(PEER_POLICIES_STORAGE_KEY)) ?? [];
}

export async function loadPermissionPolicies() {
  return (await storageGet<StoredPermissionPolicy[]>(PERMISSIONS_STORAGE_KEY)) ?? [];
}

export async function clearPermissionPolicies() {
  await storageRemove(PERMISSIONS_STORAGE_KEY);
}

export async function removePermissionPolicy(target: StoredPermissionPolicy) {
  const existing = await loadPermissionPolicies();
  const next = existing.filter(
    (entry) =>
      !(
        entry.host === target.host &&
        entry.type === target.type &&
        entry.allow === target.allow &&
        entry.kind === target.kind &&
        entry.createdAt === target.createdAt
      )
  );
  await storageSet(PERMISSIONS_STORAGE_KEY, next);
}

export async function clearExtensionProfile() {
  await storageRemove(PROFILE_STORAGE_KEY);
  await storageRemove(RUNTIME_SNAPSHOT_STORAGE_KEY);
}

export async function savePermissionDecision(
  host: string,
  type: ProviderMethod,
  allow: boolean,
  params?: Record<string, unknown>,
  scope: 'forever' | 'kind' = 'forever'
) {
  const existing = await loadPermissionPolicies();
  const kind = scope === 'kind' ? extractEventKind(params) : undefined;
  const next = existing.filter(
    (entry) => !(entry.host === host && entry.type === type && entry.kind === kind)
  );
  next.push({
    host,
    type,
    allow,
    createdAt: Date.now(),
    kind
  });
  next.sort((a, b) => b.createdAt - a.createdAt);
  await storageSet(PERMISSIONS_STORAGE_KEY, next);
}

export async function resolvePermissionDecision(
  host: string,
  type: ProviderMethod,
  params?: Record<string, unknown>
) {
  const kind = extractEventKind(params);
  const policies = await loadPermissionPolicies();
  for (const policy of policies) {
    if (policy.host !== host || policy.type !== type) continue;
    if (typeof policy.kind === 'number' && policy.kind !== kind) continue;
    return policy.allow;
  }
  return null;
}
