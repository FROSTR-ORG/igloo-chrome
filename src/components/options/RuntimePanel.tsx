import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ContentCard } from '@/components/ui/content-card';
import { StatusBadge } from '@/components/ui/status-indicator';
import {
  fetchExtensionStatus,
  type ExtensionStatusSnapshot,
  type RuntimeNoncePeerSnapshot,
  type RuntimePendingOperation
} from '@/extension/client';

type MetricProps = {
  label: string;
  value: React.ReactNode;
};

function Metric({ label, value }: MetricProps) {
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

function formatLifecycleReason(value: string | null | undefined) {
  if (!value) return 'none';
  return value.replace(/-/g, ' ');
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

export function RuntimePanel() {
  const [snapshot, setSnapshot] = React.useState<ExtensionStatusSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const result = await fetchExtensionStatus();
      setSnapshot(result);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const runtimeStatus = snapshot?.runtimeDetails.status ?? null;
  const runtimeSnapshot = snapshot?.runtimeDetails.snapshot ?? null;
  const runtimeSnapshotState = runtimeSnapshot?.state ?? null;
  const noncePeers = runtimeSnapshotState?.nonce_pool.peers ?? [];
  const pendingOperations = Object.entries(runtimeSnapshotState?.pending_operations ?? {});
  const lifecycle = snapshot?.runtimeDetails.lifecycle;

  return (
    <div className="space-y-6">
      <ContentCard
        title="Runtime Status"
        description="Control-plane state from the MV3 background and offscreen document."
        action={
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      >
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {snapshot && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric
              label="Offscreen Runtime"
              value={
                <StatusBadge
                  state={snapshot.runtime === 'ready' ? 'online' : 'idle'}
                  label={snapshot.runtime}
                />
              }
            />
            <Metric
              label="Profile State"
              value={
                <StatusBadge
                  state={snapshot.configured ? 'online' : 'warning'}
                  label={snapshot.configured ? 'configured' : 'not configured'}
                />
              }
            />
            <Metric label="Pending Prompts" value={snapshot.pendingPrompts} />
            <Metric label="Relay Count" value={snapshot.relays.length} />
            <Metric label="Known Peers" value={runtimeStatus?.known_peers ?? 'n/a'} />
            <Metric label="Pending Ops" value={runtimeStatus?.pending_ops ?? 'n/a'} />
            <Metric label="Request Seq" value={runtimeStatus?.request_seq ?? 'n/a'} />
            <Metric label="Last Active" value={formatTimestamp(runtimeStatus?.last_active)} />
            <Metric
              label="Boot Mode"
              value={
                <StatusBadge
                  state={lifecycle?.bootMode === 'restored' ? 'online' : lifecycle?.bootMode === 'cold_boot' ? 'idle' : 'warning'}
                  label={lifecycle?.bootMode ?? 'unknown'}
                />
              }
            />
            <Metric label="Boot Detail" value={formatLifecycleReason(lifecycle?.reason)} />
            <Metric label="Boot Updated" value={formatTimestamp(lifecycle?.updatedAt)} />
            <Metric
              label="Public Key"
              value={<div className="break-all font-mono text-xs">{snapshot.publicKey ?? 'not decoded yet'}</div>}
            />
            <Metric
              label="Keyset Name"
              value={snapshot.keysetName ?? 'unnamed signer'}
            />
          </div>
        )}
      </ContentCard>

      <ContentCard
        title="Runtime Snapshot"
        description="Operator-facing bridge internals from the offscreen signer runtime."
      >
        {snapshot?.runtimeDetails.snapshotError && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Snapshot error: {snapshot.runtimeDetails.snapshotError}
          </div>
        )}

        {!runtimeSnapshotState ? (
          <div className="rounded border border-dashed border-blue-900/30 px-4 py-6 text-sm text-gray-400">
            Start a signer session to inspect nonce pools and pending operations.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Replay Cache" value={runtimeSnapshotState.replay_cache_size} />
              <Metric label="ECDH Cache" value={runtimeSnapshotState.ecdh_cache_size} />
              <Metric label="Signature Cache" value={runtimeSnapshotState.sig_cache_size} />
              <Metric label="Policies" value={Object.keys(runtimeSnapshotState.policies).length} />
            </div>

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
                <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Pending Operations</h3>
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
          </div>
        )}
      </ContentCard>

      <ContentCard
        title="Architecture"
        description="The current split mirrors the old frost2x operator console, but with v2 runtime boundaries."
      >
        <div className="space-y-3 text-sm text-blue-100/90">
          <div>
            <span className="font-medium text-blue-200">Background:</span> permissions, request routing,
            offscreen lifecycle.
          </div>
          <div>
            <span className="font-medium text-blue-200">Offscreen document:</span> WASM bootstrap and future
            long-lived signer session ownership.
          </div>
          <div>
            <span className="font-medium text-blue-200">Options page:</span> operator dashboard for signer,
            policy, and settings workflows.
          </div>
          <div>
            <span className="font-medium text-blue-200">Content script + provider:</span> `window.nostr`
            injection boundary for websites.
          </div>
        </div>
      </ContentCard>
    </div>
  );
}
