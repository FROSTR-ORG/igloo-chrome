// Dev/test-only scenario seam. When the options page is loaded with a
// `?__frostr_dev=<name>` query param, the store hydrates a fixed in-memory
// ExtensionStateSnapshot instead of fetching real state from the background
// service worker — including a *running* runtime, which normally only exists
// while the background hosts a live signer and cannot be seeded from storage.
// This lets `make screenshot CLIENT=chrome` (and agents) render states like the
// running signer dashboard headlessly, without a configured profile or signer.
//
// It is inert in production: nothing reads it unless the query param is present,
// and it never writes to storage or talks to the background. Mirrors igloo-pwa's
// resolveDevScenario and igloo-home's resolveVisualScenario.

import type {
  ExtensionStateSnapshot,
  LifecycleStatusSnapshot,
  RuntimeMetadata,
  RuntimePeerStatus,
  RuntimeReadiness,
  RuntimeStatusSummary,
  StoredExtensionProfile,
} from '@/extension/protocol';

const DEV_SCENARIO_PARAM = '__frostr_dev';

const GROUP_PK = '02'.repeat(32);
const SHARE_PK = '11'.repeat(32);
const PEER_A = '03a3f8c2d1'.padEnd(64, '0');
const PEER_B = '02d7e1b93b'.padEnd(64, '0');

const fixtureProfile: StoredExtensionProfile = {
  id: 'dev-scenario-device',
  groupName: 'Dev Signing Key',
  relays: ['ws://127.0.0.1:8194'],
  groupPublicKey: GROUP_PK,
  sharePublicKey: SHARE_PK,
  publicKey: SHARE_PK,
  peerPubkey: PEER_A,
  signerSettings: {
    sign_timeout_secs: 30,
    ping_timeout_secs: 15,
    request_ttl_secs: 300,
    state_save_interval_secs: 30,
    peer_selection_strategy: 'deterministic_sorted',
  },
};

function fixturePeer(idx: number, pubkey: string, online: boolean): RuntimePeerStatus {
  return {
    idx,
    pubkey,
    known: true,
    last_seen: online ? 1_700_000_000 : null,
    online,
    incoming_available: online ? 92 : 0,
    outgoing_available: online ? 78 : 0,
    outgoing_spent: online ? 14 : 0,
    can_sign: online,
    can_ecdh: online,
    can_ping: online,
    should_send_nonces: online,
    last_response_latency_ms: online ? 24 : null,
    avg_latency_ms: online ? 31 : null,
    nonce_history: [],
  } as unknown as RuntimePeerStatus;
}

const readiness: RuntimeReadiness = {
  runtime_ready: true,
  restore_complete: true,
  sign_ready: true,
  ecdh_ready: true,
  threshold: 2,
} as unknown as RuntimeReadiness;

const metadata: RuntimeMetadata = {
  device_id: fixtureProfile.id,
  member_idx: 1,
  share_public_key: SHARE_PK,
  group_public_key: GROUP_PK,
  peers: [PEER_A, PEER_B],
};

// A representative running runtime: signer online with two peers (one online,
// one offline) so the dashboard renders the Peers card with content.
const runningSummary: RuntimeStatusSummary = {
  status: {
    device_id: fixtureProfile.id,
    pending_ops: 0,
    last_active: 1_700_000_000,
    known_peers: 2,
    request_seq: 7,
  },
  metadata,
  readiness,
  peers: [fixturePeer(0, PEER_A, true), fixturePeer(2, PEER_B, false)],
  peer_permission_states: [],
  pending_operations: [],
  pending_approvals: [],
  connected_relays: ['ws://127.0.0.1:8194'],
  configured_relays: ['ws://127.0.0.1:8194'],
} as unknown as RuntimeStatusSummary;

const idleLifecycle: LifecycleStatusSnapshot = {
  onboarding: { stage: 'idle', updatedAt: null, lastError: null },
  activation: {
    stage: 'idle',
    updatedAt: null,
    lastError: null,
    restoredFromSnapshot: false,
    runtime: 'cold',
  },
};

const readyLifecycle: LifecycleStatusSnapshot = {
  onboarding: { stage: 'idle', updatedAt: null, lastError: null },
  activation: {
    stage: 'ready',
    updatedAt: 1_700_000_000_000,
    lastError: null,
    restoredFromSnapshot: true,
    runtime: 'ready',
  },
};

function configuredBase(): ExtensionStateSnapshot {
  return {
    configured: true,
    profile: fixtureProfile,
    profiles: [
      {
        id: fixtureProfile.id,
        label: fixtureProfile.groupName ?? 'Dev Signing Key',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        unlocked: true,
      },
    ],
    activeProfileId: fixtureProfile.id,
    lifecycle: idleLifecycle,
    runtime: {
      desiredActive: false,
      phase: 'cold',
      summary: null,
      metadata: null,
      readiness: null,
      peerStatus: [],
      pendingOperations: [],
      snapshot: null,
      snapshotError: null,
      lifecycle: { bootMode: 'unknown', reason: null, updatedAt: null },
      lastError: null,
    },
    permissionPolicies: [],
    pendingPrompts: 0,
  };
}

const onboardingSnapshot: ExtensionStateSnapshot = {
  ...configuredBase(),
  configured: false,
  profile: null,
  activeProfileId: null,
};

function runningSnapshot(): ExtensionStateSnapshot {
  const base = configuredBase();
  return {
    ...base,
    lifecycle: readyLifecycle,
    runtime: {
      ...base.runtime,
      desiredActive: true,
      phase: 'ready',
      summary: runningSummary,
      metadata,
      readiness,
      peerStatus: runningSummary.peers,
      lifecycle: { bootMode: 'restored', reason: null, updatedAt: 1_700_000_000_000 },
    },
  };
}

/**
 * If `?__frostr_dev=<name>` is present, return a fully-formed in-memory
 * ExtensionStateSnapshot to render instead of fetching from the background.
 * Returns null in production (no param) or for an unknown scenario name.
 */
export function resolveDevScenario(): ExtensionStateSnapshot | null {
  if (typeof window === 'undefined') return null;
  let name: string | null = null;
  try {
    name = new URLSearchParams(window.location.search).get(DEV_SCENARIO_PARAM);
  } catch {
    return null;
  }
  if (!name) return null;

  switch (name) {
    case 'dashboard-running':
      return runningSnapshot();
    case 'dashboard-stopped':
      return configuredBase();
    case 'onboarding':
      return onboardingSnapshot;
    default:
      return null;
  }
}
