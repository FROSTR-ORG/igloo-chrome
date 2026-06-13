import * as React from 'react';
import {
  AppHeader,
  ContentCard,
  OperatorSignerPanel,
  PageLayout,
  type EventLogRowModel,
  type PeerReadinessRowModel,
  type PendingOperationRowModel,
  type SignerDashboardViewModel,
} from 'igloo-ui';
import { type RuntimeStatusSummary, type StoredPeerPolicy } from '@/extension/protocol';
import { useStore } from '@/lib/store';
import { deriveRuntimePresentation } from '@/lib/runtime-activation';
import { createLogger, type ObservabilityEvent } from '@/lib/observability';
import {
  normalizeStoredPeerPolicies,
  peerAllowsAllRequests,
  peerAllowsAllResponses,
} from '@/lib/peer-policy';

const logger = createLogger('igloo.signer-page');

function toEventRow(event: ObservabilityEvent): EventLogRowModel {
  return {
    id: `${event.ts}-${event.domain}-${event.event}`,
    badgeLabel: event.domain,
    badgeTone: event.level === 'error' ? 'danger' : event.level === 'warn' ? 'warning' : 'info',
    message: `${event.domain}.${event.event}`,
    timestampLabel: new Date(event.ts).toLocaleTimeString(),
  };
}

// Capability/latency/sparkline telemetry defaults for peers known only from a
// saved policy or the roster — real values come from the live `summary.peers`.
const EMPTY_PEER_TELEMETRY = {
  canSign: false,
  canEcdh: false,
  canPing: false,
  lastResponseLatencyMs: null,
  avgLatencyMs: null,
  nonceSeries: [],
} satisfies Pick<
  PeerReadinessRowModel,
  'canSign' | 'canEcdh' | 'canPing' | 'lastResponseLatencyMs' | 'avgLatencyMs' | 'nonceSeries'
>;

function derivePeers(
  summary: RuntimeStatusSummary | null,
  savedPolicies: StoredPeerPolicy[],
): PeerReadinessRowModel[] {
  const base = new Map<string, PeerReadinessRowModel>();

  for (const [index, saved] of normalizeStoredPeerPolicies(savedPolicies).entries()) {
    base.set(saved.pubkey.toLowerCase(), {
      id: saved.pubkey.toLowerCase(),
      alias: `Peer ${index + 1}`,
      pubkey: saved.pubkey.toLowerCase(),
      state: 'offline',
      statusLabel: 'offline',
      ...EMPTY_PEER_TELEMETRY,
    });
  }

  for (const [index, peer] of (summary?.metadata.peers ?? []).entries()) {
    const normalized = peer.toLowerCase();
    const existing = base.get(normalized);
    base.set(normalized, {
      id: normalized,
      alias: existing?.alias ?? `Peer ${index + 1}`,
      pubkey: normalized,
      state: 'idle',
      statusLabel: 'known',
      ...EMPTY_PEER_TELEMETRY,
    });
  }

  for (const peer of summary?.peers ?? []) {
    const normalized = peer.pubkey.toLowerCase();
    const existing = base.get(normalized);
    base.set(normalized, {
      id: normalized,
      alias: existing?.alias ?? `Peer ${peer.idx}`,
      pubkey: normalized,
      state: peer.can_sign ? 'warning' : peer.online ? 'online' : peer.known ? 'idle' : 'offline',
      statusLabel: peer.can_sign ? 'sign-ready' : peer.online ? 'online' : peer.known ? 'known' : 'offline',
      incomingAvailable: peer.incoming_available,
      outgoingAvailable: peer.outgoing_available,
      outgoingSpent: peer.outgoing_spent,
      canSign: peer.can_sign,
      canEcdh: peer.can_ecdh,
      canPing: peer.can_ping,
      lastResponseLatencyMs: peer.last_response_latency_ms,
      avgLatencyMs: peer.avg_latency_ms,
      nonceSeries: peer.nonce_history.map((point) => ({ ts: point.ts, held: point.held })),
    });
  }

  return Array.from(base.values()).sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

export function SignerPanel({ embedded = false }: { embedded?: boolean }) {
  const { appState, loadRuntimeDiagnostics, profile, refreshRuntimePeers, startRuntime, stopRuntime } = useStore();
  const [copiedField, setCopiedField] = React.useState<'group' | 'share' | null>(null);
  const [eventRows, setEventRows] = React.useState<EventLogRowModel[]>([]);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadRuntimeDiagnostics()
      .then((diagnostics) => {
        setEventRows(diagnostics.diagnostics.map(toEventRow));
      })
      .catch((error) => {
        setActionError(error instanceof Error ? error.message : String(error));
      });
  }, [
    appState?.runtime.phase,
    appState?.lifecycle.activation.updatedAt,
    appState?.lifecycle.onboarding.updatedAt,
  ]);

  const handleStart = async () => {
    if (!profile) return;
    setActionError(null);
    try {
      await startRuntime();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStop = async () => {
    setActionError(null);
    try {
      await stopRuntime();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRefreshPeers = async () => {
    setActionError(null);
    try {
      await refreshRuntimePeers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCopy = async (field: 'group' | 'share') => {
    const value =
      field === 'group'
        ? appState?.runtime.metadata?.group_public_key ?? profile?.groupPublicKey
        : appState?.runtime.metadata?.share_public_key ?? profile?.sharePublicKey;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      logger.warn('ui', 'copy_key_failed', {
        field,
        error_message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const peers = React.useMemo(
    () => derivePeers(appState?.runtime.summary ?? null, appState?.runtime.summary?.peer_permission_states ?? []),
    [appState?.runtime.summary]
  );
  const activationStage = appState?.lifecycle.activation.stage ?? 'idle';
  const activationError = appState?.lifecycle.activation.lastError ?? null;
  const presentation = deriveRuntimePresentation(
    activationStage,
    appState?.runtime.phase ?? 'cold',
    actionError ?? activationError?.message ?? appState?.runtime.lastError ?? null,
  );
  const isSignerRunning = presentation.runtimeState === 'running';
  const isConnecting = presentation.runtimeState === 'connecting';
  const runtimeControlLabel = presentation.runtimeControlLabel;
  const runtimeSummaryLabel = presentation.runtimeSummaryLabel;
  const displayRuntimeError =
    !actionError && activationError?.code === 'runtime_unavailable'
      ? `Profile saved, signer unavailable. ${activationError.message}`
      : presentation.runtimeError;

  if (!profile) {
    const emptyState = (
      <ContentCard title="Profile Locked" description="Unlock a stored profile or load a different device to continue.">
        <div className="border border-blue-800/30 rounded-lg p-6 text-sm text-blue-200">
          No active unlocked profile is currently loaded in this browser session.
        </div>
      </ContentCard>
    );
    if (embedded) return emptyState;
    return <PageLayout header={<AppHeader mode="task" taskLabel="browser signing device" />}>{emptyState}</PageLayout>;
  }

  const groupPublicKey = appState?.runtime.metadata?.group_public_key ?? profile.groupPublicKey ?? '';
  const sharePublicKey = appState?.runtime.metadata?.share_public_key ?? profile.sharePublicKey ?? '';
  const pendingOperationRows: PendingOperationRowModel[] =
    appState?.runtime.pendingOperations.map((operation) => ({
      id: operation.request_id,
      operationLabel: operation.op_type,
      thresholdLabel: `threshold ${operation.threshold}`,
      startedLabel: new Date(operation.started_at).toLocaleTimeString(),
      timeoutLabel: new Date(operation.timeout_at).toLocaleTimeString(),
      responseLabel: `${operation.collected_responses.length} of ${operation.target_peers.length}`,
    })) ?? [];

  const view: SignerDashboardViewModel = {
    profileName: profile.groupName || 'Unnamed signer',
    thresholdLabel: peers.length ? `${peers.length} peers` : 'no peers',
    publicKeyLabel: groupPublicKey,
    shareLabel: sharePublicKey,
    readinessLabel: runtimeSummaryLabel,
    relaySummary: displayRuntimeError ?? (isSignerRunning ? 'Runtime connected' : 'Runtime stopped'),
    peerRows: peers,
    pendingOperationRows,
    eventRows,
  };

  const content = (
    <OperatorSignerPanel
      view={view}
      introMessage="The signer runtime is hosted by the extension background service worker. This page is an operator console over that runtime."
      runtimeControlLabel={runtimeControlLabel}
      copiedField={copiedField}
      onCopyGroupKey={() => void handleCopy('group')}
      onCopyShareKey={() => void handleCopy('share')}
      onPrimaryAction={isSignerRunning ? () => void handleStop() : () => void handleStart()}
      primaryActionVariant={isSignerRunning ? 'destructive' : 'success'}
      primaryActionDisabled={isConnecting}
      onRefreshPeers={() => void handleRefreshPeers()}
      refreshPeersDisabled={!isSignerRunning}
    />
  );

  if (embedded) return content;

  return <PageLayout header={<AppHeader mode="task" taskLabel="browser signing device" />}>{content}</PageLayout>;
}
