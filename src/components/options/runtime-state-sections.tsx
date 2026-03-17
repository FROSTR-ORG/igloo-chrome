import * as React from 'react';
import type {
  RuntimePendingOperation,
  RuntimeSnapshotDetails
} from '@/extension/protocol';

type RuntimeNoncePeerSnapshot = RuntimeSnapshotDetails['state']['nonce_pool']['peers'][number];
type RuntimeSnapshotState = RuntimeSnapshotDetails['state'];

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-blue-900/20 bg-gray-950/30 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-sm text-blue-100">{value}</div>
    </div>
  );
}

function formatTimestamp(value: number | null | undefined) {
  if (!value) return 'n/a';
  const normalized = value > 10_000_000_000 ? value : value * 1000;
  return new Date(normalized).toLocaleString();
}

function NoncePoolRow({ peer }: { peer: RuntimeNoncePeerSnapshot }) {
  return (
    <div className="rounded-lg border border-blue-900/20 bg-gray-950/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-gray-500">Peer {peer.idx}</div>
          <div className="break-all font-mono text-xs text-blue-100">{peer.pubkey}</div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span
            className={`rounded-full px-2.5 py-1 ${
              peer.can_sign
                ? 'bg-green-500/20 text-green-300 ring-1 ring-green-500/30'
                : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
            }`}
          >
            {peer.can_sign ? 'sign-ready' : 'waiting'}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 ${
              peer.should_send_nonces
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
                : 'bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/30'
            }`}
          >
            {peer.should_send_nonces ? 'send nonces' : 'nonce pool healthy'}
          </span>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Metric label="Incoming" value={peer.incoming_available} />
        <Metric label="Outgoing" value={peer.outgoing_available} />
        <Metric label="Spent" value={peer.outgoing_spent} />
      </div>
    </div>
  );
}

function PendingOperationRow({
  requestId,
  operation
}: {
  requestId: string;
  operation: RuntimePendingOperation;
}) {
  return (
    <div className="rounded-lg border border-blue-900/20 bg-gray-950/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-gray-500">{operation.op_type}</div>
          <div className="break-all font-mono text-xs text-blue-100">{requestId}</div>
        </div>
        <div className="text-xs text-gray-400">threshold {operation.threshold}</div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Metric label="Started" value={formatTimestamp(operation.started_at)} />
        <Metric label="Timeout" value={formatTimestamp(operation.timeout_at)} />
        <Metric label="Responses" value={operation.collected_responses.length} />
      </div>
      <div className="mt-3 space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-500">Target Peers</div>
        {operation.target_peers.length === 0 ? (
          <div className="text-sm text-gray-400">No target peers recorded.</div>
        ) : (
          operation.target_peers.map((peer) => (
            <div key={peer} className="break-all font-mono text-xs text-blue-100">
              {peer}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function RuntimeStateSections({
  snapshotState,
  snapshotError
}: {
  snapshotState: RuntimeSnapshotState | null;
  snapshotError?: string | null;
}) {
  const noncePeers = snapshotState?.nonce_pool.peers ?? [];
  const pendingOperations = Object.entries(snapshotState?.pending_operations ?? {});

  return (
    <div className="space-y-6">
      {snapshotError && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Snapshot error: {snapshotError}
        </div>
      )}

      {!snapshotState ? (
        <div className="rounded border border-dashed border-blue-900/30 px-4 py-6 text-sm text-gray-400">
          Start a signer session to inspect nonce pools and pending operations.
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Nonce Pools</h3>
              <p className="text-sm text-blue-100/75">
                Peer-level inbound and outbound nonce availability inside the signer runtime.
              </p>
            </div>

            {noncePeers.length === 0 ? (
              <div className="rounded border border-dashed border-blue-900/30 px-4 py-6 text-sm text-gray-400">
                No peer nonce state has been observed yet.
              </div>
            ) : (
              <div className="space-y-3">
                {noncePeers.map((peer) => (
                  <NoncePoolRow key={`${peer.idx}-${peer.pubkey}`} peer={peer} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-200">
                Pending Operations
              </h3>
              <p className="text-sm text-blue-100/75">
                In-flight sign, ECDH, ping, and onboard operations still tracked by the device.
              </p>
            </div>

            {pendingOperations.length === 0 ? (
              <div className="rounded border border-dashed border-blue-900/30 px-4 py-6 text-sm text-gray-400">
                No operations are currently pending.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingOperations.map(([requestId, operation]) => (
                  <PendingOperationRow key={requestId} requestId={requestId} operation={operation} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
