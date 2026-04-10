import type {
  RuntimePeerPermissionState as SharedRuntimePeerPermissionState,
  RuntimeStatusSummary as SharedRuntimeStatusSummary,
} from '@/lib/igloo';
import type {
  RuntimeDiagnosticsCore,
  RuntimeLifecycleStatus,
  RuntimePhase,
  RuntimeSnapshotInspection,
  RuntimeStatusSnapshot,
  RuntimeStatusSummary,
  StoredPeerPolicy,
} from '@/extension/protocol';
import type { ObservabilityEvent } from '@/lib/observability';

type SharedRuntimeStatusSnapshot = {
  runtime: RuntimePhase;
  status: SharedRuntimeStatusSummary | null;
};

type SharedRuntimeDiagnosticsSnapshot = {
  runtime: RuntimePhase;
  diagnostics: ObservabilityEvent[];
  dropped: number;
  runtimeStatus?: SharedRuntimeStatusSummary | null;
};

type SharedRuntimeSnapshotDetails = {
  runtime: RuntimePhase;
  status: SharedRuntimeStatusSummary | null;
  snapshot: RuntimeSnapshotInspection['snapshot'];
  snapshotError: string | null;
  lifecycle?: RuntimeLifecycleStatus | null;
};

type SharedRuntimeStatusUpdate = {
  runtime: RuntimePhase;
  status: SharedRuntimeStatusSummary | null;
};

function adaptPeerPermissionState(
  policy: SharedRuntimePeerPermissionState
): StoredPeerPolicy {
  return {
    pubkey: policy.pubkey,
    manualOverride: {
      request: { ...policy.manual_override.request },
      respond: { ...policy.manual_override.respond },
    },
    remoteObservation: policy.remote_observation
      ? {
          request: { ...policy.remote_observation.request },
          respond: { ...policy.remote_observation.respond },
          updated: policy.remote_observation.updated,
          revision: policy.remote_observation.revision,
        }
      : null,
    effectivePolicy: {
      request: { ...policy.effective_policy.request },
      respond: { ...policy.effective_policy.respond },
    },
  };
}

export function adaptRuntimeStatusSummary(
  status: SharedRuntimeStatusSummary | null | undefined
): RuntimeStatusSummary | null {
  if (!status) {
    return null;
  }

  return {
    status: { ...status.status },
    metadata: {
      ...status.metadata,
      peers: [...status.metadata.peers],
    },
    readiness: {
      ...status.readiness,
      degraded_reasons: [...status.readiness.degraded_reasons],
    },
    peers: status.peers.map((peer) => ({ ...peer })),
    peer_permission_states: Array.isArray(status.peer_permission_states)
      ? status.peer_permission_states.map(adaptPeerPermissionState)
      : [],
    pending_operations: status.pending_operations.map((operation) => ({
      ...operation,
      target_peers: [...operation.target_peers],
      collected_responses: [...operation.collected_responses],
    })),
  };
}

export function adaptRuntimeStatusSnapshot(
  snapshot: SharedRuntimeStatusSnapshot
): RuntimeStatusSnapshot {
  return {
    runtime: snapshot.runtime,
    status: adaptRuntimeStatusSummary(snapshot.status),
  };
}

export function adaptRuntimeSnapshotDetails(
  snapshot: SharedRuntimeSnapshotDetails
): RuntimeSnapshotInspection {
  return {
    runtime: snapshot.runtime,
    status: adaptRuntimeStatusSummary(snapshot.status),
    snapshot: snapshot.snapshot,
    snapshotError: snapshot.snapshotError,
    runtimeLifecycle: snapshot.lifecycle ?? null,
  };
}

export function adaptRuntimeDiagnosticsSnapshot(
  snapshot: SharedRuntimeDiagnosticsSnapshot,
  runtimeSnapshot?: RuntimeSnapshotInspection | null
): RuntimeDiagnosticsCore {
  const adaptedSnapshot = runtimeSnapshot ?? null;
  return {
    runtime: snapshot.runtime,
    diagnostics: snapshot.diagnostics,
    dropped: snapshot.dropped,
    runtimeStatus: adaptRuntimeStatusSummary(snapshot.runtimeStatus),
    runtimeSnapshot: adaptedSnapshot?.snapshot ?? null,
    runtimeSnapshotError: adaptedSnapshot?.snapshotError ?? null,
    runtimeLifecycle: adaptedSnapshot?.runtimeLifecycle ?? null,
  };
}

export function adaptRuntimeStatusUpdate(
  update: SharedRuntimeStatusUpdate
): RuntimeStatusSnapshot {
  return {
    runtime: update.runtime,
    status: adaptRuntimeStatusSummary(update.status),
  };
}
