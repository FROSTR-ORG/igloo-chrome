import { getChromeApi } from '@/extension/chrome';
import { MESSAGE_TYPE } from '@/extension/protocol';

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

export type RuntimeNoncePeerSnapshot = {
  idx: number;
  pubkey: string;
  incoming_available: number;
  outgoing_available: number;
  outgoing_spent: number;
  can_sign: boolean;
  should_send_nonces: boolean;
};

export type RuntimeSnapshotState = {
  version: number;
  last_active: number;
  request_seq: number;
  replay_cache_size: number;
  ecdh_cache_size: number;
  sig_cache_size: number;
  policies: Record<string, unknown>;
  remote_scoped_policies: Record<string, unknown>;
  pending_operations: Record<string, RuntimePendingOperation>;
  nonce_pool: {
    peers: RuntimeNoncePeerSnapshot[];
  };
};

export type RuntimeSnapshotDetails = {
  bootstrap: unknown;
  state_hex: string;
  status: RuntimeStatusDetails;
  state: RuntimeSnapshotState;
};

export type RuntimeLifecycleStatus = {
  bootMode: 'cold_boot' | 'restored' | 'unknown';
  reason: string | null;
  updatedAt: number | null;
};

export type ExtensionStatusSnapshot = {
  configured: boolean;
  keysetName: string | null;
  publicKey: string | null;
  relays: string[];
  runtime: 'cold' | 'ready';
  pendingPrompts: number;
  runtimeDetails: {
    status: RuntimeStatusDetails | null;
    snapshot: RuntimeSnapshotDetails | null;
    snapshotError: string | null;
    lifecycle: RuntimeLifecycleStatus;
  };
};

export async function fetchExtensionStatus(): Promise<ExtensionStatusSnapshot> {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error('Extension runtime messaging is unavailable');
  }

  const response = (await chromeApi.runtime.sendMessage({
    type: MESSAGE_TYPE.GET_STATUS
  })) as
    | { ok?: boolean; result?: ExtensionStatusSnapshot; error?: string }
    | undefined;

  if (!response?.ok || !response.result) {
    throw new Error(response?.error || 'Failed to load extension status');
  }

  return response.result;
}
