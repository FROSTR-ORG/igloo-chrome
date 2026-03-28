import { getChromeApi } from '@/extension/chrome';
import {
  MESSAGE_TYPE,
  OFFSCREEN_DOCUMENT_PATH,
  PROMPT_DOCUMENT_PATH,
  PROMPT_HEIGHT,
  PROMPT_WIDTH,
  getPermissionLabel,
  isProviderMethod,
  isRecord,
  type ExtensionAppState,
  type RuntimeLifecycleStatus,
  type RuntimeMetadata,
  type RuntimePendingOperation,
  type RuntimePeerStatus,
  type RuntimePhase,
  type RuntimeReadiness,
  type RuntimeSnapshotDetails,
  type RuntimeStatusDetails,
  type RuntimeStatusSummary,
  type StoredProfileSummary,
  type StoredExtensionProfile,
  type PendingOnboardingProfile,
  type PromptResponseMessage,
  type ProviderMethod,
  type ProviderRequestEnvelope
} from '@/extension/protocol';
import {
  loadActiveProfileId,
  loadStoredProfileRecord,
  loadStoredProfileRecords,
  loadLifecycleHistory,
  loadLifecycleStatus,
  loadUnlockedProfileKey,
  loadPermissionPolicies,
  resolvePermissionDecision,
  deleteStoredProfileRecord,
  saveExtensionAppState,
  savePermissionDecision,
  saveStoredProfileRecord,
  saveUnlockedProfileKey,
  clearUnlockedProfileKeys,
  setActiveProfileId,
  updateOnboardingLifecycle,
  updateActivationLifecycle
} from '@/extension/storage';
import { createLogger } from '@/lib/observability';
import { normalizeSignerSettings } from '@/lib/signer-settings';
import type { LifecycleFailure } from '@/extension/protocol';
import {
  DEFAULT_RELAYS,
  groupPublicKeyFromPackage,
  normalizeRelays,
} from '@/lib/igloo';
import {
  decryptLocalProfileBlobWithPassword,
  decryptLocalProfileBlobWithSessionKey,
  encryptLocalProfileBlobPayload,
  reencryptLocalProfileBlobWithSessionKey,
  type LocalProfileBlobPayload,
  type LocalProfileBlobRecord
} from '@/lib/profile-blob';
import { getPublicKey } from 'nostr-tools';

type PromptState = {
  request: ProviderRequestEnvelope;
  resolve: (allow: boolean) => void;
  windowId?: number;
};

type RuntimeSnapshotResult = {
  runtime: RuntimePhase;
  snapshot: RuntimeSnapshotDetails | null;
  snapshotError: string | null;
  lifecycle?: RuntimeLifecycleStatus;
};

type RuntimeStatusResult = {
  runtime: RuntimePhase;
  status: RuntimeStatusSummary | null;
};

type RuntimeDiagnosticsResult = {
  runtime: RuntimePhase;
  diagnostics: unknown[];
  dropped: number;
  runtimeStatus?: RuntimeStatusSummary | null;
};

type ImportedProfilePayloadResult = {
  profilePayload: LocalProfileBlobPayload['profile'];
};

const pendingPrompts = new Map<string, PromptState>();
const promptWindowMap = new Map<number, string>();
let creatingOffscreen: Promise<void> | null = null;
let waitingForOffscreenReady: Promise<void> | null = null;
let ensuringConfiguredRuntime: Promise<void> | null = null;
let offscreenCreatedWithoutContextApi = false;
const OFFSCREEN_RUNTIME_ENSURE_TIMEOUT_MS = 10_000;
const OFFSCREEN_LONG_RPC_TIMEOUT_MS = 10_000;
const OFFSCREEN_DEFAULT_RPC_TIMEOUT_MS = 5_000;
let lastRuntimeStatusCache: RuntimeStatusResult = {
  runtime: 'cold',
  status: null
};
const logger = createLogger('igloo.background');

function hexToBytes(hex: string) {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Invalid share secret.');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function publicKeyFromSecret(secretHex: string) {
  return getPublicKey(hexToBytes(secretHex)).toLowerCase();
}

function toErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return fallback;
}

function activationFailure(
  code: LifecycleFailure['code'],
  message: string,
  source: LifecycleFailure['source'] = 'background'
): LifecycleFailure {
  return {
    code,
    message,
    source,
    updatedAt: Date.now()
  };
}

function profileKey(profile: {
  groupPublicKey?: string;
  publicKey?: string;
  relays: string[];
}) {
  const groupPublicKey =
    typeof profile.groupPublicKey === 'string' && profile.groupPublicKey.trim()
      ? profile.groupPublicKey
      : typeof profile.publicKey === 'string' && profile.publicKey.trim()
        ? profile.publicKey
        : undefined;
  return JSON.stringify({
    groupPublicKey: groupPublicKey?.trim().toLowerCase(),
    relays: profile.relays.map((relay) => relay.trim())
  });
}

async function normalizeProfileInput(profile: StoredExtensionProfile): Promise<StoredExtensionProfile> {
  const { relays } = normalizeRelays(profile.relays?.length ? profile.relays : DEFAULT_RELAYS);
  const sharePublicKey = profile.sharePublicKey?.trim().toLowerCase() || undefined;
  const id = profile.id?.trim().toLowerCase();
  if (!id) {
    throw new Error('Profile is missing an id.');
  }
  return {
    ...profile,
    id,
    relays,
    groupName: profile.groupName?.trim() || undefined,
    groupPublicKey: profile.groupPublicKey?.trim().toLowerCase() || undefined,
    sharePublicKey,
    publicKey: profile.publicKey?.trim().toLowerCase() || undefined,
    peerPubkey: profile.peerPubkey?.trim().toLowerCase() || undefined,
    signerSettings: normalizeSignerSettings(profile.signerSettings)
  };
}

function storedProfileSummaryFromRecord(
  record: LocalProfileBlobRecord,
  unlockedProfileIds: Set<string>
): StoredProfileSummary {
  return {
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    unlocked: unlockedProfileIds.has(record.id)
  };
}

function toRuntimeProfile(payload: LocalProfileBlobPayload): StoredExtensionProfile {
  const relays = normalizeRelays(payload.profile.device.relays?.length ? payload.profile.device.relays : DEFAULT_RELAYS)
    .relays;
  const sharePublicKey = publicKeyFromSecret(payload.profile.device.shareSecret);
  return {
    id: payload.profile.profileId,
    groupName: payload.profile.groupPackage.groupName?.trim() || undefined,
    relays,
    groupPublicKey: groupPublicKeyFromPackage(payload.profile.groupPackage),
    publicKey: groupPublicKeyFromPackage(payload.profile.groupPackage),
    sharePublicKey,
    peerPubkey: payload.peerPubkey?.trim().toLowerCase() || undefined,
    signerSettings: normalizeSignerSettings(payload.signerSettings),
    runtimeSnapshotJson:
      typeof payload.runtimeSnapshotJson === 'string' && payload.runtimeSnapshotJson.trim().length > 0
        ? payload.runtimeSnapshotJson
        : undefined
  };
}

async function rejectDuplicateProfileId(profileId: string) {
  const existing = await loadStoredProfileRecords();
  if (existing.some((entry) => entry.id === profileId)) {
    throw new Error('Device profile already exists.');
  }
}

async function loadUnlockedRuntimeProfile(profileId: string) {
  const [record, sessionKeyB64] = await Promise.all([
    loadStoredProfileRecord(profileId),
    loadUnlockedProfileKey(profileId)
  ]);
  if (!record) {
    throw new Error('Selected profile was not found.');
  }
  if (!sessionKeyB64) {
    return {
      record,
      payload: null,
      runtimeProfile: null,
      sessionKeyB64: null
    };
  }
  const payload = await decryptLocalProfileBlobWithSessionKey(record.blob, sessionKeyB64);
  return {
    record,
    payload,
    runtimeProfile: toRuntimeProfile(payload),
    sessionKeyB64
  };
}

async function loadProfileForReplacement(profileId: string, password?: string | null) {
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
    sessionKeyB64: decrypted.sessionKeyB64
  };
}

async function loadActiveRuntimeProfile() {
  const activeProfileId = await loadActiveProfileId();
  if (!activeProfileId) {
    return null;
  }
  const unlocked = await loadUnlockedRuntimeProfile(activeProfileId);
  if (!unlocked.runtimeProfile) {
    return null;
  }
  return {
    activeProfileId,
    ...unlocked
  };
}

async function createStoredProfileRecord(
  payload: LocalProfileBlobPayload,
  password: string
) {
  const normalizedPayload: LocalProfileBlobPayload = {
    ...payload,
    signerSettings: normalizeSignerSettings(payload.signerSettings),
    profile: {
      ...payload.profile,
      device: {
        ...payload.profile.device,
        name: payload.profile.device.name.trim(),
        relays: normalizeRelays(payload.profile.device.relays?.length ? payload.profile.device.relays : DEFAULT_RELAYS)
          .relays
      }
    },
    peerPubkey: payload.peerPubkey?.trim().toLowerCase() || undefined,
    runtimeSnapshotJson:
      typeof payload.runtimeSnapshotJson === 'string' && payload.runtimeSnapshotJson.trim().length > 0
        ? payload.runtimeSnapshotJson
        : undefined
  };
  const { blob, sessionKeyB64 } = await encryptLocalProfileBlobPayload(normalizedPayload, password);
  const now = Date.now();
  return {
    record: {
      id: normalizedPayload.profile.profileId,
      label: normalizedPayload.profile.device.name,
      blob,
      createdAt: now,
      updatedAt: now
    } satisfies LocalProfileBlobRecord,
    sessionKeyB64,
    runtimeProfile: toRuntimeProfile(normalizedPayload),
    payload: normalizedPayload
  };
}

async function storeProfileBlobAndUnlock(payload: LocalProfileBlobPayload, password: string) {
  await rejectDuplicateProfileId(payload.profile.profileId);
  const created = await createStoredProfileRecord(payload, password);
  await saveStoredProfileRecord(created.record);
  await saveUnlockedProfileKey(created.record.id, created.sessionKeyB64);
  await setActiveProfileId(created.record.id);
  return created;
}

async function updateStoredProfileBlob(
  profileId: string,
  payload: LocalProfileBlobPayload,
  sessionKeyB64: string
) {
  const existing = await loadStoredProfileRecord(profileId);
  if (!existing) {
    throw new Error('Selected profile was not found.');
  }
  const blob = await reencryptLocalProfileBlobWithSessionKey(payload, sessionKeyB64, existing.blob);
  const nextRecord: LocalProfileBlobRecord = {
    ...existing,
    label: payload.profile.device.name,
    blob,
    updatedAt: Date.now()
  };
  await saveStoredProfileRecord(nextRecord);
  return nextRecord;
}

async function replaceStoredProfileBlob(input: {
  targetProfileId: string;
  nextPayload: LocalProfileBlobPayload;
  sessionKeyB64: string;
  existingRecord: LocalProfileBlobRecord;
  activate: boolean;
  activationSource: 'apply_rotation_update';
}) {
  await rejectDuplicateProfileId(input.nextPayload.profile.profileId);
  const blob = await reencryptLocalProfileBlobWithSessionKey(
    input.nextPayload,
    input.sessionKeyB64,
    input.existingRecord.blob
  );
  const nextRecord: LocalProfileBlobRecord = {
    id: input.nextPayload.profile.profileId,
    label: input.nextPayload.profile.device.name,
    blob,
    createdAt: input.existingRecord.createdAt,
    updatedAt: Date.now()
  };
  await saveStoredProfileRecord(nextRecord);
  await saveUnlockedProfileKey(nextRecord.id, input.sessionKeyB64);
  await deleteStoredProfileRecord(input.targetProfileId);
  await setActiveProfileId(nextRecord.id);

  const runtimeProfile = toRuntimeProfile(input.nextPayload);
  if (input.activate) {
    lastRuntimeStatusCache = { runtime: 'cold', status: null };
    await ensureRuntimeForBuiltProfile(
      {
        profile: runtimeProfile,
        runtimeProfile,
        localPayload: input.nextPayload,
        restored:
          typeof runtimeProfile.runtimeSnapshotJson === 'string' &&
          runtimeProfile.runtimeSnapshotJson.trim().length > 0
      },
      input.activationSource
    );
  }

  return runtimeProfile;
}

function responseOk(result: unknown) {
  return { ok: true, result };
}

function responseError(error: unknown) {
  return { ok: false, error: toErrorMessage(error) };
}

function peerPermissionStatesFromStatus(status: RuntimeStatusSummary | null) {
  return status?.peer_permission_states ?? [];
}

function toStatusSnapshot(state: ExtensionAppState) {
  return {
    configured: state.configured,
    groupName: state.profile?.groupName ?? null,
    publicKey:
      state.runtime.metadata?.group_public_key ??
      state.profile?.groupPublicKey ??
      state.profile?.publicKey ??
      null,
    sharePublicKey:
      state.runtime.metadata?.share_public_key ?? state.profile?.sharePublicKey ?? null,
    relays: state.profile?.relays ?? [],
    runtime: state.runtime.phase,
    pendingPrompts: state.pendingPrompts,
    lifecycle: state.lifecycle,
    runtimeDetails: {
      status: state.runtime.summary?.status ?? null,
      summary: state.runtime.summary,
      snapshot: state.runtime.snapshot,
      snapshotError: state.runtime.snapshotError,
      peerStatus: state.runtime.peerStatus,
      metadata: state.runtime.metadata,
      readiness: state.runtime.readiness,
      lifecycle: state.runtime.lifecycle
    }
  };
}

async function buildAppState(): Promise<ExtensionAppState> {
  const [activeProfile, records, activeProfileId, lifecycle, permissionPolicies] = await Promise.all([
    loadActiveRuntimeProfile(),
    loadStoredProfileRecords(),
    loadActiveProfileId(),
    loadLifecycleStatus(),
    loadPermissionPolicies()
  ]);
  const unlockedProfileIds = new Set(
    (await Promise.all(records.map(async (record) => ((await loadUnlockedProfileKey(record.id)) ? record.id : null)))).filter(
      (value): value is string => !!value
    )
  );
  const profile = activeProfile?.runtimeProfile ?? null;

  return {
    configured: !!profile,
    profile,
    profiles: records.map((record) => storedProfileSummaryFromRecord(record, unlockedProfileIds)),
    activeProfileId,
    lifecycle,
    runtime: {
      phase: lastRuntimeStatusCache.runtime,
      summary: lastRuntimeStatusCache.status,
      metadata: lastRuntimeStatusCache.status?.metadata ?? null,
      readiness: lastRuntimeStatusCache.status?.readiness ?? null,
      peerStatus: lastRuntimeStatusCache.status?.peers ?? [],
      pendingOperations: lastRuntimeStatusCache.status?.pending_operations ?? [],
      snapshot: null,
      snapshotError: null,
      lifecycle: {
        bootMode: 'unknown',
        reason: null,
        updatedAt: null
      },
      lastError:
        lifecycle.activation.lastError?.message ?? lifecycle.onboarding.lastError?.message ?? null
    },
    permissionPolicies,
    pendingPrompts: pendingPrompts.size
  };
}

async function publishAppStateUpdated() {
  const next = await buildAppState();
  await saveExtensionAppState(next).catch(() => undefined);
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    return next;
  }
  try {
    await chromeApi.runtime.sendMessage({
      type: MESSAGE_TYPE.APP_STATE_UPDATED,
      state: next
    });
  } catch {
    // Ignore listenerless broadcasts.
  }
  return next;
}

async function hasOffscreenDocument() {
  const chromeApi = getChromeApi();
  const getContexts = chromeApi?.runtime?.getContexts;
  const getURL = chromeApi?.runtime?.getURL;
  if (typeof getContexts !== 'function' || typeof getURL !== 'function') {
    return offscreenCreatedWithoutContextApi;
  }

  const contexts = await getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  return contexts.length > 0;
}

function isSingleOffscreenDocumentError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes('only a single offscreen document may be created');
}

async function ensureOffscreenDocument() {
  const chromeApi = getChromeApi();
  if (!chromeApi?.offscreen?.createDocument) {
    const failure = activationFailure('offscreen_unavailable', 'Offscreen document APIs are unavailable');
    await updateActivationLifecycle('failed', 'background', 'cold', undefined, {
      lastError: failure
    }).catch(() => undefined);
    throw new Error(failure.message);
  }
  if (await hasOffscreenDocument()) {
    await updateActivationLifecycle('waiting_offscreen_ready', 'background', 'restoring').catch(
      () => undefined
    );
    try {
      await waitForOffscreenReady();
      return;
    } catch (error) {
      logger.warn('offscreen', 'stale_document_recreate', {
        error_message: toErrorMessage(error)
      });
      await closeOffscreenDocument().catch(() => undefined);
    }
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  await updateActivationLifecycle('creating_offscreen', 'background', 'restoring').catch(() => undefined);
  creatingOffscreen = chromeApi.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['DOM_PARSER'],
      justification:
        'Host the bifrost-rs WASM runtime and future long-lived relay sessions outside the MV3 service worker.'
    })
    .then(() => {
      logger.info('offscreen', 'document_created', {
        path: OFFSCREEN_DOCUMENT_PATH
      });
      offscreenCreatedWithoutContextApi = true;
    })
    .catch(async (error) => {
      if (isSingleOffscreenDocumentError(error)) {
        logger.warn('offscreen', 'document_already_exists_during_create', {
          error_message: toErrorMessage(error)
        });
        offscreenCreatedWithoutContextApi = true;
        return;
      }
      throw error;
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  await creatingOffscreen;
  await updateActivationLifecycle('waiting_offscreen_ready', 'background', 'restoring').catch(() => undefined);
  await waitForOffscreenReady();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOffscreenRpc<T>(rpcType: string, payload?: Record<string, unknown>) {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error('Extension runtime messaging is unavailable');
  }

  const timeoutMs =
    rpcType === 'runtime.ensure' ||
    rpcType === 'nostr.execute' ||
    rpcType === 'runtime.prepare_sign' ||
    rpcType === 'runtime.prepare_ecdh'
      ? OFFSCREEN_LONG_RPC_TIMEOUT_MS
      : OFFSCREEN_DEFAULT_RPC_TIMEOUT_MS;

  const response = (await Promise.race([
    chromeApi.runtime.sendMessage({
      type: MESSAGE_TYPE.OFFSCREEN_RPC,
      rpcType,
      payload
    }),
    sleep(timeoutMs).then(() => {
      throw new Error(`Timed out waiting for offscreen RPC: ${rpcType}`);
    })
  ])) as { ok?: boolean; result?: T; error?: string } | undefined;

  if (!response?.ok) {
    throw new Error(response?.error || 'Offscreen document did not respond');
  }

  return response.result as T;
}

async function waitForOffscreenReady() {
  if (waitingForOffscreenReady) {
    await waitingForOffscreenReady;
    return;
  }

  waitingForOffscreenReady = Promise.resolve().then(async () => {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await sendOffscreenRpc('offscreen.ping');
        logger.info('offscreen', 'document_ready', {
          attempts: attempt
        });
        return;
      } catch (error) {
        await sleep(100);
      }
    }

    throw new Error('Offscreen document did not become ready in time');
  }).finally(() => {
    waitingForOffscreenReady = null;
  });

  await waitingForOffscreenReady;
}

async function closeOffscreenDocument() {
  const chromeApi = getChromeApi();
  if (!chromeApi?.offscreen?.closeDocument) return;
  try {
    if (await hasOffscreenDocument()) {
      logger.info('offscreen', 'document_close_requested');
      const profile = (await loadActiveRuntimeProfile())?.runtimeProfile ?? null;
      const snapshotResult = await callOffscreen<RuntimeSnapshotResult>('runtime.snapshot').catch(
        () => null
      );
      if (
        profile &&
        snapshotResult?.runtime === 'ready' &&
        snapshotResult.snapshot &&
        snapshotResult.snapshotError === null
      ) {
        logger.info('runtime', 'snapshot_persist_before_close', {
          profile_key: profileKey(profile)
        });
        await callOffscreen('runtime.persist_snapshot', {
          profileId: profile.id,
          snapshotJson: JSON.stringify(snapshotResult.snapshot)
        }).catch(() => undefined);
      }
    }
    await chromeApi.offscreen.closeDocument();
  } finally {
    logger.info('offscreen', 'document_closed');
    offscreenCreatedWithoutContextApi = false;
    creatingOffscreen = null;
    waitingForOffscreenReady = null;
    lastRuntimeStatusCache = { runtime: 'cold', status: null };
  }
}

async function callOffscreen<T>(rpcType: string, payload?: Record<string, unknown>) {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error('Extension runtime messaging is unavailable');
  }

  await ensureOffscreenDocument();

  try {
    return await sendOffscreenRpc<T>(rpcType, payload);
  } catch (error) {
    logger.warn('offscreen', 'rpc_failed', {
      rpc_type: rpcType,
      error_message: toErrorMessage(error)
    });
    throw error;
  }
}

async function buildRuntimeProfile() {
  const activeProfile = await loadActiveRuntimeProfile();
  if (!activeProfile) return null;
  return {
    profile: activeProfile.runtimeProfile,
    runtimeProfile: activeProfile.runtimeProfile,
    localPayload: activeProfile.payload,
    restored:
      typeof activeProfile.runtimeProfile.runtimeSnapshotJson === 'string' &&
      activeProfile.runtimeProfile.runtimeSnapshotJson.trim().length > 0
  };
}

async function ensureConfiguredRuntime(reason: string) {
  if (ensuringConfiguredRuntime) {
    await ensuringConfiguredRuntime;
    return;
  }

  ensuringConfiguredRuntime = Promise.resolve()
    .then(async () => {
      const built = await buildRuntimeProfile();
      if (!built) {
        await updateActivationLifecycle('idle', 'background', 'cold', {
          reason,
          configured: false
        }).catch(() => undefined);
        await publishAppStateUpdated();
        return;
      }

      await ensureRuntimeForBuiltProfile(built, reason);
      await publishAppStateUpdated();
    })
    .catch((error) => {
      const failure = activationFailure('status_sync_failed', toErrorMessage(error));
      void updateActivationLifecycle('failed', 'background', 'cold', {
        reason
      }, {
        lastError: failure
      }).catch(() => undefined);
      logger.warn('runtime', 'autostart_failed', {
        reason,
        error_message: toErrorMessage(error)
      });
      void publishAppStateUpdated();
      throw error;
    })
    .finally(() => {
      ensuringConfiguredRuntime = null;
    });

  await ensuringConfiguredRuntime;
}

async function ensureRuntimeForBuiltProfile(
  built: NonNullable<Awaited<ReturnType<typeof buildRuntimeProfile>>>,
  reason: string
) {
  logger.info('runtime', 'ensure_begin', {
    reason,
    profile_id: built.profile.id,
    has_runtime_snapshot_json:
      typeof built.runtimeProfile.runtimeSnapshotJson === 'string' &&
      built.runtimeProfile.runtimeSnapshotJson.trim().length > 0,
    restored: built.restored
  });
  await updateActivationLifecycle('ensuring_offscreen', 'background', 'restoring', {
    reason
  }).catch(() => undefined);
  await Promise.race([
    ensureOffscreenDocument(),
    sleep(10_000).then(() => {
      throw new Error('Timed out ensuring offscreen document');
    })
  ]);

  await updateActivationLifecycle('calling_offscreen', 'background', 'restoring', {
    reason
  }).catch(() => undefined);
  logger.info('runtime', 'ensure_call_offscreen_begin', {
    reason,
    profile_id: built.profile.id,
    has_runtime_snapshot_json:
      typeof built.runtimeProfile.runtimeSnapshotJson === 'string' &&
      built.runtimeProfile.runtimeSnapshotJson.trim().length > 0
  });
  await callOffscreen('runtime.ensure', {
    profile: built.runtimeProfile,
    profilePayload: built.localPayload?.profile ?? null
  });
  logger.info('runtime', 'ensure_call_offscreen_ok', {
    reason,
    profile_id: built.profile.id
  });

  const runtimeStatus = await callOffscreen<{
    runtime: 'cold' | 'restoring' | 'ready' | 'degraded';
    status: RuntimeStatusSummary | null;
  }>('runtime.status').catch(() => ({
    runtime: 'restoring' as const,
    status: null
  }));
  lastRuntimeStatusCache = {
    runtime: runtimeStatus.runtime,
    status: runtimeStatus.status
  };

  await updateActivationLifecycle(
    runtimeStatus.runtime === 'ready'
      ? 'ready'
      : runtimeStatus.runtime === 'degraded'
        ? 'degraded'
        : runtimeStatus.runtime === 'restoring'
          ? 'restoring_runtime'
          : 'syncing_status',
    'background',
    runtimeStatus.runtime,
    {
      reason,
      restoredFromSnapshot: built.restored
    },
    {
      restoredFromSnapshot: built.restored
    }
  ).catch(() => undefined);

  logger.info('runtime', 'autostart_ready', {
    reason,
    profile_id: built.profile.id,
    profile_key: profileKey(built.profile),
    restored: built.restored
  });
}

async function reloadConfiguredRuntime(reason: string) {
  const profile = (await loadActiveRuntimeProfile())?.runtimeProfile ?? null;
  if (!profile) return;

  const status = await callOffscreen<{ runtime: 'cold' | 'restoring' | 'ready' | 'degraded' }>('runtime.status').catch(
    () => ({ runtime: 'cold' as const })
  );
  if (status.runtime === 'cold' || status.runtime === 'restoring') {
    return;
  }

  await callOffscreen('runtime.stop');
  await ensureConfiguredRuntime(reason);
}

async function executeProviderMethod(request: ProviderRequestEnvelope) {
  logger.info('provider', 'request_execute', {
    request_id: request.id,
    method: request.type,
    host: request.host
  });
  const built = await buildRuntimeProfile();
  if (!built) {
    throw new Error('Signer is not configured yet. Open the extension dashboard first.');
  }

  switch (request.type) {
    case MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY: {
      const publicKey =
        built.profile.groupPublicKey ??
        built.profile.publicKey ??
        built.profile.sharePublicKey ??
        null;
      if (!publicKey) {
        throw new Error('Signer is configured without a public key');
      }
      return publicKey;
    }
    case MESSAGE_TYPE.NOSTR_GET_RELAYS:
      return Object.fromEntries(
        built.profile.relays.map((relay) => [relay, { read: true, write: true }])
      );
    default:
      return await callOffscreen('nostr.execute', {
        profile: built.runtimeProfile,
        method: request.type,
        params: request.params ?? {}
      });
  }
}

async function getRuntimeDiagnostics() {
  return await callOffscreen<RuntimeDiagnosticsResult>('runtime.diagnostics');
}

async function requestPermission(request: ProviderRequestEnvelope) {
  const chromeApi = getChromeApi();
  const createWindow = chromeApi?.windows?.create;
  const getRuntimeUrl = chromeApi?.runtime?.getURL;
  if (!createWindow || !getRuntimeUrl) {
    throw new Error('Permission prompt is unavailable in this runtime');
  }

  const query = new URLSearchParams({
    id: request.id,
    host: request.host,
    type: request.type,
    label: getPermissionLabel(request.type),
    params: JSON.stringify(request.params ?? {})
  });

  return await new Promise<boolean>(async (resolve, reject) => {
    logger.info('permission', 'prompt_open', {
      request_id: request.id,
      method: request.type,
      host: request.host
    });
    pendingPrompts.set(request.id, { request, resolve });
    void publishAppStateUpdated();
    try {
      const created = await createWindow({
        url: `${getRuntimeUrl(PROMPT_DOCUMENT_PATH)}?${query.toString()}`,
        type: 'popup',
        width: PROMPT_WIDTH,
        height: PROMPT_HEIGHT
      });
      const pending = pendingPrompts.get(request.id);
      if (!pending) {
        reject(new Error('Permission request was cancelled'));
        return;
      }
      pending.windowId = created.id;
      if (typeof created.id === 'number') {
        promptWindowMap.set(created.id, request.id);
      }
    } catch (error) {
      pendingPrompts.delete(request.id);
      void publishAppStateUpdated();
      reject(error);
    }
  });
}

async function ensurePermission(request: ProviderRequestEnvelope) {
  const existing = await resolvePermissionDecision(request.host, request.type, request.params);
  if (existing !== null) return existing;
  return await requestPermission(request);
}

async function handleProviderRequest(request: ProviderRequestEnvelope) {
  await ensureOffscreenDocument();
  const allowed = await ensurePermission(request);
  if (!allowed) {
    logger.warn('permission', 'request_denied', {
      request_id: request.id,
      method: request.type,
      host: request.host
    });
    throw new Error('User denied the request');
  }
  logger.info('permission', 'request_allowed', {
    request_id: request.id,
    method: request.type,
    host: request.host
  });
  return await executeProviderMethod(request);
}

async function handlePromptResponse(message: PromptResponseMessage) {
  const chromeApi = getChromeApi();
  const pending = pendingPrompts.get(message.id);
  if (!pending) return;

  pendingPrompts.delete(message.id);
  void publishAppStateUpdated();
  if (typeof pending.windowId === 'number') {
    promptWindowMap.delete(pending.windowId);
  }

  if (message.scope !== 'once') {
    await savePermissionDecision(
      pending.request.host,
      pending.request.type,
      message.allow,
      pending.request.params,
      message.scope
    );
    void publishAppStateUpdated();
  }

  pending.resolve(message.allow);
  logger.info('permission', 'prompt_resolved', {
    request_id: message.id,
    scope: message.scope,
    allow: message.allow
  });

  if (typeof pending.windowId === 'number' && chromeApi?.windows?.remove) {
    try {
      await chromeApi.windows.remove(pending.windowId);
    } catch {
      // Ignore user-closed prompt windows.
    }
  }
}

async function getStatusSnapshot() {
  return toStatusSnapshot(await buildAppState());
}

const chromeApi = getChromeApi();

chromeApi?.runtime?.onInstalled?.addListener((details) => {
  logger.info('extension', 'installed', { reason: details.reason });
  if (details.reason === 'install') {
    void chromeApi.runtime?.openOptionsPage?.();
  }
  void publishAppStateUpdated().catch(() => undefined);
  void ensureConfiguredRuntime(`installed:${details.reason}`).catch(() => undefined);
});

chromeApi?.runtime?.onStartup?.addListener(() => {
  logger.info('extension', 'startup');
  void publishAppStateUpdated().catch(() => undefined);
  void ensureConfiguredRuntime('startup').catch(() => undefined);
});

void publishAppStateUpdated().catch(() => undefined);
void ensureConfiguredRuntime('service_worker_boot').catch(() => undefined);

chromeApi?.windows?.onRemoved?.addListener((windowId) => {
  const requestId = promptWindowMap.get(windowId);
  if (!requestId) return;
  promptWindowMap.delete(windowId);
  const pending = pendingPrompts.get(requestId);
  if (!pending) return;
  pendingPrompts.delete(requestId);
  void publishAppStateUpdated();
  logger.warn('permission', 'prompt_window_closed', { request_id: requestId, window_id: windowId });
  pending.resolve(false);
});

chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (!isRecord(message) || typeof message.type !== 'string') return;

  if (message.type === MESSAGE_TYPE.GET_APP_STATE) {
    void buildAppState()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.PROVIDER_REQUEST) {
    const request = message.request;
    if (!isRecord(request) || !isProviderMethod(request.type)) {
      sendResponse(responseError(new Error('Invalid provider request payload')));
      return;
    }
    void handleProviderRequest(request as ProviderRequestEnvelope)
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.PROMPT_RESPONSE) {
    void handlePromptResponse(message as PromptResponseMessage)
      .then(() => sendResponse(responseOk(true)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.GET_STATUS) {
    void getStatusSnapshot()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.GET_RUNTIME_DIAGNOSTICS) {
    void Promise.all([
      getRuntimeDiagnostics(),
      loadLifecycleStatus(),
      loadLifecycleHistory()
    ])
      .then(([result, lifecycle, lifecycleHistory]) =>
        sendResponse(responseOk({
          ...result,
          lifecycle,
          lifecycleHistory
        }))
      )
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.GET_RUNTIME_CONFIG) {
    void (async () => {
      const profile = (await loadActiveRuntimeProfile())?.runtimeProfile ?? null;
      const status =
        lastRuntimeStatusCache.runtime === 'ready' || lastRuntimeStatusCache.runtime === 'degraded'
          ? await callOffscreen<{ runtime: 'cold' | 'restoring' | 'ready' | 'degraded' }>('runtime.status')
          : { runtime: lastRuntimeStatusCache.runtime };
      if (status.runtime === 'ready' || status.runtime === 'degraded') {
        return await callOffscreen('runtime.read_config');
      }
      return normalizeSignerSettings(profile?.signerSettings);
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.UPDATE_RUNTIME_PEER_POLICY) {
    const pubkey = typeof message.pubkey === 'string' ? message.pubkey.trim().toLowerCase() : '';
    const patch = isRecord(message.patch) ? message.patch : null;
    if (
      !pubkey ||
      !patch ||
      (patch.direction !== 'request' && patch.direction !== 'respond') ||
      !['ping', 'onboard', 'sign', 'ecdh'].includes(String(patch.method)) ||
      !['unset', 'allow', 'deny'].includes(String(patch.value))
    ) {
      sendResponse(responseError(new Error('Invalid runtime peer policy update payload')));
      return true;
    }
    void callOffscreen<RuntimeStatusSummary>('runtime.update_peer_policy', {
      pubkey,
      patch
    })
      .then((status) => {
        lastRuntimeStatusCache = { ...lastRuntimeStatusCache, status };
        void publishAppStateUpdated();
        sendResponse(responseOk(peerPermissionStatesFromStatus(status)));
      })
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.CLEAR_RUNTIME_PEER_POLICY_OVERRIDES) {
    void callOffscreen<RuntimeStatusSummary>('runtime.clear_peer_policy_overrides')
      .then((status) => {
        lastRuntimeStatusCache = { ...lastRuntimeStatusCache, status };
        void publishAppStateUpdated();
        sendResponse(responseOk(peerPermissionStatesFromStatus(status)));
      })
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.RUNTIME_STATUS_UPDATED) {
    const runtime =
      message.runtime === 'cold' ||
      message.runtime === 'restoring' ||
      message.runtime === 'ready' ||
      message.runtime === 'degraded'
        ? message.runtime
        : 'cold';
    lastRuntimeStatusCache = {
      runtime,
      status: isRecord(message.status) ? (message.status as RuntimeStatusSummary) : null
    };
    void updateActivationLifecycle(
      runtime === 'ready'
        ? 'ready'
        : runtime === 'degraded'
          ? 'degraded'
          : runtime === 'restoring'
            ? 'restoring_runtime'
            : 'idle',
      'background',
      runtime
    ).catch(() => undefined);
    void publishAppStateUpdated();
    sendResponse(responseOk(true));
    return true;
  }

  if (message.type === MESSAGE_TYPE.START_ONBOARDING) {
    const input = isRecord(message.input) ? message.input : null;
    if (!input) {
      sendResponse(responseError(new Error('Invalid onboarding input')));
      return true;
    }
    void updateOnboardingLifecycle('decoding_package', 'background', {
      packageLength:
        typeof input.onboardPackage === 'string' ? input.onboardPackage.trim().length : 0
    })
      .catch(() => undefined)
      .then(() => publishAppStateUpdated().catch(() => undefined))
      .then(() =>
        callOffscreen<PendingOnboardingProfile>('onboarding.connect', {
          input
        })
      )
      .then(async (pendingProfile) => {
        await rejectDuplicateProfileId(pendingProfile.profilePayload.profileId);
        sendResponse(responseOk(pendingProfile));
      })
      .catch(async (error) => {
        await updateOnboardingLifecycle(
          'failed',
          'background',
          {
            packageLength:
              typeof input.onboardPackage === 'string' ? input.onboardPackage.trim().length : 0
          },
          activationFailure(
            /timed out/i.test(toErrorMessage(error)) ? 'onboard_timeout' : 'onboard_rejected',
            toErrorMessage(error),
            'background'
          )
        ).catch(() => undefined);
        await publishAppStateUpdated().catch(() => undefined);
        sendResponse(responseError(error));
      });
    return true;
  }

  if (message.type === MESSAGE_TYPE.COMPLETE_ONBOARDING) {
    const pendingProfile = isRecord(message.pendingProfile)
      ? (message.pendingProfile as PendingOnboardingProfile)
      : null;
    const label = typeof message.label === 'string' ? message.label.trim() : '';
    const password = typeof message.password === 'string' ? message.password : '';
    if (!pendingProfile || !label || !password) {
      sendResponse(responseError(new Error('Invalid onboarding completion payload')));
      return true;
    }
    void (async () => {
      const payload: LocalProfileBlobPayload = {
        version: 1,
        profile: {
          ...pendingProfile.profilePayload,
          device: {
            ...pendingProfile.profilePayload.device,
            name: label
          }
        },
        signerSettings: normalizeSignerSettings(pendingProfile.signerSettings),
        runtimeSnapshotJson: pendingProfile.runtimeSnapshotJson ?? undefined,
        peerPubkey: pendingProfile.peerPubkey ?? undefined
      };
      const created = await storeProfileBlobAndUnlock(payload, password);
      lastRuntimeStatusCache = { runtime: 'cold', status: null };
      await ensureRuntimeForBuiltProfile(
        {
          profile: created.runtimeProfile,
          runtimeProfile: created.runtimeProfile,
          localPayload: created.payload,
          restored:
            typeof created.runtimeProfile.runtimeSnapshotJson === 'string' &&
            created.runtimeProfile.runtimeSnapshotJson.trim().length > 0
        },
        'complete_onboarding'
      );
      await updateOnboardingLifecycle('idle', 'background', {
        profileId: created.runtimeProfile.id
      }).catch(() => undefined);
      await publishAppStateUpdated();
      return created.runtimeProfile;
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.COMPLETE_ROTATION_ONBOARDING) {
    const pendingProfile = isRecord(message.pendingProfile)
      ? (message.pendingProfile as PendingOnboardingProfile)
      : null;
    const targetProfileId =
      typeof message.targetProfileId === 'string' ? message.targetProfileId.trim().toLowerCase() : '';
    if (!pendingProfile || !targetProfileId) {
      sendResponse(responseError(new Error('Invalid rotation onboarding payload')));
      return true;
    }
    void (async () => {
      const target = await loadProfileForReplacement(targetProfileId, null);
      if (!target.payload || !target.sessionKeyB64) {
        throw new Error('Selected profile is locked.');
      }
      if (
        groupPublicKeyFromPackage(pendingProfile.profilePayload.groupPackage) !==
        groupPublicKeyFromPackage(target.payload.profile.groupPackage)
      ) {
        throw new Error('Rotation package does not match the selected profile group public key.');
      }
      if (pendingProfile.profilePayload.profileId === target.payload.profile.profileId) {
        throw new Error('Rotation package did not produce a new device profile id.');
      }
      const nextPayload: LocalProfileBlobPayload = {
        version: 1,
        profile: {
          ...pendingProfile.profilePayload,
          device: {
            ...pendingProfile.profilePayload.device,
            name: target.payload.profile.device.name,
          }
        },
        signerSettings: target.payload.signerSettings,
        peerPubkey: target.payload.peerPubkey,
        runtimeSnapshotJson: pendingProfile.runtimeSnapshotJson ?? undefined
      };
      const runtimeProfile = await replaceStoredProfileBlob({
        targetProfileId,
        nextPayload,
        sessionKeyB64: target.sessionKeyB64,
        existingRecord: target.record,
        activate: (await loadActiveProfileId()) === targetProfileId,
        activationSource: 'apply_rotation_update'
      });
      await publishAppStateUpdated();
      return runtimeProfile;
    })()
      .then((profile) => sendResponse(responseOk(profile)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.IMPORT_BFPROFILE) {
    const packageText =
      typeof message.packageText === 'string' ? message.packageText.trim() : '';
    const password = typeof message.password === 'string' ? message.password : '';
    if (!packageText || !password) {
      sendResponse(responseError(new Error('Invalid bfprofile import payload')));
      return true;
    }
    void (async () => {
      const imported = await callOffscreen<ImportedProfilePayloadResult>('profile.import_bfprofile_payload', {
        packageText,
        password
      });
      const payload: LocalProfileBlobPayload = {
        version: 1,
        profile: imported.profilePayload,
        signerSettings: normalizeSignerSettings()
      };
      const created = await storeProfileBlobAndUnlock(payload, password);
      lastRuntimeStatusCache = { runtime: 'cold', status: null };
      await ensureRuntimeForBuiltProfile(
        {
          profile: created.runtimeProfile,
          runtimeProfile: created.runtimeProfile,
          localPayload: created.payload,
          restored: false
        },
        'import_bfprofile'
      );
      await publishAppStateUpdated();
      return created.runtimeProfile;
    })()
      .then((profile) => sendResponse(responseOk(profile)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.RECOVER_BFSHARE) {
    const packageText =
      typeof message.packageText === 'string' ? message.packageText.trim() : '';
    const password = typeof message.password === 'string' ? message.password : '';
    if (!packageText || !password) {
      sendResponse(responseError(new Error('Invalid bfshare recovery payload')));
      return true;
    }
    void (async () => {
      const recovered = await callOffscreen<ImportedProfilePayloadResult>('profile.recover_bfshare_payload', {
        packageText,
        password
      });
      const payload: LocalProfileBlobPayload = {
        version: 1,
        profile: recovered.profilePayload,
        signerSettings: normalizeSignerSettings()
      };
      const created = await storeProfileBlobAndUnlock(payload, password);
      lastRuntimeStatusCache = { runtime: 'cold', status: null };
      await ensureRuntimeForBuiltProfile(
        {
          profile: created.runtimeProfile,
          runtimeProfile: created.runtimeProfile,
          localPayload: created.payload,
          restored: false
        },
        'recover_bfshare'
      );
      await publishAppStateUpdated();
      return created.runtimeProfile;
    })()
      .then((profile) => sendResponse(responseOk(profile)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.SAVE_PROFILE) {
    const profile = isRecord(message.profile) ? (message.profile as StoredExtensionProfile) : null;
    if (!profile) {
      sendResponse(responseError(new Error('Invalid profile payload')));
      return true;
    }
    void (async () => {
      const normalized = await normalizeProfileInput(profile);
      const active = await loadUnlockedRuntimeProfile(normalized.id);
      if (!active.payload || !active.sessionKeyB64) {
        throw new Error('Profile is locked.');
      }
      const nextPayload: LocalProfileBlobPayload = {
        ...active.payload,
        profile: {
          ...active.payload.profile,
          device: {
            ...active.payload.profile.device,
            name: normalized.groupName?.trim() || active.payload.profile.device.name,
            relays: normalized.relays
          }
        },
        signerSettings: normalizeSignerSettings(normalized.signerSettings),
        peerPubkey: normalized.peerPubkey ?? active.payload.peerPubkey ?? undefined,
        runtimeSnapshotJson: normalized.runtimeSnapshotJson ?? active.payload.runtimeSnapshotJson
      };
      await updateStoredProfileBlob(normalized.id, nextPayload, active.sessionKeyB64);
      await publishAppStateUpdated();
      return toRuntimeProfile(nextPayload);
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.CLEAR_PROFILE) {
    void (async () => {
      await callOffscreen('runtime.stop').catch(() => undefined);
      lastRuntimeStatusCache = { runtime: 'cold', status: null };
      await clearUnlockedProfileKeys();
      await setActiveProfileId(null);
      await publishAppStateUpdated();
      return true;
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.ACTIVATE_PROFILE) {
    const profileId = typeof message.profileId === 'string' ? message.profileId.trim().toLowerCase() : '';
    if (!profileId) {
      sendResponse(responseError(new Error('Invalid profile id')));
      return true;
    }
    void (async () => {
      const unlocked = await loadUnlockedRuntimeProfile(profileId);
      if (!unlocked.runtimeProfile) {
        throw new Error('Profile is locked.');
      }
      lastRuntimeStatusCache = { runtime: 'cold', status: null };
      await ensureRuntimeForBuiltProfile(
        {
          profile: unlocked.runtimeProfile,
          runtimeProfile: unlocked.runtimeProfile,
          localPayload: unlocked.payload,
          restored:
            typeof unlocked.runtimeProfile.runtimeSnapshotJson === 'string' &&
            unlocked.runtimeProfile.runtimeSnapshotJson.trim().length > 0
        },
          'activate_profile'
        );
      await setActiveProfileId(profileId);
      await publishAppStateUpdated();
      return unlocked.runtimeProfile;
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch(async (error) => {
        const failure = activationFailure('runtime_restore_failed', toErrorMessage(error));
        lastRuntimeStatusCache = { runtime: 'cold', status: null };
        await updateActivationLifecycle('failed', 'background', 'cold', {
          profileId
        }, {
          lastError: failure
        }).catch(() => undefined);
        await publishAppStateUpdated().catch(() => undefined);
        sendResponse(responseError(error));
      });
    return true;
  }

  if (message.type === MESSAGE_TYPE.UNLOCK_PROFILE) {
    const profileId = typeof message.profileId === 'string' ? message.profileId.trim().toLowerCase() : '';
    const password = typeof message.password === 'string' ? message.password : '';
    if (!profileId || !password) {
      sendResponse(responseError(new Error('Invalid profile unlock payload')));
      return true;
    }
    void (async () => {
      const record = await loadStoredProfileRecord(profileId);
      if (!record) {
        throw new Error('Selected profile was not found.');
      }
      let unlocked: Awaited<ReturnType<typeof decryptLocalProfileBlobWithPassword>>;
      try {
        unlocked = await decryptLocalProfileBlobWithPassword(record.blob, password);
      } catch {
        throw new Error('Invalid profile password.');
      }
      await saveUnlockedProfileKey(profileId, unlocked.sessionKeyB64);
      await setActiveProfileId(profileId);
      const runtimeProfile = toRuntimeProfile(unlocked.payload);
      lastRuntimeStatusCache = { runtime: 'cold', status: null };
      await ensureRuntimeForBuiltProfile(
        {
          profile: runtimeProfile,
          runtimeProfile,
          localPayload: unlocked.payload,
          restored:
            typeof runtimeProfile.runtimeSnapshotJson === 'string' &&
            runtimeProfile.runtimeSnapshotJson.trim().length > 0
        },
        'unlock_profile'
      );
      await publishAppStateUpdated();
      return runtimeProfile;
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.UPDATE_RUNTIME_CONFIG) {
    void callOffscreen('runtime.update_config', {
      settings: isRecord(message.settings) ? message.settings : {}
    })
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.OPEN_DASHBOARD) {
    const openOptionsPage = chromeApi?.runtime?.openOptionsPage;
    if (!openOptionsPage) {
      sendResponse(responseError(new Error('Options page is unavailable')));
      return;
    }
    void openOptionsPage()
      .then(() => sendResponse(responseOk(true)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.RUNTIME_CONTROL) {
    if (message.action === 'ensureConfiguredRuntime') {
      void ensureConfiguredRuntime('runtime_control')
        .then(() => sendResponse(responseOk(true)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'stopRuntime') {
      void callOffscreen('runtime.stop')
        .then(() => {
          lastRuntimeStatusCache = { runtime: 'cold', status: null };
          return updateActivationLifecycle('idle', 'background', 'cold').catch(() => undefined);
        })
        .then(() => {
          void publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'wipeRuntime') {
      void callOffscreen('runtime.wipe_state')
        .then((result) => {
          if (
            isRecord(result) &&
            (result.runtime === 'cold' ||
              result.runtime === 'restoring' ||
              result.runtime === 'ready' ||
              result.runtime === 'degraded')
          ) {
            lastRuntimeStatusCache = {
              runtime: result.runtime,
              status: lastRuntimeStatusCache.status
            };
          }
          void publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'reloadConfiguredRuntime') {
      void reloadConfiguredRuntime('runtime_control')
        .then(() => sendResponse(responseOk(true)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'refreshAllPeers') {
      void callOffscreen('runtime.refresh_all_peers')
        .then(() => {
          void publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'closeOffscreen') {
      void closeOffscreenDocument()
        .then(async () => {
          await updateActivationLifecycle('idle', 'background', 'cold').catch(() => undefined);
          await publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'reloadExtension') {
      sendResponse(responseOk(true));
      setTimeout(() => {
        try {
          chromeApi?.runtime?.reload?.();
        } catch {
          // Ignore reload failures in test control flow.
        }
      }, 0);
      return;
    }
    sendResponse(responseError(new Error('Unsupported runtime control action')));
    return;
  }
});
