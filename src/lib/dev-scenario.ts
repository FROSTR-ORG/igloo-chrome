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
  RuntimeStatusSummary,
  StoredExtensionProfile,
} from '@/extension/protocol';
import {
  FIXTURE_PROFILE_ID, FIXTURE_PROFILE_LABEL, FIXTURE_GROUP_PK, FIXTURE_SHARE_PK,
  FIXTURE_RELAY, FIXTURE_PEER_A, FIXTURE_SIGNER_SETTINGS,
  createFixtureRuntimeStatusSummary,
} from 'igloo-shared/testing/dev-fixtures';

const DEV_SCENARIO_PARAM = '__frostr_dev';

const fixtureProfile: StoredExtensionProfile = {
  id: FIXTURE_PROFILE_ID,
  groupName: FIXTURE_PROFILE_LABEL,
  relays: [FIXTURE_RELAY],
  groupPublicKey: FIXTURE_GROUP_PK,
  sharePublicKey: FIXTURE_SHARE_PK,
  publicKey: FIXTURE_SHARE_PK,
  peerPubkey: FIXTURE_PEER_A,
  signerSettings: { ...FIXTURE_SIGNER_SETTINGS },
};

// A representative running runtime: signer online with two peers (one online,
// one offline) so the dashboard renders the Peers card with content.
// peer_permission_states is empty in the shared fixture; cast to chrome's local
// StoredPeerPolicy[] (structurally compatible — both are empty in this seam).
const _sharedSummary = createFixtureRuntimeStatusSummary();
const runningSummary: RuntimeStatusSummary = {
  ..._sharedSummary,
  peer_permission_states: [],
};

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
      metadata: runningSummary.metadata,
      readiness: runningSummary.readiness,
      peerStatus: runningSummary.peers,
      pendingOperations: runningSummary.pending_operations,
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
  // Dev/test builds only. The chrome build has no `import.meta.env.DEV`, so the
  // seam is gated on a dedicated define: off ('0') by default so the shipped
  // extension tree-shakes it out; the test prebuild builds with it set to '1'.
  if (import.meta.env.VITE_IGLOO_VISUAL !== '1') return null;
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
