import { getChromeApi } from '@/extension/chrome';
import {
  type ExtensionAppState,
  extractEventKind,
  type ActivationLifecycleState,
  type ActivationStage,
  type LifecycleFailure,
  type LifecycleSource,
  type LifecycleStatusSnapshot,
  type LifecycleTransitionRecord,
  type OnboardingLifecycleState,
  type OnboardingStage,
  type ProviderMethod,
  type StoredExtensionProfile,
  type StoredPeerPolicy,
  type StoredPermissionPolicy
} from '@/extension/protocol';

export const PROFILE_STORAGE_KEY = 'igloo.ext.profile';
export const PERMISSIONS_STORAGE_KEY = 'igloo.ext.permissions';
export const RUNTIME_SNAPSHOT_STORAGE_KEY = 'igloo.ext.runtimeSnapshot';
export const LIFECYCLE_STORAGE_KEY = 'igloo.ext.lifecycle';
export const LIFECYCLE_HISTORY_STORAGE_KEY = 'igloo.ext.lifecycleHistory';
export const APP_STATE_STORAGE_KEY = 'igloo.ext.appState';
const LIFECYCLE_HISTORY_LIMIT = 100;

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

export async function mirrorProfileToExtensionStorage(profile: StoredExtensionProfile) {
  await storageSet(PROFILE_STORAGE_KEY, profile);
}

export function clearMirroredProfileInExtensionStorage() {
  void storageRemove(PROFILE_STORAGE_KEY);
}

export function clearRuntimeSnapshotInExtensionStorage() {
  void storageRemove(RUNTIME_SNAPSHOT_STORAGE_KEY);
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

function now() {
  return Date.now();
}

function defaultOnboardingLifecycle(): OnboardingLifecycleState {
  return {
    stage: 'idle',
    updatedAt: null,
    lastError: null
  };
}

function defaultActivationLifecycle(): ActivationLifecycleState {
  return {
    stage: 'idle',
    updatedAt: null,
    lastError: null,
    restoredFromSnapshot: false,
    runtime: 'cold'
  };
}

export function defaultLifecycleStatusSnapshot(): LifecycleStatusSnapshot {
  return {
    onboarding: defaultOnboardingLifecycle(),
    activation: defaultActivationLifecycle()
  };
}

export function defaultExtensionAppState(): ExtensionAppState {
  return {
    configured: false,
    profile: null,
    lifecycle: defaultLifecycleStatusSnapshot(),
    runtime: {
      phase: 'cold',
      summary: null,
      metadata: null,
      readiness: null,
      peerStatus: [],
      pendingOperations: [],
      snapshot: null,
      snapshotError: null,
      lifecycle: {
        bootMode: 'unknown',
        reason: null,
        updatedAt: null
      },
      lastError: null
    },
    permissionPolicies: [],
    pendingPrompts: 0
  };
}

export async function loadExtensionAppState(): Promise<ExtensionAppState> {
  return (await storageGet<ExtensionAppState>(APP_STATE_STORAGE_KEY)) ?? defaultExtensionAppState();
}

export async function saveExtensionAppState(state: ExtensionAppState): Promise<void> {
  await storageSet(APP_STATE_STORAGE_KEY, state);
}

export async function loadLifecycleStatus(): Promise<LifecycleStatusSnapshot> {
  return (await storageGet<LifecycleStatusSnapshot>(LIFECYCLE_STORAGE_KEY)) ?? defaultLifecycleStatusSnapshot();
}

async function saveLifecycleStatus(next: LifecycleStatusSnapshot): Promise<void> {
  await storageSet(LIFECYCLE_STORAGE_KEY, next);
}

export async function loadLifecycleHistory(): Promise<LifecycleTransitionRecord[]> {
  return (await storageGet<LifecycleTransitionRecord[]>(LIFECYCLE_HISTORY_STORAGE_KEY)) ?? [];
}

async function appendLifecycleHistory(entry: LifecycleTransitionRecord) {
  const existing = await loadLifecycleHistory();
  existing.push(entry);
  if (existing.length > LIFECYCLE_HISTORY_LIMIT) {
    existing.splice(0, existing.length - LIFECYCLE_HISTORY_LIMIT);
  }
  await storageSet(LIFECYCLE_HISTORY_STORAGE_KEY, existing);
}

export async function clearLifecycleStatus() {
  await storageRemove(LIFECYCLE_STORAGE_KEY);
  await storageRemove(LIFECYCLE_HISTORY_STORAGE_KEY);
}

type LifecycleDetail = Record<string, unknown> | undefined;

export async function updateOnboardingLifecycle(
  stage: OnboardingStage,
  source: LifecycleSource,
  detail?: LifecycleDetail,
  failure?: LifecycleFailure | null
) {
  const current = await loadLifecycleStatus();
  const updatedAt = now();
  const next: LifecycleStatusSnapshot = {
    ...current,
    onboarding: {
      stage,
      updatedAt,
      lastError: failure ?? (stage === 'failed' ? current.onboarding.lastError : null)
    }
  };
  await saveLifecycleStatus(next);
  await appendLifecycleHistory({
    domain: 'onboarding',
    stage,
    source,
    ts: updatedAt,
    detail,
    failure: failure ?? null
  });
}

export async function updateActivationLifecycle(
  stage: ActivationStage,
  source: LifecycleSource,
  runtime: ActivationLifecycleState['runtime'],
  detail?: LifecycleDetail,
  overrides?: Partial<Pick<ActivationLifecycleState, 'restoredFromSnapshot' | 'lastError'>>
) {
  const current = await loadLifecycleStatus();
  const updatedAt = now();
  const next: LifecycleStatusSnapshot = {
    ...current,
    activation: {
      stage,
      updatedAt,
      lastError:
        overrides && 'lastError' in overrides
          ? overrides.lastError ?? null
          : stage === 'failed'
            ? current.activation.lastError
            : null,
      restoredFromSnapshot:
        overrides?.restoredFromSnapshot ?? current.activation.restoredFromSnapshot,
      runtime
    }
  };
  await saveLifecycleStatus(next);
  await appendLifecycleHistory({
    domain: 'activation',
    stage,
    source,
    ts: updatedAt,
    detail,
    failure: next.activation.lastError
  });
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
  await storageRemove(APP_STATE_STORAGE_KEY);
  await clearLifecycleStatus();
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
