import { getChromeApi } from '@/extension/chrome';
import {
  loadRuntimeSnapshot as loadStoredRuntimeSnapshot,
  saveRuntimeSnapshot as saveStoredRuntimeSnapshot
} from '@/extension/storage';
import {
  MESSAGE_TYPE,
  isRecord,
  type ProviderMethod,
  type StoredExtensionProfile
} from '@/extension/protocol';
import {
  connectSignerNode,
  createSignerNode,
  decodeOnboardingProfile,
  getPublicKeyFromNode,
  getRuntimeSnapshot,
  getRuntimeStatus,
  nip44DecryptWithNode,
  nip44EncryptWithNode,
  signNostrEvent,
  stopSignerNode,
  type NodeWithEvents
} from '@/lib/igloo';
import {
  createLogger,
  createObservabilityBuffer,
  summarizeRuntimeLifecycle,
  type ObservabilityEvent
} from '@/lib/observability';

type RpcResult = {
  runtime: 'cold' | 'ready';
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

let signerSessionPromise: Promise<SignerSession> | null = null;
let signerSessionKey: string | null = null;
const logger = createLogger('igloo.offscreen');

async function loadPersistedRuntimeSnapshot(profileKey: string) {
  return await loadStoredRuntimeSnapshot(profileKey);
}

async function savePersistedRuntimeSnapshot(profileKey: string, snapshotJson: string) {
  // Ignore snapshot persistence failures; cold bootstrap remains the fallback.
  await saveStoredRuntimeSnapshot(profileKey, snapshotJson).catch(() => undefined);
}

function toErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return fallback;
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
    peerPubkey: profile.peerPubkey?.trim().toLowerCase(),
    relays: profile.relays.map((relay) => relay.trim())
  });
}

async function stopSignerSession() {
  const existing = signerSessionPromise;
  signerSessionPromise = null;
  signerSessionKey = null;

  const session = await existing?.catch(() => null);
  if (session) {
    await persistSessionSnapshot(session).catch(() => undefined);
    session.detachDiagnostics();
    stopSignerNode(session.node);
  }
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const snapshot = getRuntimeSnapshot(session.node);
      await savePersistedRuntimeSnapshot(session.key, JSON.stringify(snapshot));
      return;
    } catch {
      if (attempt === 2) {
        // Ignore snapshot export failures; cold bootstrap remains the fallback.
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

async function ensureSignerSession(profile: StoredExtensionProfile) {
  const nextKey = profileKey(profile);
  if (signerSessionPromise && signerSessionKey === nextKey) {
    return await signerSessionPromise;
  }

  await stopSignerSession();

  signerSessionKey = nextKey;
  signerSessionPromise = Promise.resolve()
    .then(async () => {
      const snapshotJson =
        typeof profile.runtimeSnapshotJson === 'string' && profile.runtimeSnapshotJson.trim().length > 0
          ? profile.runtimeSnapshotJson
          : await loadPersistedRuntimeSnapshot(nextKey);
      const snapshotAvailable = typeof snapshotJson === 'string' && snapshotJson.trim().length > 0;
      const node = (() => {
        if (snapshotAvailable) {
          return createSignerNode(
            {
              mode: 'persisted',
              relays: profile.relays
            },
            {
              runtimeSnapshotJson: snapshotJson
            }
          );
        }
        if (
          typeof profile.onboardPackage === 'string' &&
          typeof profile.onboardPassword === 'string' &&
          profile.onboardPackage.trim()
        ) {
          return createSignerNode({
            mode: 'onboarding',
            onboardPackage: profile.onboardPackage,
            onboardPassword: profile.onboardPassword,
            relays: profile.relays
          });
        }
        throw new Error('No runtime snapshot found. Re-import your onboarding package.');
      })();
      const attached = attachDiagnostics(node);
      const bootstrapStart = logger.info('runtime', 'bootstrap_begin', {
        mode: snapshotAvailable ? 'persisted' : 'onboarding',
        profile_key: nextKey
      });
      if (bootstrapStart) {
        attached.push(bootstrapStart);
      }
      try {
        await connectSignerNode(node);
      } catch (error) {
        const bootstrapFailure = logger.error('runtime', 'bootstrap_failed', {
          mode: snapshotAvailable ? 'persisted' : 'onboarding',
          profile_key: nextKey,
          error_message: toErrorMessage(error)
        });
        if (bootstrapFailure) {
          attached.push(bootstrapFailure);
        }
        attached.detach();
        throw error;
      }
      const session = {
        key: nextKey,
        node,
        diagnostics: attached.diagnostics,
        droppedDiagnostics: attached.dropped,
        detachDiagnostics: attached.detach
      };
      await persistSessionSnapshot(session);
      return {
        ...session
      };
    })
    .catch((error) => {
      signerSessionPromise = null;
      signerSessionKey = null;
      throw error;
    });

  return await signerSessionPromise;
}

async function decodeProfile(profile: StoredExtensionProfile) {
  let publicKey: string;
  try {
    const session = await ensureSignerSession(profile);
    publicKey = getPublicKeyFromNode(session.node);
  } catch (error) {
    if (typeof profile.groupPublicKey === 'string' && profile.groupPublicKey.trim()) {
      publicKey = profile.groupPublicKey.trim().toLowerCase();
    } else {
      throw error;
    }
  }
  return {
    publicKey,
    peerPubkey:
      typeof profile.peerPubkey === 'string' && profile.peerPubkey.trim()
        ? profile.peerPubkey.trim().toLowerCase()
        : typeof profile.onboardPackage === 'string' &&
            typeof profile.onboardPassword === 'string' &&
            profile.onboardPackage.trim()
          ? (
              await decodeOnboardingProfile(
                profile.onboardPackage.trim(),
                profile.onboardPassword
              )
            ).peerPubkey
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
    case 'runtime.ensure':
      if (payload?.profile && typeof payload.profile === 'object') {
        const session = await ensureSignerSession(payload.profile as StoredExtensionProfile);
        await persistSessionSnapshot(session);
        return { runtime: 'ready' as const };
      }
      return { runtime: signerSessionPromise ? ('ready' as const) : ('cold' as const) };
    case 'runtime.status':
      return { runtime: signerSessionPromise ? ('ready' as const) : ('cold' as const) } satisfies RpcResult;
    case 'runtime.snapshot': {
      if (!signerSessionPromise) {
        return {
          runtime: 'cold' as const,
          status: null,
          snapshot: null,
          snapshotError: null
        };
      }
      const session = await signerSessionPromise;
      let snapshot: unknown = null;
      let snapshotError: string | null = null;
      try {
        snapshot = getRuntimeSnapshot(session.node);
        await savePersistedRuntimeSnapshot(session.key, JSON.stringify(snapshot));
      } catch (error) {
        snapshotError = toErrorMessage(error);
      }
      return {
        runtime: 'ready' as const,
        status: getRuntimeStatus(session.node),
        snapshot,
        snapshotError,
        lifecycle: getLifecycleSummary(session.diagnostics())
      };
    }
    case 'runtime.diagnostics': {
      if (!signerSessionPromise) {
        return {
          runtime: 'cold' as const,
          diagnostics: []
        };
      }
      const session = await signerSessionPromise;
      return {
        runtime: 'ready' as const,
        diagnostics: session.diagnostics(),
        dropped: session.droppedDiagnostics()
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
    void signerSessionPromise.then((session) => persistSessionSnapshot(session)).catch(() => undefined);
  }
  void stopSignerSession();
});
