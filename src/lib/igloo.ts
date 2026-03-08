import { SimplePool, finalizeEvent, getPublicKey, nip44, type Event, type Filter } from 'nostr-tools';
import { getEventHash, validateEvent, verifyEvent } from 'nostr-tools/pure';

import type { PeerPolicy } from '@/components/ui/peer-list';
import {
  createWasmBridgeRuntime,
  type WasmBridgeRuntimeApi
} from '@/lib/bridge-wasm-runtime';
import { createLogger } from '@/lib/observability';
import {
  normalizeNip44PayloadForJs,
  normalizeNip44PayloadForRust
} from '@/lib/nip44-normalize';

const DEFAULT_RELAYS_FALLBACK = ['ws://127.0.0.1:8194'];

function envDefaultRelays(): string[] {
  const raw = import.meta.env.VITE_DEFAULT_RELAYS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_RELAYS_FALLBACK;
  }
  const parsed = raw
    .split(/[,\s]+/)
    .map((relay) => relay.trim())
    .filter(Boolean);
  return parsed.length ? parsed : DEFAULT_RELAYS_FALLBACK;
}

export const DEFAULT_RELAYS = envDefaultRelays();

const BIFROST_EVENT_KIND_RAW = Number(import.meta.env.VITE_BIFROST_EVENT_KIND ?? 20000);
const BIFROST_EVENT_KIND = Number.isFinite(BIFROST_EVENT_KIND_RAW)
  ? BIFROST_EVENT_KIND_RAW
  : 20000;
const ONBOARD_TIMEOUT_MS = 20_000;
const PING_TIMEOUT_MS = 12_000;
const BRIDGE_COMMAND_TIMEOUT_MS = 35_000;
const PEER_ONLINE_GRACE_SECS = 120;
const logger = createLogger('igloo.runtime');

type RuntimeConfig = {
  mode: 'onboarding' | 'persisted';
  relays: string[];
  onboardPackage?: string;
  onboardPassword?: string;
  runtimeSnapshotJson?: string | null;
};

type RuntimeRestoreOptions = {
  runtimeSnapshotJson?: string | null;
};

type OnboardingDecoded = {
  share: {
    idx: number;
    seckey: string;
  };
  share_pubkey32: string;
  peer_pk_xonly: string;
  relays: string[];
  challenge_hex32?: string;
};

export type DecodedOnboardingProfile = {
  publicKey: string;
  peerPubkey: string;
  relays: string[];
};

type GroupMemberWire = {
  idx: number;
  pubkey: string;
};

type GroupPackageWire = {
  group_pk: string;
  threshold: number;
  members: GroupMemberWire[];
};

type RuntimeSnapshotWire = {
  bootstrap: {
    group: GroupPackageWire;
    share: {
      idx: number;
      seckey: string;
    };
    peers: string[];
  };
  state_hex: string;
};

type OnboardResponseWire = {
  group: GroupPackageWire;
  nonces: unknown[];
};

type BridgeEnvelope = {
  request_id: string;
  sent_at: number;
  payload: {
    type: string;
    data: unknown;
  };
};

export type ValidationResult = {
  isValid: boolean;
  error?: string;
};

export type PingResult = {
  success: boolean;
  latency?: number;
  error?: string;
};

export type NodeWithEvents = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export function validateOnboardingPassword(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Password is required' };
  }
  if (trimmed.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters' };
  }
  return { isValid: true };
}

type PeerPolicyPatch = {
  send: boolean;
  receive: boolean;
};

type PendingPing = {
  peer: string;
  startedAtMs: number;
  resolve: (value: PingResult) => void;
};

type PendingBridgeCommandKind = 'sign' | 'ecdh';

type PendingBridgeCommand = {
  kind: PendingBridgeCommandKind;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

function buildRequestId(idx: number): string {
  const ts = nowUnixSecs();
  const boot = Date.now();
  const seq = Math.floor(Math.random() * 1_000_000_000);
  return `${ts}-${idx}-${boot}-${seq}`;
}

const ensureArray = (value: string[]) =>
  Array.from(new Set(value.map((relay) => relay.replace(/\/$/, ''))));

function nowUnixSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toErrorMessage(value: unknown, fallback = 'Request failed'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value instanceof Error && value.message) return value.message;
  if (isRecord(value)) {
    const message = value.message;
    if (typeof message === 'string' && message.trim()) return message;
    const error = value.error;
    if (typeof error === 'string' && error.trim()) return error;
    const reason = value.reason;
    if (typeof reason === 'string' && reason.trim()) return reason;
  }
  return fallback;
}

function withContext(step: string, error: unknown): Error {
  return new Error(`${step}: ${toErrorMessage(error, 'unknown error')}`);
}

function isRelayUrl(value: string): boolean {
  return /^wss?:\/\/.+/.test(value);
}

function normalizePubkey32Hex(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return normalized;
  }
  if (/^(02|03)[0-9a-f]{64}$/.test(normalized)) {
    return normalized.slice(2);
  }
  throw new Error(`Invalid ${label}`);
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Invalid hex payload');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function parseBridgeEnvelope(value: string): BridgeEnvelope | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.request_id !== 'string') return null;
    if (!isRecord(parsed.payload)) return null;
    if (typeof parsed.payload.type !== 'string') return null;
    return {
      request_id: parsed.request_id,
      sent_at: Number(parsed.sent_at ?? 0),
      payload: {
        type: parsed.payload.type,
        data: parsed.payload.data
      }
    };
  } catch {
    return null;
  }
}

function allPolicyFlagsEnabled(value: unknown): boolean {
  if (!isRecord(value)) return true;
  const flags = ['echo', 'ping', 'onboard', 'sign', 'ecdh'];
  return flags.every((key) => value[key] !== false);
}

function parsePingCompletion(completion: unknown): { requestId: string; peer: string } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Ping;
  if (!isRecord(payload)) return null;

  const requestId = payload.request_id;
  const peer = payload.peer;
  if (typeof requestId !== 'string' || typeof peer !== 'string') return null;
  return { requestId, peer };
}

function parseSignCompletion(completion: unknown): { signatures: string[] } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Sign;
  if (!isRecord(payload) || !Array.isArray(payload.signatures_hex64)) return null;
  const signatures = payload.signatures_hex64.filter(
    (value): value is string => typeof value === 'string'
  );
  return signatures.length > 0 ? { signatures } : null;
}

function parseEcdhCompletion(completion: unknown): { sharedSecretHex32: string } | null {
  if (!isRecord(completion)) return null;
  const payload = completion.Ecdh;
  if (!isRecord(payload) || typeof payload.shared_secret_hex32 !== 'string') return null;
  return { sharedSecretHex32: payload.shared_secret_hex32.toLowerCase() };
}

function parseOperationFailure(
  failure: unknown
): { opType: string; message: string } | null {
  if (!isRecord(failure)) return null;
  if (typeof failure.op_type !== 'string' || typeof failure.message !== 'string') return null;
  return { opType: failure.op_type, message: failure.message };
}

function clearPendingCommand(pending: PendingBridgeCommand | null) {
  if (!pending) return;
  clearTimeout(pending.timeoutHandle);
}

function isNonceUnavailableError(error: unknown): boolean {
  return toErrorMessage(error).toLowerCase().includes('nonce unavailable');
}

async function deriveConversationKeyFromSharedSecret(sharedSecretHex32: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('nip44-v2'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sharedSecretBytes = new Uint8Array(hexToBytes(sharedSecretHex32));
  const digest = await crypto.subtle.sign('HMAC', key, sharedSecretBytes);
  return new Uint8Array(digest);
}

function buildUnsignedEvent(event: Record<string, unknown>, pubkey: string) {
  const candidate = {
    kind: event.kind,
    tags: event.tags ?? [],
    content: event.content ?? '',
    created_at:
      typeof event.created_at === 'number' ? event.created_at : Math.floor(Date.now() / 1000),
    pubkey
  };

  if (!validateEvent(candidate)) {
    throw new Error('Event failed validation');
  }

  return candidate;
}

class BrowserBridgeNode implements NodeWithEvents {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private pool: SimplePool | null = null;
  private relaySubscription: { close: (reason?: string) => void } | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private runtime: WasmBridgeRuntimeApi | null = null;

  private activeRelays: string[] = [];
  private localSharePubkey32 = '';
  private groupPubkey32 = '';
  private peerPubkeys32 = new Set<string>();
  private xonlyToPeer32 = new Map<string, string>();
  private peerLastSeenAt = new Map<string, number>();
  private pendingPings: PendingPing[] = [];
  private pendingCommand: PendingBridgeCommand | null = null;
  private commandChain: Promise<void> = Promise.resolve();
  private readonly nodeLogger = logger;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly restoreOptions: RuntimeRestoreOptions = {}
  ) {}

  on(event: string, handler: (...args: unknown[]) => void) {
    const set = this.handlers.get(event) || new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.get(event)?.delete(handler);
  }

  removeListener(event: string, handler: (...args: unknown[]) => void) {
    this.off(event, handler);
  }

  private emit(event: string, ...args: unknown[]) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(...args);
    }
  }

  private emitLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    domain: string,
    event: string,
    detail?: Record<string, unknown>
  ) {
    const nextEvent = this.nodeLogger[level](domain, event, detail);
    if (nextEvent) {
      this.emit('message', nextEvent);
    }
  }

  async connect() {
    try {
      this.runtime = await createWasmBridgeRuntime();
    } catch (error) {
      throw withContext('Failed to load WASM runtime', error);
    }

    let decoded: OnboardingDecoded | null = null;
    if (this.config.mode === 'onboarding') {
      try {
        decoded = this.decodeOnboardingPackage(
          this.config.onboardPackage ?? '',
          this.config.onboardPassword ?? ''
        );
      } catch (error) {
        throw withContext('Failed to decode onboarding package', error);
      }
      this.localSharePubkey32 = decoded.share_pubkey32.toLowerCase();
      this.emitLog('info', 'onboarding', 'package_decoded', {
        mode: this.config.mode,
        share_pubkey32: decoded.share_pubkey32.toLowerCase(),
        peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
        challenge_hex32: decoded.challenge_hex32 ?? null,
        relay_count: decoded.relays.length
      });
    }

    const mergedRelays = normalizeRelays([
      ...this.config.relays,
      ...(decoded?.relays ?? [])
    ]);
    this.activeRelays = mergedRelays.relays;
    this.emitLog('info', 'runtime', 'connect_begin', {
      mode: this.config.mode,
      relay_count: this.activeRelays.length,
      relays: this.activeRelays
    });

    this.pool = new SimplePool();

    const runtimeConfig = {
      device: {
        sign_timeout_secs: 30,
        ecdh_timeout_secs: 30,
        ping_timeout_secs: 15,
        onboard_timeout_secs: 30,
        request_ttl_secs: 300,
        max_future_skew_secs: 30,
        request_cache_limit: 2048,
        ecdh_cache_capacity: 256,
        ecdh_cache_ttl_secs: 300,
        sig_cache_capacity: 256,
        sig_cache_ttl_secs: 120,
        state_save_interval_secs: 30,
        event_kind: BIFROST_EVENT_KIND,
        peer_selection_strategy: 'deterministic_sorted'
      }
    };

    if (this.config.mode === 'persisted') {
      const restored = this.tryRestoreRuntime(runtimeConfig);
      if (!restored) {
        throw new Error('Failed to restore runtime snapshot');
      }
    } else {
      let onboardResponse: OnboardResponseWire;
      try {
        onboardResponse = await this.requestOnboardResponse(decoded!);
      } catch (error) {
        throw withContext('Failed during onboard request', error);
      }
      this.emitLog('info', 'onboarding', 'response_received', {
        peer_pubkey32: decoded!.peer_pk_xonly.toLowerCase(),
        nonce_count: Array.isArray(onboardResponse.nonces) ? onboardResponse.nonces.length : 0,
        group_member_count: Array.isArray(onboardResponse.group.members)
          ? onboardResponse.group.members.length
          : 0
      });

      const group = onboardResponse.group;
      const bootstrapPeer = decoded!.peer_pk_xonly.toLowerCase();
      const bootstrap = {
        group,
        share: decoded!.share,
        peers: this.applyGroupState(group),
        initial_peer_nonces:
          this.peerPubkeys32.has(bootstrapPeer) && Array.isArray(onboardResponse.nonces)
            ? [
                {
                  peer: bootstrapPeer,
                  nonces: onboardResponse.nonces
                }
              ]
            : []
      };

      try {
        this.runtime.init_runtime(JSON.stringify(runtimeConfig), JSON.stringify(bootstrap));
      } catch (error) {
        throw withContext('Failed to initialize signer runtime', error);
      }
    }

    this.subscribeRelayIngress(nowUnixSecs());

    this.tickHandle = setInterval(() => {
      this.pumpRuntime(Date.now());
    }, 1_000);

    this.pumpRuntime(Date.now());

    this.emitLog('info', 'runtime', 'bootstrap_complete', {
      relays: this.activeRelays,
      peers: Array.from(this.peerPubkeys32),
      public_key: this.groupPubkey32,
      event_kind: BIFROST_EVENT_KIND
    });

    this.emit('ready');

    const bootstrapPeers = Array.from(this.peerPubkeys32);
    void Promise.allSettled(bootstrapPeers.map((peer) => this.pingPeer(peer))).then((results) => {
      this.emitLog('debug', 'runtime', 'bootstrap_peer_refresh_complete', {
        peers_total: bootstrapPeers.length,
        peers_ok: results.filter((result) => {
          return (
            result.status === 'fulfilled' &&
            result.value &&
            typeof result.value === 'object' &&
            'success' in result.value &&
            result.value.success === true
          );
        }).length
      });
    });
  }

  async shutdown() {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }

    this.relaySubscription?.close('shutdown');
    this.relaySubscription = null;

    if (this.pool) {
      this.pool.close(this.activeRelays);
      this.pool.destroy();
      this.pool = null;
    }

    while (this.pendingPings.length > 0) {
      const pending = this.pendingPings.shift();
      pending?.resolve({ success: false, error: 'Signer stopped' });
    }

    if (this.pendingCommand) {
      const pending = this.pendingCommand;
      this.pendingCommand = null;
      clearPendingCommand(pending);
      pending.reject(new Error('Signer stopped'));
    }

    this.emit('closed');
  }

  getPublicKey(): string {
    if (!this.groupPubkey32) {
      throw new Error('runtime not initialized');
    }
    return this.groupPubkey32;
  }

  async fetchPeers(seed: PeerPolicy[]): Promise<PeerPolicy[]> {
    if (!this.runtime) throw new Error('runtime not initialized');

    const base = new Map<string, PeerPolicy>();
    for (const peer of seed) {
      base.set(peer.pubkey.toLowerCase(), peer);
    }

    try {
      const policiesJson = this.runtime.policies_json();
      const policiesParsed = JSON.parse(policiesJson) as unknown;
      if (isRecord(policiesParsed)) {
        for (const [pubkey, policy] of Object.entries(policiesParsed)) {
          const normalized = pubkey.toLowerCase();
          const existing = base.get(normalized);
          base.set(normalized, {
            alias: existing?.alias || `Peer ${base.size + 1}`,
            pubkey,
            send: allPolicyFlagsEnabled(isRecord(policy) ? policy.request : undefined),
            receive: allPolicyFlagsEnabled(isRecord(policy) ? policy.respond : undefined),
            state: existing?.state || 'offline'
          });
        }
      }
    } catch (error) {
      this.emitLog('warn', 'runtime', 'policies_error', {
        error_message: toErrorMessage(error, 'failed to read policies')
      });
    }

    for (const peer of this.peerPubkeys32) {
      if (!base.has(peer)) {
        base.set(peer, {
          alias: `Peer ${base.size + 1}`,
          pubkey: peer,
          send: true,
          receive: true,
          state: 'offline'
        });
      }
    }

    const now = nowUnixSecs();
    const peers = Array.from(base.values()).map((peer) => {
      const normalized = peer.pubkey.toLowerCase();
      const seen = this.peerLastSeenAt.get(normalized) || 0;
      const online = now - seen <= PEER_ONLINE_GRACE_SECS;
      return {
        ...peer,
        pubkey: normalized,
        state: online ? 'online' : 'offline'
      } as PeerPolicy;
    });

    peers.sort((a, b) => a.pubkey.localeCompare(b.pubkey));
    return peers;
  }

  async pingPeer(pubkey: string): Promise<PingResult> {
    if (!this.runtime) return { success: false, error: 'runtime not initialized' };

    const normalized = pubkey.toLowerCase();

    return await new Promise<PingResult>((resolve) => {
      const pending: PendingPing = {
        peer: normalized,
        startedAtMs: Date.now(),
        resolve
      };

      this.pendingPings.push(pending);

      setTimeout(() => {
        const index = this.pendingPings.indexOf(pending);
        if (index >= 0) {
          this.pendingPings.splice(index, 1);
          resolve({ success: false, error: 'Ping timed out' });
        }
      }, PING_TIMEOUT_MS);

      try {
        this.runtime?.handle_command(
          JSON.stringify({ type: 'ping', peer_pubkey32_hex: normalized })
        );
        this.pumpRuntime(Date.now());
      } catch (error) {
        const index = this.pendingPings.indexOf(pending);
        if (index >= 0) this.pendingPings.splice(index, 1);
        resolve({ success: false, error: toErrorMessage(error, 'Ping failed') });
      }
    });
  }

  async updatePeerPolicy(pubkey: string, policy: PeerPolicyPatch): Promise<void> {
    if (!this.runtime) throw new Error('runtime not initialized');

    this.runtime.set_policy(
      JSON.stringify({
        peer: pubkey.toLowerCase(),
        send: policy.send,
        receive: policy.receive
      })
    );

    this.pumpRuntime(Date.now());
  }

  async signNostrEvent(event: Record<string, unknown>): Promise<Event> {
    const pubkey = this.getPublicKey();
    const unsigned = buildUnsignedEvent(event, pubkey);
    const id = getEventHash(unsigned);
    let sig: string;

    try {
      sig = await this.runBridgeCommand('sign', {
        type: 'sign',
        message_hex_32: id
      });
    } catch (error) {
      if (!isNonceUnavailableError(error)) {
        throw error;
      }

      await this.refreshSignReadiness().catch(() => undefined);
      sig = await this.runBridgeCommand('sign', {
        type: 'sign',
        message_hex_32: id
      });
    }

    const signedEvent = {
      ...unsigned,
      id,
      sig
    };

    if (!verifyEvent(signedEvent)) {
      throw new Error('Signed event failed verification');
    }

    return signedEvent;
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (typeof plaintext !== 'string') {
      throw new Error('NIP-44 plaintext must be a string');
    }

    const sharedSecretHex32 = await this.runBridgeCommand('ecdh', {
      type: 'ecdh',
      pubkey32_hex: pubkey.toLowerCase()
    });
    const conversationKey = await deriveConversationKeyFromSharedSecret(sharedSecretHex32);
    return normalizeNip44PayloadForRust(nip44.v2.encrypt(plaintext, conversationKey));
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (typeof ciphertext !== 'string') {
      throw new Error('NIP-44 ciphertext must be a string');
    }

    const sharedSecretHex32 = await this.runBridgeCommand('ecdh', {
      type: 'ecdh',
      pubkey32_hex: pubkey.toLowerCase()
    });
    const conversationKey = await deriveConversationKeyFromSharedSecret(sharedSecretHex32);
    return nip44.v2.decrypt(normalizeNip44PayloadForJs(ciphertext), conversationKey);
  }

  snapshotRuntimeState(): unknown {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    return JSON.parse(this.runtime.snapshot_state_json());
  }

  runtimeStatus(): unknown {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    return JSON.parse(this.runtime.status_json());
  }

  private async refreshSignReadiness(): Promise<void> {
    const peers = Array.from(this.peerPubkeys32);
    if (peers.length === 0) {
      throw new Error('nonce unavailable and no peers are configured');
    }

    const results = await Promise.allSettled(peers.map((peer) => this.pingPeer(peer)));
    const hadSuccess = results.some(
      (result) => result.status === 'fulfilled' && result.value.success
    );

    if (!hadSuccess) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (firstFailure) {
        throw new Error(`Failed to refresh peer nonces: ${toErrorMessage(firstFailure.reason)}`);
      }

      const firstResolvedFailure = results.find(
        (result): result is PromiseFulfilledResult<PingResult> =>
          result.status === 'fulfilled' && !result.value.success
      );
      if (firstResolvedFailure) {
        throw new Error(
          `Failed to refresh peer nonces: ${firstResolvedFailure.value.error ?? 'peer ping failed'}`
        );
      }

      throw new Error('Failed to refresh peer nonces');
    }
  }

  private decodeOnboardingPackage(value: string, password: string): OnboardingDecoded {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    const decodedJson = this.runtime.decode_onboarding_package_json_with_password(
      value.trim(),
      password
    );
    const decoded = JSON.parse(decodedJson) as unknown;
    if (!isRecord(decoded)) {
      throw new Error('Invalid onboarding package decode result');
    }

    if (!isRecord(decoded.share)) {
      throw new Error('Onboarding package missing share payload');
    }

    const idx = decoded.share.idx;
    const seckey = decoded.share.seckey;
    const sharePubkey32 = decoded.share_pubkey32;
    const peerPkXonly = decoded.peer_pk_xonly;
    const relays = decoded.relays;
    const challengeHex32 = decoded.challenge_hex32;

    if (typeof idx !== 'number' || typeof seckey !== 'string') {
      throw new Error('Invalid onboarding share payload');
    }
    if (typeof sharePubkey32 !== 'string' || sharePubkey32.length !== 64) {
      throw new Error('Invalid onboarding share pubkey');
    }
    if (typeof peerPkXonly !== 'string' || peerPkXonly.length !== 64) {
      throw new Error('Invalid onboarding peer key');
    }

    return {
      share: { idx, seckey },
      share_pubkey32: sharePubkey32,
      peer_pk_xonly: peerPkXonly,
      relays: Array.isArray(relays)
        ? relays.filter((relay): relay is string => typeof relay === 'string')
        : [],
      ...(typeof challengeHex32 === 'string' ? { challenge_hex32: challengeHex32 } : {})
    };
  }

  private applyGroupState(group: GroupPackageWire): string[] {
    this.groupPubkey32 = normalizePubkey32Hex(group.group_pk, 'group public key');
    this.peerPubkeys32 = new Set(
      group.members
        .map((member) => normalizePubkey32Hex(member.pubkey, `group member ${member.idx} pubkey`))
        .filter((pubkey) => pubkey !== this.localSharePubkey32)
    );

    this.xonlyToPeer32.clear();
    for (const member of group.members) {
      const peer32 = normalizePubkey32Hex(member.pubkey, `group member ${member.idx} pubkey`);
      this.xonlyToPeer32.set(peer32, peer32);
    }

    return Array.from(this.peerPubkeys32);
  }

  private parseRuntimeSnapshot(): RuntimeSnapshotWire | null {
    const snapshotJson = this.restoreOptions.runtimeSnapshotJson;
    if (typeof snapshotJson !== 'string' || !snapshotJson.trim()) {
      this.emitLog('info', 'runtime', 'restore_skipped', {
        reason: 'missing_snapshot'
      });
      return null;
    }

    try {
      const parsed = JSON.parse(snapshotJson) as unknown;
      if (!isRecord(parsed) || !isRecord(parsed.bootstrap) || !isRecord(parsed.bootstrap.group)) {
        this.emitLog('warn', 'runtime', 'restore_skipped', {
          reason: 'invalid_snapshot_shape'
        });
        return null;
      }
      if (typeof parsed.state_hex !== 'string' || !parsed.state_hex.trim()) {
        this.emitLog('warn', 'runtime', 'restore_skipped', {
          reason: 'missing_state_hex'
        });
        return null;
      }

      return parsed as RuntimeSnapshotWire;
    } catch {
      this.emitLog('warn', 'runtime', 'restore_skipped', {
        reason: 'snapshot_json_parse_failed'
      });
      return null;
    }
  }

  private tryRestoreRuntime(runtimeConfig: Record<string, unknown>): boolean {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    const snapshot = this.parseRuntimeSnapshot();
    if (!snapshot) return false;

    try {
      this.localSharePubkey32 = normalizePubkey32Hex(
        getPublicKey(hexToBytes(snapshot.bootstrap.share.seckey)),
        'share public key'
      );
      this.applyGroupState(snapshot.bootstrap.group);
      this.runtime.restore_runtime(JSON.stringify(runtimeConfig), this.restoreOptions.runtimeSnapshotJson!);
      this.emitLog('info', 'runtime', 'restored', {
        mode: 'persisted',
        peers: Array.from(this.peerPubkeys32),
        public_key: this.groupPubkey32
      });
      return true;
    } catch (error) {
      this.emitLog('error', 'runtime', 'restore_failed', {
        error_message: toErrorMessage(error, 'failed to restore runtime snapshot')
      });
      this.groupPubkey32 = '';
      this.peerPubkeys32.clear();
      this.xonlyToPeer32.clear();
      return false;
    }
  }

  private async requestOnboardResponse(
    decoded: OnboardingDecoded
  ): Promise<OnboardResponseWire> {
    if (!this.pool) throw new Error('relay pool not initialized');

    const now = nowUnixSecs();
    const requestId = buildRequestId(decoded.share.idx);
    const shareSecret = hexToBytes(decoded.share.seckey);

    const requestEnvelope: BridgeEnvelope = {
      request_id: requestId,
      sent_at: now,
      payload: {
          type: 'OnboardRequest',
          data: {
          share_pk: decoded.share_pubkey32.toLowerCase(),
          idx: decoded.share.idx,
          ...(decoded.challenge_hex32 ? { challenge: decoded.challenge_hex32.toLowerCase() } : {})
        }
      }
    };
    this.emitLog('info', 'onboarding', 'request_start', {
      request_id: requestId,
      peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
      share_pubkey32: decoded.share_pubkey32.toLowerCase(),
      challenge_hex32: decoded.challenge_hex32 ?? null,
      relays: this.activeRelays
    });

    const conversationKey = nip44.v2.utils.getConversationKey(
      shareSecret,
      decoded.peer_pk_xonly
    );

    const filter = {
      kinds: [BIFROST_EVENT_KIND],
      authors: [decoded.peer_pk_xonly],
      '#p': [decoded.share_pubkey32.toLowerCase()],
      since: now - 5
    } as Filter;

    return await new Promise<OnboardResponseWire>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          subscription.close('onboard-timeout');
          this.emitLog('warn', 'onboarding', 'request_timeout', {
            request_id: requestId,
            peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
            share_pubkey32: decoded.share_pubkey32.toLowerCase(),
            challenge_hex32: decoded.challenge_hex32 ?? null,
            relays: this.activeRelays
          });
          reject(
            new Error(
              `Onboard response timed out (request_id=${requestId}, relays=${this.activeRelays.join(',')})`
            )
          );
        });
      }, ONBOARD_TIMEOUT_MS);

      const subscription = this.pool!.subscribeMany(this.activeRelays, filter, {
        onevent: (event: Event) => {
          try {
            const decrypted = nip44.v2.decrypt(
              normalizeNip44PayloadForJs(event.content),
              conversationKey
            );
            const envelope = parseBridgeEnvelope(decrypted);
            if (!envelope) return;
            if (envelope.request_id !== requestId) return;
            if (envelope.payload.type !== 'OnboardResponse') return;
            if (!isRecord(envelope.payload.data)) return;
            if (!isRecord(envelope.payload.data.group)) return;

            finish(() => {
              clearTimeout(timer);
              subscription.close('onboard-complete');
              this.emitLog('info', 'onboarding', 'request_complete', {
                request_id: requestId,
                peer_pubkey32: decoded.peer_pk_xonly.toLowerCase(),
                share_pubkey32: decoded.share_pubkey32.toLowerCase()
              });
              resolve(envelope.payload.data as OnboardResponseWire);
            });
          } catch {
            // Ignore unrelated payloads.
          }
        },
        onclose: (reasons) => {
          if (settled) return;
          finish(() => {
            clearTimeout(timer);
            this.emitLog('warn', 'onboarding', 'request_closed', {
              request_id: requestId,
              reasons
            });
            reject(
              new Error(
                `Relay subscription closed before onboard response: ${reasons.join(', ')}`
              )
            );
          });
        }
      });

      const encrypted = normalizeNip44PayloadForRust(
        nip44.v2.encrypt(JSON.stringify(requestEnvelope), conversationKey)
      );
      const event = finalizeEvent(
        {
          kind: BIFROST_EVENT_KIND,
          tags: [['p', decoded.peer_pk_xonly.toLowerCase()]],
          content: encrypted,
          created_at: now
        },
        shareSecret
      );

      const publishResults = this.pool!.publish(this.activeRelays, event);
      Promise.allSettled(publishResults).then((results) => {
        this.emitLog('debug', 'onboarding', 'request_publish', {
          request_id: requestId,
          relays_ok: results.filter((entry) => entry.status === 'fulfilled').length,
          relays_total: results.length
        });
        const hasSuccess = results.some((entry) => entry.status === 'fulfilled');
        if (!hasSuccess && !settled) {
          finish(() => {
            clearTimeout(timer);
            subscription.close('onboard-publish-failed');
            reject(
              new Error(
                `Failed to publish onboard request to relays (request_id=${requestId})`
              )
            );
          });
        }
      });
    });
  }

  private subscribeRelayIngress(sinceUnixSecs: number) {
    if (!this.pool) throw new Error('relay pool not initialized');

    const authors = Array.from(this.xonlyToPeer32.keys());
    const filter = {
      kinds: [BIFROST_EVENT_KIND],
      authors,
      '#p': [this.localSharePubkey32],
      since: sinceUnixSecs
    } as Filter;

    this.relaySubscription = this.pool.subscribeMany(this.activeRelays, filter, {
      onevent: (event: Event) => {
        const sender = this.xonlyToPeer32.get(event.pubkey.toLowerCase());
        if (sender) {
          this.peerLastSeenAt.set(sender, event.created_at);
        }

        try {
          this.runtime?.handle_inbound_event(JSON.stringify(event));
          this.pumpRuntime(Date.now());
        } catch (error) {
          this.emitLog('warn', 'runtime', 'inbound_error', {
            error_message: toErrorMessage(error, 'failed to ingest inbound event')
          });
        }

        this.emitLog('debug', 'relay', 'inbound_event', {
          event_id: event.id,
          event_pubkey: event.pubkey,
          event_created_at: event.created_at,
          event_kind: event.kind
        });
      },
      onclose: (reasons) => {
        this.emitLog('warn', 'relay', 'subscription_closed', {
          reasons
        });
      }
    });
  }

  private pumpRuntime(nowMs: number) {
    if (!this.runtime) return;

    try {
      this.runtime.tick(nowMs);

      const outboundRaw = this.runtime.drain_outbound_events_json();
      const outboundEvents = JSON.parse(outboundRaw) as unknown;
      if (Array.isArray(outboundEvents) && this.pool) {
        for (const event of outboundEvents) {
          if (!isRecord(event)) continue;
          const outboundEvent = event as unknown as Event;
          const publishResults = this.pool.publish(this.activeRelays, outboundEvent);
          Promise.allSettled(publishResults).then((results) => {
            const succeeded = results.filter((entry) => entry.status === 'fulfilled').length;
            this.emitLog('debug', 'relay', 'publish_complete', {
              event_id: outboundEvent.id,
              relays_ok: succeeded,
              relays_total: results.length
            });
          });
        }
      }

      const completionsRaw = this.runtime.drain_completions_json();
      const completions = JSON.parse(completionsRaw) as unknown;
      if (Array.isArray(completions)) {
        for (const completion of completions) {
          this.emitLog('debug', 'runtime', 'completion', { completion });

          const ping = parsePingCompletion(completion);
          if (ping) {
            const index = this.pendingPings.findIndex(
              (entry) => entry.peer === ping.peer.toLowerCase()
            );
            if (index >= 0) {
              const pending = this.pendingPings.splice(index, 1)[0];
              pending.resolve({
                success: true,
                latency: Date.now() - pending.startedAtMs
              });
            }
          }

          const sign = parseSignCompletion(completion);
          if (sign && this.pendingCommand?.kind === 'sign') {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            pending.resolve(sign.signatures[0]);
          }

          const ecdh = parseEcdhCompletion(completion);
          if (ecdh && this.pendingCommand?.kind === 'ecdh') {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            pending.resolve(ecdh.sharedSecretHex32);
          }

        }
      }

      const failuresRaw = this.runtime.drain_failures_json();
      const failures = JSON.parse(failuresRaw) as unknown;
      if (Array.isArray(failures)) {
        for (const failure of failures) {
          this.emitLog('warn', 'runtime', 'failure', { failure });

          const parsedFailure = parseOperationFailure(failure);
          if (parsedFailure?.opType === 'ping' && this.pendingPings.length > 0) {
            const pending = this.pendingPings.shift();
            pending?.resolve({
              success: false,
              error: parsedFailure.message || 'Ping round failed'
            });
          }

          if (
            parsedFailure &&
            this.pendingCommand &&
            parsedFailure.opType === this.pendingCommand.kind
          ) {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            pending.reject(new Error(parsedFailure.message));
          }

        }
      }
    } catch (error) {
      this.emitLog('error', 'runtime', 'pump_failed', {
        error_message: toErrorMessage(error, 'Runtime pump failed')
      });
      this.emit('error', new Error(toErrorMessage(error, 'Runtime pump failed')));
    }
  }

  private enqueueCommand<T>(run: () => Promise<T>): Promise<T> {
    const next = this.commandChain.then(run, run);
    this.commandChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async runBridgeCommand(
    kind: PendingBridgeCommandKind,
    command: Record<string, unknown>
  ): Promise<string> {
    if (!this.runtime) {
      throw new Error('runtime not initialized');
    }

    return await this.enqueueCommand(
      () =>
        new Promise<string>((resolve, reject) => {
          this.emitLog('debug', 'bridge', 'command_start', {
            command_kind: kind
          });
          const timeoutHandle = setTimeout(() => {
            if (!this.pendingCommand || this.pendingCommand.kind !== kind) return;
            this.pendingCommand = null;
            this.emitLog('warn', 'bridge', 'command_timeout', {
              command_kind: kind
            });
            reject(new Error(`${kind} command timed out`));
          }, BRIDGE_COMMAND_TIMEOUT_MS);

          this.pendingCommand = {
            kind,
            resolve,
            reject,
            timeoutHandle
          };

          try {
            this.runtime?.handle_command(JSON.stringify(command));
            this.pumpRuntime(Date.now());
          } catch (error) {
            const pending = this.pendingCommand;
            this.pendingCommand = null;
            clearPendingCommand(pending);
            this.emitLog('error', 'bridge', 'command_failed', {
              command_kind: kind,
              error_message: toErrorMessage(error, `${kind} command failed`)
            });
            reject(new Error(toErrorMessage(error, `${kind} command failed`)));
          }
        })
    );
  }
}

function isBrowserBridgeNode(node: NodeWithEvents): node is BrowserBridgeNode {
  return (
    typeof (node as BrowserBridgeNode).connect === 'function' &&
    typeof (node as BrowserBridgeNode).shutdown === 'function' &&
    typeof (node as BrowserBridgeNode).fetchPeers === 'function'
  );
}

export async function decodeOnboardingProfile(
  value: string,
  password: string
): Promise<DecodedOnboardingProfile> {
  const runtime = await createWasmBridgeRuntime();
  const decodedRaw = runtime.decode_onboarding_package_json_with_password(
    value.trim(),
    password
  );
  const decoded = JSON.parse(decodedRaw) as Record<string, unknown>;
  const publicKey = decoded.share_pubkey32;
  const peerPubkey = decoded.peer_pk_xonly;
  const relays = decoded.relays;

  if (typeof publicKey !== 'string' || publicKey.length !== 64) {
    throw new Error('Decoded onboarding payload is missing a valid share pubkey');
  }

  if (typeof peerPubkey !== 'string' || peerPubkey.length !== 64) {
    throw new Error('Decoded onboarding payload is missing a valid peer pubkey');
  }

  return {
    publicKey: publicKey.toLowerCase(),
    peerPubkey: peerPubkey.toLowerCase(),
    relays: Array.isArray(relays)
      ? relays.filter((relay): relay is string => typeof relay === 'string')
      : []
  };
}

export function validateOnboardCredential(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Onboarding package is required' };
  }

  if (!trimmed.startsWith('bfonboard1')) {
    return { isValid: false, error: 'Onboarding package must start with bfonboard1' };
  }

  if (!/^bfonboard1[023456789acdefghjklmnpqrstuvwxyz]+$/.test(trimmed)) {
    return { isValid: false, error: 'Onboarding package must be valid bech32m text' };
  }

  if (trimmed.length < 48) {
    return { isValid: false, error: 'Onboarding package is too short' };
  }

  return { isValid: true };
}

export function normalizeRelays(relays: string[]): { relays: string[]; errors: string[] } {
  const base = relays.filter((relay) => typeof relay === 'string' && relay.trim().length > 0);
  const normalized = ensureArray(base.map((relay) => relay.trim()));

  const valid = normalized.filter(isRelayUrl);
  const errors = normalized
    .filter((relay) => !isRelayUrl(relay))
    .map((relay) => `Invalid relay URL: ${relay}`);

  return {
    relays: valid.length ? valid : DEFAULT_RELAYS,
    errors
  };
}

export function createSignerNode(
  config: RuntimeConfig,
  restoreOptions?: RuntimeRestoreOptions
): NodeWithEvents {
  return new BrowserBridgeNode(config, restoreOptions);
}

export async function connectSignerNode(node: NodeWithEvents) {
  if (!isBrowserBridgeNode(node)) {
    throw new Error('Unsupported signer node implementation');
  }
  await node.connect();
}

export async function startSignerNode(config: RuntimeConfig) {
  const node = createSignerNode(config);
  await connectSignerNode(node);
  return node;
}

export function stopSignerNode(node: NodeWithEvents | null) {
  if (!node || !isBrowserBridgeNode(node)) return;
  void node.shutdown();
}

export async function refreshPeerStatuses(
  node: NodeWithEvents,
  peers: PeerPolicy[]
): Promise<PeerPolicy[]> {
  if (!isBrowserBridgeNode(node)) return peers;

  try {
    return await node.fetchPeers(peers);
  } catch (error) {
    logger.warn('ui', 'refresh_peers_failed', {
      error_message: toErrorMessage(error, 'failed to refresh peer status')
    });
    return peers;
  }
}

export async function pingSinglePeer(node: NodeWithEvents, pubkey: string): Promise<PingResult> {
  if (!isBrowserBridgeNode(node)) {
    return { success: false, error: 'Unsupported signer node implementation' };
  }

  try {
    return await node.pingPeer(pubkey);
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error, 'Ping failed')
    };
  }
}

export async function setPeerPolicy(
  node: NodeWithEvents,
  pubkey: string,
  patch: PeerPolicyPatch
): Promise<void> {
  if (!isBrowserBridgeNode(node)) {
    throw new Error('Unsupported signer node implementation');
  }
  await node.updatePeerPolicy(pubkey, patch);
}

export function detachEvent(
  node: NodeWithEvents,
  event: string,
  handler: (...args: unknown[]) => void
) {
  try {
    if (typeof node.off === 'function') {
      node.off(event, handler);
    } else if (typeof node.removeListener === 'function') {
      node.removeListener(event, handler);
    }
  } catch (error) {
    logger.warn('runtime', 'detach_listener_failed', {
      event_name: event,
      error_message: toErrorMessage(error, `Failed to detach event ${event}`)
    });
  }
}

export async function signNostrEvent(
  node: NodeWithEvents,
  event: Record<string, unknown>
): Promise<Event> {
  if (!isBrowserBridgeNode(node) || typeof node.signNostrEvent !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.signNostrEvent(event);
}

export function getPublicKeyFromNode(node: NodeWithEvents): string {
  if (!isBrowserBridgeNode(node) || typeof node.getPublicKey !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.getPublicKey();
}

export async function nip44EncryptWithNode(
  node: NodeWithEvents,
  pubkey: string,
  plaintext: string
): Promise<string> {
  if (!isBrowserBridgeNode(node) || typeof node.nip44Encrypt !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.nip44Encrypt(pubkey, plaintext);
}

export async function nip44DecryptWithNode(
  node: NodeWithEvents,
  pubkey: string,
  ciphertext: string
): Promise<string> {
  if (!isBrowserBridgeNode(node) || typeof node.nip44Decrypt !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return await node.nip44Decrypt(pubkey, ciphertext);
}

export function getRuntimeSnapshot(node: NodeWithEvents): unknown {
  if (!isBrowserBridgeNode(node) || typeof node.snapshotRuntimeState !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.snapshotRuntimeState();
}

export function getRuntimeStatus(node: NodeWithEvents): unknown {
  if (!isBrowserBridgeNode(node) || typeof node.runtimeStatus !== 'function') {
    throw new Error('Unsupported signer node implementation');
  }
  return node.runtimeStatus();
}
