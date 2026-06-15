// Canonical runtime wire shapes are owned by igloo-shared. Re-export the
// shapes that are byte-identical to the shared declarations so the extension's
// UI/protocol code keeps importing them from `@/extension/protocol` while the
// single source of truth lives in igloo-shared.
import type {
  RuntimePeerStatus,
  RuntimeReadiness,
  RuntimeStatusDetails,
  RuntimePendingOperation,
  RuntimePendingApproval,
  RuntimeOperationFailure,
  RuntimeLoadError,
} from 'igloo-shared';

export type {
  RuntimePeerStatus,
  RuntimeReadiness,
  RuntimeStatusDetails,
  RuntimePendingOperation,
  RuntimePendingApproval,
  RuntimeOperationFailure,
  RuntimeLoadError,
} from 'igloo-shared';

export type PolicyOverrideValue = 'unset' | 'allow' | 'deny' | 'ask';

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

// Deliberate divergence from igloo-shared's snake_case RuntimePeerPermissionState:
// this is chrome's camelCase, storage-normalized internal form (manualOverride /
// remoteObservation / effectivePolicy), not a wire shape. The wire-type drift
// guard (./runtime-types.contract.ts) excludes peer_permission_states for this
// reason.
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

export type RuntimePhase = 'cold' | 'restoring' | 'ready' | 'degraded';

export type RuntimeMetadata = {
  device_id: string;
  member_idx: number;
  share_public_key: string;
  group_public_key: string;
  peers: string[];
};

export type RuntimeStatusSummary = {
  status: RuntimeStatusDetails;
  metadata: RuntimeMetadata;
  readiness: RuntimeReadiness;
  peers: RuntimePeerStatus[];
  peer_permission_states: StoredPeerPolicy[];
  pending_operations: RuntimePendingOperation[];
  pending_approvals?: RuntimePendingApproval[];
  last_sign_failure?: RuntimeOperationFailure | null;
  connected_relays?: string[] | null;
  configured_relays?: string[] | null;
  last_load_error?: RuntimeLoadError | null;
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
