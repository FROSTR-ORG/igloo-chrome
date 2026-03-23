import type { SignerSettings } from '@/lib/signer-settings';
import type { BrowserProfilePackagePayload } from 'igloo-shared';

export const EXTENSION_SOURCE = 'igloo-chrome';
export const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
export const PROMPT_DOCUMENT_PATH = 'prompt.html';
export const PROMPT_WIDTH = 448;
export const PROMPT_HEIGHT = 720;

export const MESSAGE_TYPE = {
  GET_APP_STATE: 'ext.getAppState',
  APP_STATE_UPDATED: 'ext.appStateUpdated',
  GET_STATUS: 'ext.getStatus',
  GET_RUNTIME_DIAGNOSTICS: 'ext.getRuntimeDiagnostics',
  OPEN_DASHBOARD: 'ext.openDashboard',
  GET_RUNTIME_CONFIG: 'ext.getRuntimeConfig',
  UPDATE_RUNTIME_CONFIG: 'ext.updateRuntimeConfig',
  UPDATE_RUNTIME_PEER_POLICY: 'ext.updateRuntimePeerPolicy',
  CLEAR_RUNTIME_PEER_POLICY_OVERRIDES: 'ext.clearRuntimePeerPolicyOverrides',
  START_ONBOARDING: 'ext.startOnboarding',
  COMPLETE_ONBOARDING: 'ext.completeOnboarding',
  COMPLETE_ROTATION_ONBOARDING: 'ext.completeRotationOnboarding',
  IMPORT_BFPROFILE: 'ext.importBfprofile',
  RECOVER_BFSHARE: 'ext.recoverBfshare',
  SAVE_PROFILE: 'ext.saveProfile',
  ACTIVATE_PROFILE: 'ext.activateProfile',
  UNLOCK_PROFILE: 'ext.unlockProfile',
  CLEAR_PROFILE: 'ext.clearProfile',
  RUNTIME_CONTROL: 'ext.runtimeControl',
  RUNTIME_STATUS_UPDATED: 'ext.runtimeStatusUpdated',
  PROVIDER_REQUEST: 'ext.providerRequest',
  PROMPT_RESPONSE: 'ext.promptResponse',
  OFFSCREEN_RPC: 'ext.offscreenRpc',
  NOSTR_GET_PUBLIC_KEY: 'nostr.getPublicKey',
  NOSTR_GET_RELAYS: 'nostr.getRelays',
  NOSTR_SIGN_EVENT: 'nostr.signEvent',
  NOSTR_NIP04_ENCRYPT: 'nostr.nip04.encrypt',
  NOSTR_NIP04_DECRYPT: 'nostr.nip04.decrypt',
  NOSTR_NIP44_ENCRYPT: 'nostr.nip44.encrypt',
  NOSTR_NIP44_DECRYPT: 'nostr.nip44.decrypt'
} as const;

export type ProviderMethod =
  | typeof MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY
  | typeof MESSAGE_TYPE.NOSTR_GET_RELAYS
  | typeof MESSAGE_TYPE.NOSTR_SIGN_EVENT
  | typeof MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT
  | typeof MESSAGE_TYPE.NOSTR_NIP04_DECRYPT
  | typeof MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT
  | typeof MESSAGE_TYPE.NOSTR_NIP44_DECRYPT;

export type PromptDecisionScope = 'once' | 'forever' | 'kind';

export type StoredExtensionProfile = {
  id: string;
  keysetName?: string;
  relays: string[];
  groupPublicKey?: string;
  sharePublicKey?: string;
  publicKey?: string;
  peerPubkey?: string;
  signerSettings?: SignerSettings;
  runtimeSnapshotJson?: string;
};

export type StoredProfileSummary = {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  unlocked: boolean;
};

export type PendingOnboardingProfile = {
  id: string;
  keysetName?: string;
  relays: string[];
  groupPublicKey?: string;
  sharePublicKey?: string;
  publicKey?: string;
  peerPubkey?: string;
  signerSettings?: SignerSettings;
  runtimeSnapshotJson?: string;
  profilePayload: BrowserProfilePackagePayload;
};

export type LifecycleSource = 'options' | 'background' | 'offscreen';

export type LifecycleFailureCode =
  | 'decode_failed'
  | 'onboard_timeout'
  | 'onboard_rejected'
  | 'ui_transition_failed'
  | 'snapshot_missing'
  | 'snapshot_export_failed'
  | 'offscreen_unavailable'
  | 'runtime_restore_failed'
  | 'status_sync_failed';

export type LifecycleFailure = {
  code: LifecycleFailureCode;
  message: string;
  source: LifecycleSource;
  updatedAt: number;
};

export type OnboardingStage =
  | 'idle'
  | 'decoding_package'
  | 'connecting_peer'
  | 'awaiting_onboard_response'
  | 'snapshot_captured'
  | 'profile_persisted'
  | 'failed';

export type ActivationStage =
  | 'idle'
  | 'ensuring_offscreen'
  | 'creating_offscreen'
  | 'waiting_offscreen_ready'
  | 'calling_offscreen'
  | 'restoring_runtime'
  | 'syncing_status'
  | 'ready'
  | 'degraded'
  | 'failed';

export type OnboardingLifecycleState = {
  stage: OnboardingStage;
  updatedAt: number | null;
  lastError: LifecycleFailure | null;
};

export type ActivationLifecycleState = {
  stage: ActivationStage;
  updatedAt: number | null;
  lastError: LifecycleFailure | null;
  restoredFromSnapshot: boolean;
  runtime: 'cold' | 'restoring' | 'ready' | 'degraded';
};

export type LifecycleStatusSnapshot = {
  onboarding: OnboardingLifecycleState;
  activation: ActivationLifecycleState;
};

export type LifecycleTransitionRecord = {
  domain: 'onboarding' | 'activation';
  stage: OnboardingStage | ActivationStage;
  source: LifecycleSource;
  ts: number;
  detail?: Record<string, unknown>;
  failure?: LifecycleFailure | null;
};

export type PolicyOverrideValue = 'unset' | 'allow' | 'deny';

export type RuntimeMethodPolicy = {
  ping: boolean;
  onboard: boolean;
  sign: boolean;
  ecdh: boolean;
};

export type RuntimeMethodPolicyOverride = {
  ping: PolicyOverrideValue;
  onboard: PolicyOverrideValue;
  sign: PolicyOverrideValue;
  ecdh: PolicyOverrideValue;
};

export type StoredPeerPolicy = {
  pubkey: string;
  manualOverride: {
    request: RuntimeMethodPolicyOverride;
    respond: RuntimeMethodPolicyOverride;
  };
  remoteObservation: {
    request: RuntimeMethodPolicy;
    respond: RuntimeMethodPolicy;
    updated: number;
    revision: number;
  } | null;
  effectivePolicy: {
    request: RuntimeMethodPolicy;
    respond: RuntimeMethodPolicy;
  };
};

export type StoredPermissionPolicy = {
  host: string;
  type: ProviderMethod;
  allow: boolean;
  createdAt: number;
  kind?: number;
};

export type RuntimePhase = 'cold' | 'restoring' | 'ready' | 'degraded';

export type RuntimeStatusDetails = {
  device_id: string;
  pending_ops: number;
  last_active: number;
  known_peers: number;
  request_seq: number;
};

export type RuntimePendingOperation = {
  op_type: string;
  request_id: string;
  started_at: number;
  timeout_at: number;
  target_peers: string[];
  threshold: number;
  collected_responses: unknown[];
  context: unknown;
};

export type RuntimePeerStatus = {
  idx: number;
  pubkey: string;
  known: boolean;
  last_seen: number | null;
  online: boolean;
  incoming_available: number;
  outgoing_available: number;
  outgoing_spent: number;
  can_sign: boolean;
  should_send_nonces: boolean;
};

export type RuntimeMetadata = {
  device_id: string;
  member_idx: number;
  share_public_key: string;
  group_public_key: string;
  peers: string[];
};

export type RuntimeReadiness = {
  runtime_ready: boolean;
  restore_complete: boolean;
  sign_ready: boolean;
  ecdh_ready: boolean;
  threshold: number;
  signing_peer_count: number;
  ecdh_peer_count: number;
  last_refresh_at: number | null;
  degraded_reasons: string[];
};

export type RuntimeStatusSummary = {
  status: RuntimeStatusDetails;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
  peers: RuntimePeerStatus[];
  peer_permission_states: StoredPeerPolicy[];
  pending_operations: RuntimePendingOperation[];
};

export type RuntimeLifecycleStatus = {
  bootMode: 'cold_boot' | 'restored' | 'unknown';
  reason: string | null;
  updatedAt: number | null;
};

export type RuntimeSnapshotDetails = {
  bootstrap: unknown;
  state_hex: string;
  status: RuntimeStatusDetails;
  state: {
    version: number;
    last_active: number;
    request_seq: number;
    replay_cache_size: number;
    ecdh_cache_size: number;
    sig_cache_size: number;
    manual_policy_overrides: Record<string, unknown>;
    remote_scoped_policies: Record<string, unknown>;
    pending_operations: Record<string, RuntimePendingOperation>;
    nonce_pool: {
      peers: Array<{
        idx: number;
        pubkey: string;
        incoming_available: number;
        outgoing_available: number;
        outgoing_spent: number;
        can_sign: boolean;
        should_send_nonces: boolean;
      }>;
    };
  };
};

export type ExtensionAppState = {
  configured: boolean;
  profile: StoredExtensionProfile | null;
  profiles: StoredProfileSummary[];
  activeProfileId: string | null;
  lifecycle: LifecycleStatusSnapshot;
  runtime: {
    phase: RuntimePhase;
    summary: RuntimeStatusSummary | null;
    metadata: RuntimeMetadata | null;
    readiness: RuntimeReadiness | null;
    peerStatus: RuntimePeerStatus[];
    pendingOperations: RuntimePendingOperation[];
    snapshot: RuntimeSnapshotDetails | null;
    snapshotError: string | null;
    lifecycle: RuntimeLifecycleStatus;
    lastError: string | null;
  };
  permissionPolicies: StoredPermissionPolicy[];
  pendingPrompts: number;
};

export type ProviderRequestEnvelope = {
  id: string;
  type: ProviderMethod;
  params?: Record<string, unknown>;
  host: string;
  origin?: string;
  href?: string;
};

export type PromptResponseMessage = {
  type: typeof MESSAGE_TYPE.PROMPT_RESPONSE;
  id: string;
  allow: boolean;
  scope: PromptDecisionScope;
  kind?: number;
};

export type RuntimeControlMessage = {
  type: typeof MESSAGE_TYPE.RUNTIME_CONTROL;
  action:
    | 'closeOffscreen'
    | 'reloadExtension'
    | 'ensureConfiguredRuntime'
    | 'reloadConfiguredRuntime'
    | 'refreshAllPeers'
    | 'wipeRuntime'
    | 'stopRuntime';
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isProviderMethod(value: unknown): value is ProviderMethod {
  return (
    value === MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY ||
    value === MESSAGE_TYPE.NOSTR_GET_RELAYS ||
    value === MESSAGE_TYPE.NOSTR_SIGN_EVENT ||
    value === MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT ||
    value === MESSAGE_TYPE.NOSTR_NIP04_DECRYPT ||
    value === MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT ||
    value === MESSAGE_TYPE.NOSTR_NIP44_DECRYPT
  );
}

export function getPermissionLabel(type: ProviderMethod) {
  switch (type) {
    case MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY:
      return 'read your public key';
    case MESSAGE_TYPE.NOSTR_GET_RELAYS:
      return 'read your relay list';
    case MESSAGE_TYPE.NOSTR_SIGN_EVENT:
      return 'sign a Nostr event';
    case MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT:
      return 'encrypt a NIP-04 message';
    case MESSAGE_TYPE.NOSTR_NIP04_DECRYPT:
      return 'decrypt a NIP-04 message';
    case MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT:
      return 'encrypt a NIP-44 message';
    case MESSAGE_TYPE.NOSTR_NIP44_DECRYPT:
      return 'decrypt a NIP-44 message';
  }
}

export function extractEventKind(params: unknown): number | undefined {
  if (!isRecord(params)) return undefined;
  const event = params.event;
  if (!isRecord(event)) return undefined;
  const kind = event.kind;
  return typeof kind === 'number' ? kind : undefined;
}
