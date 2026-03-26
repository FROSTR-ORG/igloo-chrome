import { getChromeApi } from '@/extension/chrome';
import { getPublicKey } from 'nostr-tools';
import {
  loadStoredProfileRecord,
  loadLifecycleHistory,
  loadLifecycleStatus,
  loadUnlockedProfileKey,
  saveStoredProfileRecord,
  updateOnboardingLifecycle,
  updateActivationLifecycle
} from '@/extension/storage';
import {
  MESSAGE_TYPE,
  isRecord,
  type LifecycleFailure,
  type PendingOnboardingProfile,
  type PolicyOverrideValue,
  type ProviderMethod,
  type StoredExtensionProfile
} from '@/extension/protocol';
import {
  connectOnboardingPackageAndCaptureProfile,
  connectSignerNode,
  decodeBfOnboardPackage,
  decodeBfProfilePackage,
  clearRuntimePeerPolicyOverridesOnNode,
  createSignerNode,
  deriveProfileIdFromShareSecret,
  deriveProfileIdFromSharePublicKey,
  recoverProfileFromSharePackage,
  getPublicKeyFromNode,
  getRuntimeConfigFromNode,
  getRuntimeSnapshot,
  getRuntimeStatus,
  groupPackageToWireJson,
  groupPublicKeyFromPackage,
  nip44DecryptWithNode,
  nip44EncryptWithNode,
  prepareEcdhOnNode,
  prepareSignOnNode,
  refreshAllPeersOnNode,
  updateRuntimePeerPolicyOverrideOnNode,
  signNostrEvent,
  stopSignerNode,
  updateRuntimeConfigOnNode,
  wipeRuntimeStateOnNode,
  type BrowserProfilePackagePayload,
  type NodeWithEvents,
  type RuntimeStatusSummary,
  xOnlyFromCompressedPubkey
} from '@/lib/igloo';
import {
  createLogger,
  createObservabilityBuffer,
  summarizeRuntimeLifecycle,
  type ObservabilityEvent
} from '@/lib/observability';
import { normalizeSignerSettings, type SignerSettings } from '@/lib/signer-settings';
import {
  decryptLocalProfileBlobWithSessionKey,
  reencryptLocalProfileBlobWithSessionKey
} from '@/lib/profile-blob';

type RuntimePhase = 'cold' | 'restoring' | 'ready' | 'degraded';

type RpcResult = {
  runtime: RuntimePhase;
};

type SignerSession = {
  key: string;
  node: NodeWithEvents;
  diagnostics: () => ObservabilityEvent[];
  droppedDiagnostics: () => number;
  detachDiagnostics: () => void;
};

type RuntimeLifecycleSummary = {
  bootMode: 'cold_boot' | 'restored' | 'unknown';
  reason: string | null;
  updatedAt: number | null;
};

const NONCE_SNAPSHOT_WAIT_TIMEOUT_MS = 5_000;
const NONCE_SNAPSHOT_POLL_INTERVAL_MS = 100;

let signerSessionPromise: Promise<SignerSession> | null = null;
let signerSessionKey: string | null = null;
let runtimePhase: RuntimePhase = 'cold';
const logger = createLogger('igloo.offscreen');
let pendingBootDiagnostics = createObservabilityBuffer(200);
const PROFILE_STORAGE_RETRY_TIMEOUT_MS = 10_000;
const PROFILE_STORAGE_RETRY_INTERVAL_MS = 100;
const RUNTIME_CONNECT_TIMEOUT_MS = 10_000;

function resetPendingBootDiagnostics() {
  pendingBootDiagnostics = createObservabilityBuffer(200);
}

function pushPendingBootLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  domain: string,
  event: string,
  detail?: Record<string, unknown>
) {
  const entry = logger[level](domain, event, detail);
  if (entry) {
    pendingBootDiagnostics.push(entry);
  }
}

function publicKeyFromSecret(secretHex: string) {
  const normalized = secretHex.trim().toLowerCase();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return getPublicKey(bytes).toLowerCase();
}

function normalizeHex32(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

function normalizeGroupMemberSharePublicKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  throw new Error('Invalid group member share public key.');
}

function groupJsonFromPayload(payload: BrowserProfilePackagePayload) {
  return groupPackageToWireJson(payload.groupPackage);
}

function shareJsonFromPayload(payload: BrowserProfilePackagePayload) {
  const sharePublicKey = publicKeyFromSecret(payload.device.shareSecret);
  const member =
    payload.groupPackage.members.find((candidate) => xOnlyFromCompressedPubkey(candidate.pubkey) === sharePublicKey) ??
    payload.groupPackage.members[0];
  return JSON.stringify(
    {
      idx: member?.idx ?? 1,
      seckey: payload.device.shareSecret,
    },
    null,
    2
  );
}

async function runtimePayloadFromSnapshot(args: {
  label: string;
  relays: string[];
  runtimeSnapshotJson: string;
}) {
  const snapshot = JSON.parse(args.runtimeSnapshotJson) as {
    bootstrap?: {
      group?: {
        group_pk?: string;
        threshold?: number;
        members?: Array<{ idx?: number; pubkey?: string }>;
      };
      share?: {
        seckey?: string;
      };
    };
  };
  const group = snapshot.bootstrap?.group;
  const share = snapshot.bootstrap?.share;
  const members =
    group?.members?.map((member) => ({
      idx: Math.trunc(member.idx ?? 0),
      pubkey: (() => {
        const normalized = (member.pubkey ?? '').trim().toLowerCase();
        if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
          return normalized;
        }
        return `02${normalizeGroupMemberSharePublicKey(member.pubkey ?? '')}`;
      })(),
    })) ?? [];
  const shareSecret = normalizeHex32(share?.seckey ?? '', 'share secret');
  const sharePublicKey = publicKeyFromSecret(shareSecret);

  return {
    profileId: await deriveProfileIdFromShareSecret(shareSecret),
    version: 1,
    device: {
      name: args.label.trim() || 'Onboarded device',
      shareSecret,
      manualPeerPolicyOverrides: members
        .filter((member) => xOnlyFromCompressedPubkey(member.pubkey) !== sharePublicKey)
        .map((member) => ({
          pubkey: xOnlyFromCompressedPubkey(member.pubkey),
          policy: {
            request: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
            respond: { echo: 'unset', ping: 'unset', onboard: 'unset', sign: 'unset', ecdh: 'unset' },
          },
        })),
      remotePeerPolicyObservations: [],
      relays: args.relays,
    },
    keysetName: args.label.trim() || 'Onboarded device',
    groupPackage: {
      groupPk: normalizeHex32(group?.group_pk ?? '', 'group public key'),
      threshold: Math.trunc(group?.threshold ?? 0),
      members,
    },
  } satisfies BrowserProfilePackagePayload;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

async function loadUnlockedProfileById(profileId: string, timeoutMs = PROFILE_STORAGE_RETRY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const [record, sessionKeyB64] = await Promise.all([
      loadStoredProfileRecord(profileId),
      loadUnlockedProfileKey(profileId)
    ]);
    if (record && sessionKeyB64) {
      const payload = await decryptLocalProfileBlobWithSessionKey(record.blob, sessionKeyB64);
      const profile: StoredExtensionProfile = {
        id: payload.profile.profileId,
        keysetName: payload.profile.keysetName,
        relays: payload.profile.device.relays,
        groupPublicKey: groupPublicKeyFromPackage(payload.profile.groupPackage),
        publicKey: groupPublicKeyFromPackage(payload.profile.groupPackage),
        sharePublicKey: publicKeyFromSecret(payload.profile.device.shareSecret),
        peerPubkey: payload.peerPubkey ?? undefined,
        signerSettings: normalizeSignerSettings(payload.signerSettings),
        runtimeSnapshotJson: payload.runtimeSnapshotJson ?? undefined
      };
      logger.info('runtime', 'stored_profile_found', {
        profile_id: profileId,
        attempts: attempt
      });
      return {
        record,
        payload,
        sessionKeyB64,
        profile
      };
    }
    await new Promise((resolve) => setTimeout(resolve, PROFILE_STORAGE_RETRY_INTERVAL_MS));
  }
  return null;
}

async function publishRuntimeStatusUpdate(status: RuntimeStatusSummary | null, runtime: RuntimePhase) {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) return;
  try {
    void signerSessionPromise?.catch(() => null);
    void chromeApi.runtime.sendMessage({
      type: MESSAGE_TYPE.RUNTIME_STATUS_UPDATED,
      runtime,
      status
    }).catch(() => undefined);
  } catch {
    // Ignore background delivery failures; consumers can recover from runtime.status.
  }
}

async function loadPersistedRuntimeSnapshot(profileKey: string) {
  return null;
}

async function savePersistedRuntimeSnapshot(profileId: string, snapshotJson: string) {
  const unlocked = await loadUnlockedProfileById(profileId);
  if (!unlocked) {
    throw new Error(`Stored profile ${profileId} was not found or unlocked.`);
  }
  const nextPayload = {
    ...unlocked.payload,
    runtimeSnapshotJson: snapshotJson
  };
  const nextBlob = await reencryptLocalProfileBlobWithSessionKey(
    nextPayload,
    unlocked.sessionKeyB64,
    unlocked.record.blob
  );
  await saveStoredProfileRecord({
    ...unlocked.record,
    blob: nextBlob,
    updatedAt: Date.now()
  });
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
  source: LifecycleFailure['source'] = 'offscreen'
): LifecycleFailure {
  return {
    code,
    message,
    source,
    updatedAt: Date.now()
  };
}

function profileKey(profile: StoredExtensionProfile) {
  return profile.id.trim().toLowerCase();
}

async function stopSignerSession() {
  const existing = signerSessionPromise;
  signerSessionPromise = null;
  signerSessionKey = null;
  runtimePhase = 'cold';

  const session = await existing?.catch(() => null);
  if (session) {
    await persistSessionSnapshot(session);
    session.detachDiagnostics();
    stopSignerNode(session.node);
  }
  await updateActivationLifecycle('idle', 'offscreen', 'cold').catch(() => undefined);
}

function resolveRuntimePhase(session: Pick<SignerSession, 'node'>): RuntimePhase {
  const runtimeStatus = getRuntimeStatus(session.node);
  const readiness = runtimeStatus.readiness;
  if (!readiness.runtime_ready || !readiness.restore_complete) {
    if (readiness.sign_ready || readiness.ecdh_ready) {
      return 'degraded';
    }
    return 'restoring';
  }
  if (!readiness.sign_ready && !readiness.ecdh_ready && runtimeStatus.peers.length > 0) {
    return 'degraded';
  }
  return 'ready';
}

async function syncRuntimeStatusUpdate(session: Pick<SignerSession, 'node'> | null, runtime = runtimePhase) {
  await Promise.resolve(publishRuntimeStatusUpdate(session ? getRuntimeStatus(session.node) : null, runtime));
}

function attachDiagnostics(node: NodeWithEvents) {
  const diagnostics = createObservabilityBuffer(500);

  const messageHandler = (payload: unknown) => {
    if (
      isRecord(payload) &&
      typeof payload.ts === 'number' &&
      typeof payload.level === 'string' &&
      typeof payload.component === 'string' &&
      typeof payload.domain === 'string' &&
      typeof payload.event === 'string'
    ) {
      diagnostics.push(payload as ObservabilityEvent);
      return;
    }

    const event = logger.warn('runtime', 'unstructured_message', {
      payload: isRecord(payload) ? payload : { value: payload }
    });
    if (event) {
      diagnostics.push(event);
    }
  };

  const errorHandler = (payload: unknown) => {
    const event = logger.error('runtime', 'node_error', {
      error_message: toErrorMessage(payload)
    });
    if (event) {
      diagnostics.push(event);
    }
  };

  node.on('message', messageHandler);
  node.on('error', errorHandler);

  return {
    push: diagnostics.push,
    diagnostics: diagnostics.snapshot,
    dropped: diagnostics.dropped,
    detach: () => {
      if (typeof node.off === 'function') {
        node.off('message', messageHandler);
        node.off('error', errorHandler);
      } else if (typeof node.removeListener === 'function') {
        node.removeListener('message', messageHandler);
        node.removeListener('error', errorHandler);
      }
    }
  };
}

function getLifecycleSummary(diagnostics: ObservabilityEvent[]): RuntimeLifecycleSummary {
  return summarizeRuntimeLifecycle(diagnostics);
}

async function persistSessionSnapshot(session: Pick<SignerSession, 'key' | 'node'>) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const snapshot = getRuntimeSnapshot(session.node);
      const snapshotJson = JSON.stringify(snapshot);
      await savePersistedRuntimeSnapshot(session.key, snapshotJson);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw new Error(toErrorMessage(lastError, 'Failed to persist runtime snapshot'));
}

function persistSessionSnapshotInBackground(
  session: Pick<SignerSession, 'key' | 'node'>,
  detail: { profileId: string; profileKey: string }
) {
  void persistSessionSnapshot(session)
    .then(() => {
      logger.info('runtime', 'persist_snapshot_ok', detail);
      pushPendingBootLog('info', 'runtime', 'persist_snapshot_ok', detail);
    })
    .catch((error) => {
      logger.warn('runtime', 'persist_snapshot_failed', {
        ...detail,
        error_message: toErrorMessage(error)
      });
      pushPendingBootLog('warn', 'runtime', 'persist_snapshot_failed', {
        ...detail,
        error_message: toErrorMessage(error)
      });
    });
}

function persistSnapshotJsonInBackground(profileId: string, snapshotJson: string) {
  void savePersistedRuntimeSnapshot(profileId, snapshotJson).catch((error) => {
    logger.warn('runtime', 'snapshot_store_failed', {
      profile_id: profileId,
      error_message: toErrorMessage(error)
    });
  });
}

function snapshotHasUsableNonces(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const state = (snapshot as { state?: unknown }).state;
  if (!state || typeof state !== 'object') return false;
  const noncePool = (state as { nonce_pool?: unknown }).nonce_pool;
  if (!noncePool || typeof noncePool !== 'object') return false;
  const peers = (noncePool as { peers?: unknown }).peers;
  if (!Array.isArray(peers)) return false;
  return peers.some((peer) => {
    if (!peer || typeof peer !== 'object') return false;
    const incoming = (peer as { incoming_available?: unknown }).incoming_available;
    const outgoing = (peer as { outgoing_available?: unknown }).outgoing_available;
    return (
      (typeof incoming === 'number' && incoming > 0) ||
      (typeof outgoing === 'number' && outgoing > 0)
    );
  });
}

async function waitForNonceSnapshot(node: NodeWithEvents) {
  const startedAt = Date.now();
  let lastSnapshot: unknown = null;
  while (Date.now() - startedAt < NONCE_SNAPSHOT_WAIT_TIMEOUT_MS) {
    lastSnapshot = getRuntimeSnapshot(node);
    if (snapshotHasUsableNonces(lastSnapshot)) {
      return lastSnapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, NONCE_SNAPSHOT_POLL_INTERVAL_MS));
  }
  return lastSnapshot ?? getRuntimeSnapshot(node);
}

async function ensureSignerSession(
  profile: StoredExtensionProfile,
  profilePayload?: BrowserProfilePackagePayload
) {
  const nextKey = profileKey(profile);
  if (signerSessionPromise && signerSessionKey === nextKey) {
    logger.info('runtime', 'ensure_session_reuse', {
      profile_id: profile.id,
      profile_key: nextKey
    });
    return await signerSessionPromise;
  }

  await stopSignerSession();
  resetPendingBootDiagnostics();
  pushPendingBootLog('info', 'runtime', 'ensure_session_reset', {
    profile_id: profile.id,
    profile_key: nextKey
  });

  signerSessionKey = nextKey;
  runtimePhase = 'restoring';
  signerSessionPromise = Promise.resolve()
    .then(async () => {
      logger.info('runtime', 'ensure_session_begin', {
        profile_id: profile.id,
        profile_key: nextKey
      });
      pushPendingBootLog('info', 'runtime', 'ensure_session_lifecycle_update_begin', {
        profile_id: profile.id,
        profile_key: nextKey,
        stage: 'restoring_runtime'
      });
      void updateActivationLifecycle('restoring_runtime', 'offscreen', 'restoring', {
        profileKey: nextKey
      })
        .then(() => {
          pushPendingBootLog('info', 'runtime', 'ensure_session_lifecycle_update_ok', {
            profile_id: profile.id,
            profile_key: nextKey,
            stage: 'restoring_runtime'
          });
        })
        .catch((error) => {
          pushPendingBootLog('warn', 'runtime', 'ensure_session_lifecycle_update_failed', {
            profile_id: profile.id,
            profile_key: nextKey,
            stage: 'restoring_runtime',
            error_message: toErrorMessage(error)
          });
        });
      pushPendingBootLog('info', 'runtime', 'ensure_session_snapshot_load_begin', {
        profile_id: profile.id,
        profile_key: nextKey,
        snapshot_from_profile:
          typeof profile.runtimeSnapshotJson === 'string' && profile.runtimeSnapshotJson.trim().length > 0
      });
      const snapshotJson =
        typeof profile.runtimeSnapshotJson === 'string' && profile.runtimeSnapshotJson.trim().length > 0
          ? profile.runtimeSnapshotJson
          : await loadPersistedRuntimeSnapshot(nextKey);
      const snapshotAvailable = typeof snapshotJson === 'string' && snapshotJson.trim().length > 0;
      const bootMode = snapshotAvailable ? 'persisted' : 'profile';
      pushPendingBootLog('info', 'runtime', 'ensure_session_snapshot_resolved', {
        profile_id: profile.id,
        profile_key: nextKey,
        snapshot_available: snapshotAvailable
      });
      logger.info('runtime', 'ensure_session_snapshot_resolved', {
        profile_id: profile.id,
        profile_key: nextKey,
        snapshot_available: snapshotAvailable,
        snapshot_source:
          typeof profile.runtimeSnapshotJson === 'string' && profile.runtimeSnapshotJson.trim().length > 0
            ? 'profile'
            : 'storage'
      });
      pushPendingBootLog('info', 'runtime', 'ensure_session_create_node_begin', {
        profile_id: profile.id,
        profile_key: nextKey,
        relay_count: profile.relays.length
      });
      logger.info('runtime', 'ensure_session_create_node_begin', {
        profile_id: profile.id,
        profile_key: nextKey,
        relay_count: profile.relays.length
      });
      const node =
        snapshotAvailable
          ? createSignerNode(
              {
                mode: 'persisted',
                relays: profile.relays,
                signerSettings: profile.signerSettings
              },
              {
                runtimeSnapshotJson: snapshotJson
              }
            )
          : profilePayload
            ? createSignerNode({
                mode: 'profile',
                relays: profile.relays,
                signerSettings: profile.signerSettings,
                groupPackageJson: groupJsonFromPayload(profilePayload),
                sharePackageJson: shareJsonFromPayload(profilePayload)
              })
            : (() => {
                throw new Error('No runtime snapshot found. Unlock or import the profile again.');
              })();
      logger.info('runtime', 'ensure_session_create_node_ok', {
        profile_id: profile.id,
        profile_key: nextKey
      });
      pushPendingBootLog('info', 'runtime', 'ensure_session_create_node_ok', {
        profile_id: profile.id,
        profile_key: nextKey
      });
      const attached = attachDiagnostics(node);
      const bootstrapStart = logger.info('runtime', 'bootstrap_begin', {
        mode: bootMode,
        profile_id: profile.id,
        profile_key: nextKey
      });
      if (bootstrapStart) {
        attached.push(bootstrapStart);
      }
      try {
        pushPendingBootLog('info', 'runtime', 'connect_node_begin', {
          profile_id: profile.id,
          profile_key: nextKey
        });
        logger.info('runtime', 'connect_node_begin', {
          profile_id: profile.id,
          profile_key: nextKey
        });
        await withTimeout(
          connectSignerNode(node),
          RUNTIME_CONNECT_TIMEOUT_MS,
          'Signer runtime connect'
        );
        logger.info('runtime', 'connect_node_ok', {
          profile_id: profile.id,
          profile_key: nextKey
        });
        pushPendingBootLog('info', 'runtime', 'connect_node_ok', {
          profile_id: profile.id,
          profile_key: nextKey
        });
      } catch (error) {
        const failure = activationFailure('runtime_restore_failed', toErrorMessage(error));
        pushPendingBootLog('error', 'runtime', 'bootstrap_failed', {
          profile_id: profile.id,
          profile_key: nextKey,
          error_message: failure.message
        });
        const bootstrapFailure = logger.error('runtime', 'bootstrap_failed', {
          mode: bootMode,
          profile_key: nextKey,
          error_message: failure.message
        });
        if (bootstrapFailure) {
          attached.push(bootstrapFailure);
        }
        attached.detach();
        await updateActivationLifecycle('failed', 'offscreen', 'cold', {
          profileKey: nextKey
        }, {
          lastError: failure,
          restoredFromSnapshot: snapshotAvailable
        }).catch(() => undefined);
        throw new Error(failure.message);
      }
      const session = {
        key: nextKey,
        node,
        diagnostics: attached.diagnostics,
        droppedDiagnostics: attached.dropped,
        detachDiagnostics: attached.detach
      };
      node.on('runtime-status', (status: unknown) => {
        if (!isRecord(status)) return;
        runtimePhase = resolveRuntimePhase(session);
        void updateActivationLifecycle(
          runtimePhase === 'ready' ? 'ready' : runtimePhase === 'degraded' ? 'degraded' : 'restoring_runtime',
          'offscreen',
          runtimePhase,
          {
            profileKey: nextKey
          },
          {
            restoredFromSnapshot: snapshotAvailable
          }
        ).catch(() => undefined);
        void publishRuntimeStatusUpdate(status as RuntimeStatusSummary, runtimePhase);
      });
      runtimePhase = resolveRuntimePhase(session);
      await updateActivationLifecycle(
        runtimePhase === 'ready' ? 'ready' : runtimePhase === 'degraded' ? 'degraded' : 'restoring_runtime',
        'offscreen',
        runtimePhase,
        {
          profileKey: nextKey
        },
        {
          restoredFromSnapshot: snapshotAvailable
        }
      ).catch(() => undefined);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      logger.info('runtime', 'ensure_session_ready', {
        profile_id: profile.id,
        profile_key: nextKey,
        runtime: runtimePhase
      });
      pushPendingBootLog('info', 'runtime', 'ensure_session_ready', {
        profile_id: profile.id,
        profile_key: nextKey,
        runtime: runtimePhase
      });
      logger.info('runtime', 'persist_snapshot_begin', {
        profile_id: profile.id,
        profile_key: nextKey
      });
      pushPendingBootLog('info', 'runtime', 'persist_snapshot_begin', {
        profile_id: profile.id,
        profile_key: nextKey
      });
      persistSessionSnapshotInBackground(session, {
        profileId: profile.id,
        profileKey: nextKey
      });
      return {
        ...session
      };
    })
    .catch((error) => {
      pushPendingBootLog('error', 'runtime', 'ensure_session_failed', {
        profile_id: profile.id,
        profile_key: nextKey,
        error_message: toErrorMessage(error)
      });
      logger.error('runtime', 'ensure_session_failed', {
        profile_id: profile.id,
        profile_key: nextKey,
        error_message: toErrorMessage(error)
      });
      signerSessionPromise = null;
      signerSessionKey = null;
      runtimePhase = 'cold';
      const failure = activationFailure('runtime_restore_failed', toErrorMessage(error));
      void updateActivationLifecycle('failed', 'offscreen', 'cold', {
        profileKey: nextKey
      }, {
        lastError: failure
      }).catch(() => undefined);
      void syncRuntimeStatusUpdate(null, 'cold');
      throw error;
    });

  return await signerSessionPromise;
}

async function decodeProfile(profile: StoredExtensionProfile) {
  const session = await ensureSignerSession(profile);
  const runtimeStatus = getRuntimeStatus(session.node);
  return {
    publicKey: runtimeStatus.metadata.group_public_key,
    sharePublicKey: runtimeStatus.metadata.share_public_key,
    peerPubkey:
      typeof profile.peerPubkey === 'string' && profile.peerPubkey.trim()
        ? profile.peerPubkey.trim().toLowerCase()
        : ''
  };
}

async function handleNostrMethod(
  method: ProviderMethod,
  profile: StoredExtensionProfile,
  params?: Record<string, unknown>
) {
  switch (method) {
    case MESSAGE_TYPE.NOSTR_SIGN_EVENT: {
      if (!isRecord(params?.event)) {
        throw new Error('signEvent requires an event payload');
      }
      const session = await ensureSignerSession(profile);
      await prepareSignOnNode(session.node);
      const signed = await signNostrEvent(session.node, params.event);
      runtimePhase = resolveRuntimePhase(session);
      void syncRuntimeStatusUpdate(session, runtimePhase);
      persistSessionSnapshotInBackground(session, {
        profileId: profile.id,
        profileKey: session.key
      });
      return signed;
    }
    case MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT:
    case MESSAGE_TYPE.NOSTR_NIP04_DECRYPT:
      throw new Error('NIP-04 is not planned for the v2 runtime path');
    case MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT: {
      if (typeof params?.pubkey !== 'string' || typeof params?.plaintext !== 'string') {
        throw new Error('nip44.encrypt requires pubkey and plaintext');
      }
      const session = await ensureSignerSession(profile);
      await prepareEcdhOnNode(session.node);
      const ciphertext = await nip44EncryptWithNode(session.node, params.pubkey, params.plaintext);
      runtimePhase = resolveRuntimePhase(session);
      void syncRuntimeStatusUpdate(session, runtimePhase);
      persistSessionSnapshotInBackground(session, {
        profileId: profile.id,
        profileKey: session.key
      });
      return ciphertext;
    }
    case MESSAGE_TYPE.NOSTR_NIP44_DECRYPT: {
      if (typeof params?.pubkey !== 'string' || typeof params?.ciphertext !== 'string') {
        throw new Error('nip44.decrypt requires pubkey and ciphertext');
      }
      const session = await ensureSignerSession(profile);
      await prepareEcdhOnNode(session.node);
      const plaintext = await nip44DecryptWithNode(session.node, params.pubkey, params.ciphertext);
      runtimePhase = resolveRuntimePhase(session);
      void syncRuntimeStatusUpdate(session, runtimePhase);
      persistSessionSnapshotInBackground(session, {
        profileId: profile.id,
        profileKey: session.key
      });
      return plaintext;
    }
    default:
      throw new Error(`Unsupported offscreen method: ${method}`);
  }
}

async function handleRpc(rpcType: string, payload?: Record<string, unknown>) {
  switch (rpcType) {
    case 'offscreen.ping':
      return { ready: true };
    case 'onboarding.connect': {
      const input = isRecord(payload?.input) ? payload.input : null;
      const onboardPackage =
        input && typeof input.onboardPackage === 'string' ? input.onboardPackage.trim() : '';
      const onboardPassword =
        input && typeof input.onboardPassword === 'string' ? input.onboardPassword : '';
      const keysetName =
        input && typeof input.keysetName === 'string' && input.keysetName.trim()
          ? input.keysetName.trim()
          : undefined;
      if (!onboardPackage || !onboardPassword) {
        throw new Error('onboarding.connect requires package and password');
      }
      const decodedPackage = await decodeBfOnboardPackage(onboardPackage, onboardPassword);

      await updateOnboardingLifecycle('decoding_package', 'offscreen', {
        packageLength: onboardPackage.length
      }).catch(() => undefined);
      try {
        const result = await connectOnboardingPackageAndCaptureProfile({
          packageText: onboardPackage,
          password: onboardPassword,
          keysetName,
        }).catch(async (error) => {
          const failure = activationFailure('decode_failed', toErrorMessage(error), 'offscreen');
          await updateOnboardingLifecycle(
            'failed',
            'offscreen',
            {
              packageLength: onboardPackage.length,
            },
            failure,
          ).catch(() => undefined);
          throw error;
        });

        await updateOnboardingLifecycle('connecting_peer', 'offscreen', {
          peerPubkey: result.decoded.peerPubkey,
          relayCount: result.decoded.relays.length,
        }).catch(() => undefined);
        await updateOnboardingLifecycle('awaiting_onboard_response', 'offscreen', {
          peerPubkey: result.decoded.peerPubkey,
          relayCount: result.decoded.relays.length,
        }).catch(() => undefined);
        await updateOnboardingLifecycle('snapshot_captured', 'offscreen', {
          peerPubkey: result.decoded.peerPubkey,
          relayCount: result.decoded.relays.length,
        }).catch(() => undefined);
        const payload = await runtimePayloadFromSnapshot({
          label: result.profile.keysetName?.trim() || 'Onboarded device',
          relays: decodedPackage.relays,
          runtimeSnapshotJson: result.runtimeSnapshotJson
        });
        const pendingProfile: PendingOnboardingProfile = {
          id: payload.profileId,
          keysetName: result.profile.keysetName,
          relays: result.profile.relays,
          groupPublicKey: result.profile.groupPublicKey,
          publicKey: result.profile.groupPublicKey,
          sharePublicKey: result.profile.sharePublicKey,
          peerPubkey: result.profile.peerPubkey,
          signerSettings: normalizeSignerSettings(result.profile.signerSettings),
          runtimeSnapshotJson: result.runtimeSnapshotJson,
          profilePayload: payload,
        };
        await updateOnboardingLifecycle('profile_persisted', 'offscreen', {
          peerPubkey: result.decoded.peerPubkey,
          relayCount: result.decoded.relays.length,
        }).catch(() => undefined);
        return pendingProfile;
      } catch (error) {
        const message = toErrorMessage(error);
        const failure = activationFailure(
          /timed out/i.test(message) ? 'onboard_timeout' : 'onboard_rejected',
          message,
          'offscreen'
        );
        await updateOnboardingLifecycle('failed', 'offscreen', {
          packageLength: onboardPackage.length
        }, failure).catch(() => undefined);
        throw error;
      }
    }
    case 'profile.import_bfprofile': {
      const packageText =
        typeof payload?.packageText === 'string' ? payload.packageText.trim() : undefined;
      const password =
        typeof payload?.password === 'string' ? payload.password : undefined;
      if (!packageText || !password) {
        throw new Error('profile.import_bfprofile requires package and password');
      }
      const decoded = await decodeBfProfilePackage(packageText, password);
      const sharePublicKey = publicKeyFromSecret(decoded.device.shareSecret);
      const profile: StoredExtensionProfile = {
        id: decoded.profileId,
        keysetName: decoded.keysetName,
        relays: decoded.device.relays,
        groupPublicKey: groupPublicKeyFromPackage(decoded.groupPackage),
        publicKey: groupPublicKeyFromPackage(decoded.groupPackage),
        sharePublicKey,
        signerSettings: normalizeSignerSettings(),
      };
      return profile;
    }
    case 'profile.import_bfprofile_payload': {
      const packageText =
        typeof payload?.packageText === 'string' ? payload.packageText.trim() : undefined;
      const password =
        typeof payload?.password === 'string' ? payload.password : undefined;
      if (!packageText || !password) {
        throw new Error('profile.import_bfprofile_payload requires package and password');
      }
      const decoded = await decodeBfProfilePackage(packageText, password);
      return {
        profilePayload: decoded
      };
    }
    case 'profile.recover_bfshare': {
      const packageText =
        typeof payload?.packageText === 'string' ? payload.packageText.trim() : undefined;
      const password =
        typeof payload?.password === 'string' ? payload.password : undefined;
      if (!packageText || !password) {
        throw new Error('profile.recover_bfshare requires package and password');
      }
      const recovered = await recoverProfileFromSharePackage(packageText, password);
      const sharePublicKey = publicKeyFromSecret(recovered.share.shareSecret);
      const profile: StoredExtensionProfile = {
        id: recovered.profile.profileId,
        keysetName: recovered.profile.keysetName,
        relays: recovered.profile.device.relays,
        groupPublicKey: groupPublicKeyFromPackage(recovered.profile.groupPackage),
        publicKey: groupPublicKeyFromPackage(recovered.profile.groupPackage),
        sharePublicKey,
        signerSettings: normalizeSignerSettings(),
      };
      return profile;
    }
    case 'profile.recover_bfshare_payload': {
      const packageText =
        typeof payload?.packageText === 'string' ? payload.packageText.trim() : undefined;
      const password =
        typeof payload?.password === 'string' ? payload.password : undefined;
      if (!packageText || !password) {
        throw new Error('profile.recover_bfshare_payload requires package and password');
      }
      const recovered = await recoverProfileFromSharePackage(packageText, password);
      return {
        profilePayload: recovered.profile
      };
    }
    case 'runtime.ensure':
      if (typeof payload?.profileId === 'string' && payload.profileId.trim()) {
        const profileId = payload.profileId.trim().toLowerCase();
        await updateActivationLifecycle('restoring_runtime', 'offscreen', 'restoring', {
          profileId
        }).catch(() => undefined);
        const stored = await loadUnlockedProfileById(profileId);
        if (!stored) {
          throw new Error(`Stored profile ${profileId} was not found.`);
        }
        logger.info('runtime', 'rpc_ensure_begin', {
          profile_id: stored.profile.id
        });
        const session = await ensureSignerSession(stored.profile, stored.payload.profile);
        refreshAllPeersOnNode(session.node);
        runtimePhase = resolveRuntimePhase(session);
        await syncRuntimeStatusUpdate(session, runtimePhase);
        logger.info('runtime', 'rpc_ensure_ok', {
          profile_id: stored.profile.id,
          runtime: runtimePhase
        });
        return { runtime: runtimePhase };
      }
      if (payload?.profile && typeof payload.profile === 'object') {
        const profilePayload =
          payload?.profilePayload && typeof payload.profilePayload === 'object'
            ? (payload.profilePayload as BrowserProfilePackagePayload)
            : undefined;
        await updateActivationLifecycle('restoring_runtime', 'offscreen', 'restoring', {
          profileId:
            typeof (payload.profile as StoredExtensionProfile).id === 'string'
              ? (payload.profile as StoredExtensionProfile).id
              : undefined
        }).catch(() => undefined);
        logger.info('runtime', 'rpc_ensure_begin', {
          profile_id:
            typeof (payload.profile as StoredExtensionProfile).id === 'string'
              ? (payload.profile as StoredExtensionProfile).id
              : null
        });
        const session = await ensureSignerSession(
          payload.profile as StoredExtensionProfile,
          profilePayload
        );
        refreshAllPeersOnNode(session.node);
        runtimePhase = resolveRuntimePhase(session);
        await syncRuntimeStatusUpdate(session, runtimePhase);
        logger.info('runtime', 'rpc_ensure_ok', {
          profile_id:
            typeof (payload.profile as StoredExtensionProfile).id === 'string'
              ? (payload.profile as StoredExtensionProfile).id
              : null,
          runtime: runtimePhase
        });
        return { runtime: runtimePhase };
      }
      return { runtime: signerSessionPromise ? runtimePhase : ('cold' as const) };
    case 'runtime.status':
      if (!signerSessionPromise) {
        return {
          runtime: 'cold' as const,
          status: null
        } satisfies RpcResult & { status: RuntimeStatusSummary | null };
      }
      {
        const session = await signerSessionPromise;
        return {
          runtime: runtimePhase,
          status: getRuntimeStatus(session.node)
        } satisfies RpcResult & { status: RuntimeStatusSummary | null };
      }
    case 'runtime.snapshot': {
      if (!signerSessionPromise) {
        return {
          runtime: 'cold' as const,
          status: null,
          snapshot: null,
          snapshotError: null,
          peerStatus: [],
          metadata: null,
          readiness: null
        };
      }
      const session = await signerSessionPromise;
      runtimePhase = resolveRuntimePhase(session);
      let snapshot: unknown = null;
      let snapshotError: string | null = null;
      try {
        snapshot = getRuntimeSnapshot(session.node);
        persistSnapshotJsonInBackground(session.key, JSON.stringify(snapshot));
      } catch (error) {
        snapshotError = toErrorMessage(error);
      }
      return {
        runtime: runtimePhase,
        status: getRuntimeStatus(session.node),
        snapshot,
        snapshotError,
        lifecycle: getLifecycleSummary(session.diagnostics())
      };
    }
    case 'runtime.persist_snapshot': {
      const profileId = typeof payload?.profileId === 'string' ? payload.profileId.trim().toLowerCase() : '';
      const snapshotJson = typeof payload?.snapshotJson === 'string' ? payload.snapshotJson.trim() : '';
      if (!profileId || !snapshotJson) {
        throw new Error('runtime.persist_snapshot requires profileId and snapshotJson');
      }
      await savePersistedRuntimeSnapshot(profileId, snapshotJson);
      return { ok: true };
    }
    case 'runtime.read_config': {
      const session = await signerSessionPromise;
      if (!session) {
        throw new Error('runtime is not active');
      }
      return getRuntimeConfigFromNode(session.node);
    }
    case 'runtime.update_config': {
      const settings = payload?.settings;
      if (!isRecord(settings)) {
        throw new Error('runtime.update_config requires settings');
      }
      const session = await signerSessionPromise;
      if (!session) {
        throw new Error('runtime is not active');
      }
      updateRuntimeConfigOnNode(session.node, settings as Partial<SignerSettings>);
      await persistSessionSnapshot(session);
      runtimePhase = resolveRuntimePhase(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      return getRuntimeConfigFromNode(session.node);
    }
    case 'runtime.update_peer_policy': {
      const pubkey = typeof payload?.pubkey === 'string' ? payload.pubkey.trim().toLowerCase() : '';
      const patch = isRecord(payload?.patch) ? payload.patch : null;
      if (
        !pubkey ||
        !patch ||
        (patch.direction !== 'request' && patch.direction !== 'respond') ||
        !['ping', 'onboard', 'sign', 'ecdh'].includes(String(patch.method)) ||
        !['unset', 'allow', 'deny'].includes(String(patch.value))
      ) {
        throw new Error('runtime.update_peer_policy requires pubkey and a valid override patch');
      }
      const session = await signerSessionPromise;
      if (!session) {
        throw new Error('runtime is not active');
      }
      const overridePatch = {
        direction: patch.direction as 'request' | 'respond',
        method: patch.method as 'ping' | 'onboard' | 'sign' | 'ecdh',
        value: patch.value as PolicyOverrideValue,
      };
      await updateRuntimePeerPolicyOverrideOnNode(session.node, pubkey, {
        direction: overridePatch.direction,
        method: overridePatch.method,
        value: overridePatch.value
      });
      await persistSessionSnapshot(session);
      runtimePhase = resolveRuntimePhase(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      return getRuntimeStatus(session.node);
    }
    case 'runtime.clear_peer_policy_overrides': {
      const session = await signerSessionPromise;
      if (!session) {
        throw new Error('runtime is not active');
      }
      await clearRuntimePeerPolicyOverridesOnNode(session.node);
      await persistSessionSnapshot(session);
      runtimePhase = resolveRuntimePhase(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      return getRuntimeStatus(session.node);
    }
    case 'runtime.prepare_sign': {
      const session = await signerSessionPromise;
      if (!session) {
        throw new Error('runtime is not active');
      }
      const readiness = await prepareSignOnNode(session.node);
      runtimePhase = resolveRuntimePhase(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      persistSessionSnapshotInBackground(session, {
        profileId: session.key,
        profileKey: session.key
      });
      return {
        runtime: runtimePhase,
        readiness
      };
    }
    case 'runtime.prepare_ecdh': {
      const session = await signerSessionPromise;
      if (!session) {
        throw new Error('runtime is not active');
      }
      const readiness = await prepareEcdhOnNode(session.node);
      runtimePhase = resolveRuntimePhase(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      persistSessionSnapshotInBackground(session, {
        profileId: session.key,
        profileKey: session.key
      });
      return {
        runtime: runtimePhase,
        readiness
      };
    }
    case 'runtime.refresh_all_peers': {
      const session = await signerSessionPromise;
      if (!session) {
        throw new Error('runtime is not active');
      }
      refreshAllPeersOnNode(session.node);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      return {
        runtime: runtimePhase
      };
    }
    case 'runtime.wipe_state': {
      const session = await signerSessionPromise;
      if (!session) {
        return {
          runtime: 'cold' as const
        };
      }
      wipeRuntimeStateOnNode(session.node);
      runtimePhase = 'degraded';
      await persistSessionSnapshot(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      return {
        runtime: runtimePhase
      };
    }
    case 'runtime.diagnostics': {
      const [lifecycle, lifecycleHistory] = await Promise.all([
        loadLifecycleStatus(),
        loadLifecycleHistory()
      ]);
      if (!signerSessionPromise) {
        return {
          runtime: 'cold' as const,
          diagnostics: pendingBootDiagnostics.snapshot(),
          dropped: pendingBootDiagnostics.dropped(),
          runtimeStatus: null,
          lifecycle,
          lifecycleHistory
        };
      }
      const sessionResult = await Promise.race([
        signerSessionPromise.then((session) => ({ kind: 'ready' as const, session })),
        new Promise<{ kind: 'pending' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'pending' }), 250);
        })
      ]);
      if (sessionResult.kind === 'pending') {
        return {
          runtime: runtimePhase,
          diagnostics: pendingBootDiagnostics.snapshot(),
          dropped: pendingBootDiagnostics.dropped(),
          runtimeStatus: null,
          lifecycle,
          lifecycleHistory
        };
      }
      const session = sessionResult.session;
      const runtimeStatus = getRuntimeStatus(session.node);
      return {
        runtime: runtimePhase,
        diagnostics: session.diagnostics(),
        dropped: session.droppedDiagnostics(),
        runtimeStatus,
        lifecycle,
        lifecycleHistory
      };
    }
    case 'runtime.stop': {
      await stopSignerSession();
      await syncRuntimeStatusUpdate(null, 'cold');
      return {
        runtime: 'cold' as const
      };
    }
    case 'profile.decode': {
      const profile = payload?.profile;
      if (!profile || typeof profile !== 'object') {
        throw new Error('profile.decode requires a profile payload');
      }
      return await decodeProfile(profile as StoredExtensionProfile);
    }
    case 'nostr.execute': {
      const method = payload?.method;
      const profile = payload?.profile;
      if (typeof method !== 'string') {
        throw new Error('nostr.execute requires a method');
      }
      if (!profile || typeof profile !== 'object') {
        throw new Error('nostr.execute requires a profile');
      }
      return await handleNostrMethod(
        method as ProviderMethod,
        profile as StoredExtensionProfile,
        isRecord(payload?.params) ? payload.params : undefined
      );
    }
    default:
      throw new Error(`Unknown offscreen rpc: ${rpcType}`);
  }
}

const chromeApi = getChromeApi();

chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (!isRecord(message) || message.type !== MESSAGE_TYPE.OFFSCREEN_RPC) return;

  void handleRpc(
    typeof message.rpcType === 'string' ? message.rpcType : '',
    isRecord(message.payload) ? message.payload : undefined
  )
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: toErrorMessage(error)
      })
    );

  return true;
});

globalThis.addEventListener?.('beforeunload', () => {
  if (signerSessionPromise) {
    void signerSessionPromise
      .then((session) => persistSessionSnapshot(session))
      .catch((error) => {
        logger.error('runtime', 'snapshot_persist_failed', {
          error_message: toErrorMessage(error, 'failed to persist runtime snapshot')
        });
      });
  }
  void stopSignerSession();
});
