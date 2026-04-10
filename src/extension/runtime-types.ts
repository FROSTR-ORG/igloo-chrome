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
