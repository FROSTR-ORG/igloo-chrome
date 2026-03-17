import { getChromeApi } from '@/extension/chrome';
import {
  loadLifecycleHistory,
  loadLifecycleStatus,
  loadRuntimeSnapshot as loadStoredRuntimeSnapshot,
  saveRuntimeSnapshot as saveStoredRuntimeSnapshot,
  updateOnboardingLifecycle,
  updateActivationLifecycle
} from '@/extension/storage';
import {
  MESSAGE_TYPE,
  isRecord,
  type LifecycleFailure,
  type PolicyOverrideValue,
  type ProviderMethod,
  type StoredExtensionProfile
} from '@/extension/protocol';
import {
  connectOnboardingPackageAndCaptureProfile,
  connectSignerNode,
  clearRuntimePeerPolicyOverridesOnNode,
  createSignerNode,
  deriveProfileIdFromSharePublicKey,
  getPublicKeyFromNode,
  getRuntimeConfigFromNode,
  getRuntimeSnapshot,
  getRuntimeStatus,
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
  type NodeWithEvents,
  type RuntimeStatusSummary
} from '@/lib/igloo';
import {
  createLogger,
  createObservabilityBuffer,
  summarizeRuntimeLifecycle,
  type ObservabilityEvent
} from '@/lib/observability';
import { normalizeSignerSettings, type SignerSettings } from '@/lib/signer-settings';

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

const RUNTIME_SETTLE_TIMEOUT_MS = 20_000;
const RUNTIME_SETTLE_POLL_INTERVAL_MS = 100;
const NONCE_SNAPSHOT_WAIT_TIMEOUT_MS = 5_000;
const NONCE_SNAPSHOT_POLL_INTERVAL_MS = 100;

let signerSessionPromise: Promise<SignerSession> | null = null;
let signerSessionKey: string | null = null;
let runtimePhase: RuntimePhase = 'cold';
const logger = createLogger('igloo.offscreen');

async function publishRuntimeStatusUpdate(status: RuntimeStatusSummary | null, runtime: RuntimePhase) {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) return;
  try {
    const session = await signerSessionPromise?.catch(() => null);
    await chromeApi.runtime.sendMessage({
      type: MESSAGE_TYPE.RUNTIME_STATUS_UPDATED,
      runtime,
      status
    });
  } catch {
    // Ignore background delivery failures; consumers can recover from runtime.status.
  }
}

async function loadPersistedRuntimeSnapshot(profileKey: string) {
  return await loadStoredRuntimeSnapshot(profileKey);
}

async function savePersistedRuntimeSnapshot(profileKey: string, snapshotJson: string) {
  await saveStoredRuntimeSnapshot(profileKey, snapshotJson);
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
  await publishRuntimeStatusUpdate(session ? getRuntimeStatus(session.node) : null, runtime);
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
      await savePersistedRuntimeSnapshot(session.key, JSON.stringify(snapshot));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw new Error(toErrorMessage(lastError, 'Failed to persist runtime snapshot'));
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

async function waitForRuntimeSettlement(
  session: Pick<SignerSession, 'node'>,
  timeoutMs = RUNTIME_SETTLE_TIMEOUT_MS
) {
  const startedAt = Date.now();
  let phase = resolveRuntimePhase(session);
  while (phase === 'restoring' && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, RUNTIME_SETTLE_POLL_INTERVAL_MS));
    phase = resolveRuntimePhase(session);
  }
  return phase;
}

async function ensureSignerSession(profile: StoredExtensionProfile) {
  const nextKey = profileKey(profile);
  if (signerSessionPromise && signerSessionKey === nextKey) {
    return await signerSessionPromise;
  }

  await stopSignerSession();

  signerSessionKey = nextKey;
  runtimePhase = 'restoring';
  signerSessionPromise = Promise.resolve()
    .then(async () => {
      await updateActivationLifecycle('restoring_runtime', 'offscreen', 'restoring', {
        profileKey: nextKey
      }).catch(() => undefined);
      const snapshotJson =
        typeof profile.runtimeSnapshotJson === 'string' && profile.runtimeSnapshotJson.trim().length > 0
          ? profile.runtimeSnapshotJson
          : await loadPersistedRuntimeSnapshot(nextKey);
      const snapshotAvailable = typeof snapshotJson === 'string' && snapshotJson.trim().length > 0;
      if (!snapshotAvailable) {
        const failure = activationFailure(
          'snapshot_missing',
          'No runtime snapshot found. Re-import your onboarding package.'
        );
        await updateActivationLifecycle('failed', 'offscreen', 'cold', {
          profileKey: nextKey
        }, {
          lastError: failure,
          restoredFromSnapshot: false
        }).catch(() => undefined);
        throw new Error(failure.message);
      }
      const node = createSignerNode(
        {
          mode: 'persisted',
          relays: profile.relays,
          signerSettings: profile.signerSettings
        },
        {
          runtimeSnapshotJson: snapshotJson
        }
      );
      const attached = attachDiagnostics(node);
      const bootstrapStart = logger.info('runtime', 'bootstrap_begin', {
        mode: 'persisted',
        profile_key: nextKey
      });
      if (bootstrapStart) {
        attached.push(bootstrapStart);
      }
      try {
        await connectSignerNode(node);
      } catch (error) {
        const failure = activationFailure('runtime_restore_failed', toErrorMessage(error));
        const bootstrapFailure = logger.error('runtime', 'bootstrap_failed', {
          mode: 'persisted',
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
          restoredFromSnapshot: true
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
            restoredFromSnapshot: true
          }
        ).catch(() => undefined);
        void publishRuntimeStatusUpdate(status as RuntimeStatusSummary, runtimePhase);
      });
      await persistSessionSnapshot(session);
      runtimePhase = resolveRuntimePhase(session);
      await updateActivationLifecycle(
        runtimePhase === 'ready' ? 'ready' : runtimePhase === 'degraded' ? 'degraded' : 'restoring_runtime',
        'offscreen',
        runtimePhase,
        {
          profileKey: nextKey
        },
        {
          restoredFromSnapshot: true
        }
      ).catch(() => undefined);
      await syncRuntimeStatusUpdate(session, runtimePhase);
      return {
        ...session
      };
    })
    .catch((error) => {
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
      const signed = await signNostrEvent(session.node, params.event);
      await persistSessionSnapshot(session);
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
      const ciphertext = await nip44EncryptWithNode(session.node, params.pubkey, params.plaintext);
      await persistSessionSnapshot(session);
      return ciphertext;
    }
    case MESSAGE_TYPE.NOSTR_NIP44_DECRYPT: {
      if (typeof params?.pubkey !== 'string' || typeof params?.ciphertext !== 'string') {
        throw new Error('nip44.decrypt requires pubkey and ciphertext');
      }
      const session = await ensureSignerSession(profile);
      const plaintext = await nip44DecryptWithNode(session.node, params.pubkey, params.ciphertext);
      await persistSessionSnapshot(session);
      return plaintext;
    }
    default:
      throw new Error(`Unsupported offscreen method: ${method}`);
  }
}

async function handleRpc(rpcType: string, payload?: Record<string, unknown>) {
  switch (rpcType) {
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
        const profile: StoredExtensionProfile = {
          id: await deriveProfileIdFromSharePublicKey(result.profile.sharePublicKey ?? result.decoded.publicKey),
          keysetName: result.profile.keysetName,
          relays: result.profile.relays,
          groupPublicKey: result.profile.groupPublicKey,
          publicKey: result.profile.groupPublicKey,
          sharePublicKey: result.profile.sharePublicKey,
          peerPubkey: result.profile.peerPubkey,
          signerSettings: normalizeSignerSettings(result.profile.signerSettings),
          runtimeSnapshotJson: result.runtimeSnapshotJson,
        };
        await savePersistedRuntimeSnapshot(profileKey(profile), result.runtimeSnapshotJson);
        await updateOnboardingLifecycle('profile_persisted', 'offscreen', {
          peerPubkey: result.decoded.peerPubkey,
          relayCount: result.decoded.relays.length,
        }).catch(() => undefined);
        return profile;
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
    case 'runtime.ensure':
      if (payload?.profile && typeof payload.profile === 'object') {
        const session = await ensureSignerSession(payload.profile as StoredExtensionProfile);
        await persistSessionSnapshot(session);
        runtimePhase = await waitForRuntimeSettlement(session);
        await syncRuntimeStatusUpdate(session, runtimePhase);
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
        await savePersistedRuntimeSnapshot(session.key, JSON.stringify(snapshot));
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
      await persistSessionSnapshot(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
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
      await persistSessionSnapshot(session);
      await syncRuntimeStatusUpdate(session, runtimePhase);
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
          diagnostics: [],
          dropped: 0,
          runtimeStatus: null,
          lifecycle,
          lifecycleHistory
        };
      }
      const session = await signerSessionPromise;
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
