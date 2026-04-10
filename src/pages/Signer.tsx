import * as React from 'react';
import {
  AppHeader,
  ContentCard,
  OperatorSignerPanel,
  PageLayout,
  type LogEntry,
  type PeerPolicy,
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

function toLogEntry(event: ObservabilityEvent): LogEntry {
  return {
    id: `${event.ts}-${event.domain}-${event.event}`,
    time: new Date(event.ts).toLocaleTimeString(),
    level: event.level.toUpperCase(),
    message: `${event.domain}.${event.event}`,
    data: event,
  };
}

function derivePeers(summary: RuntimeStatusSummary | null, savedPolicies: StoredPeerPolicy[]): PeerPolicy[] {
  const base = new Map<string, PeerPolicy>();

  for (const [index, saved] of normalizeStoredPeerPolicies(savedPolicies).entries()) {
    base.set(saved.pubkey.toLowerCase(), {
      alias: `Peer ${index + 1}`,
      pubkey: saved.pubkey.toLowerCase(),
      send: peerAllowsAllRequests(saved),
      receive: peerAllowsAllResponses(saved),
      state: 'offline',
      statusLabel: 'offline',
      lastSeen: null,
    });
  }

  for (const [index, peer] of (summary?.metadata.peers ?? []).entries()) {
    const normalized = peer.toLowerCase();
    const existing = base.get(normalized);
    base.set(normalized, {
      alias: existing?.alias ?? `Peer ${index + 1}`,
      pubkey: normalized,
      send: existing?.send ?? true,
      receive: existing?.receive ?? true,
      state: 'idle',
      statusLabel: 'known',
      lastSeen: existing?.lastSeen ?? null,
    });
  }

  for (const peer of summary?.peers ?? []) {
    const normalized = peer.pubkey.toLowerCase();
    const existing = base.get(normalized);
    base.set(normalized, {
      alias: existing?.alias ?? `Peer ${peer.idx}`,
      pubkey: normalized,
      send: existing?.send ?? true,
      receive: existing?.receive ?? true,
      state: peer.can_sign ? 'warning' : peer.online ? 'online' : peer.known ? 'idle' : 'offline',
      statusLabel: peer.can_sign ? 'sign-ready' : peer.online ? 'online' : peer.known ? 'known' : 'offline',
      lastSeen: peer.last_seen,
      incomingAvailable: peer.incoming_available,
      outgoingAvailable: peer.outgoing_available,
      outgoingSpent: peer.outgoing_spent,
      shouldSendNonces: peer.should_send_nonces,
    });
  }

  return Array.from(base.values()).sort((a, b) => a.pubkey.localeCompare(b.pubkey));
}

export function SignerPanel({ embedded = false }: { embedded?: boolean }) {
  const { appState, loadRuntimeDiagnostics, profile, refreshRuntimePeers, startRuntime, stopRuntime } = useStore();
  const [copiedField, setCopiedField] = React.useState<'group' | 'share' | null>(null);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadRuntimeDiagnostics()
      .then((diagnostics) => {
        setLogs(diagnostics.diagnostics.map(toLogEntry));
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
    return <PageLayout header={<AppHeader title="igloo-chrome" subtitle="browser signing device" />}>{emptyState}</PageLayout>;
  }

  const content = (
    <OperatorSignerPanel
      profile={{
        name: profile.groupName || 'Unnamed signer',
        groupPublicKey: profile.groupPublicKey,
        sharePublicKey: profile.sharePublicKey,
      }}
      introMessage="The signer runtime is hosted by the extension background service worker. This page is an operator console over that runtime."
      runtimeState={presentation.runtimeState}
      runtimeControlLabel={runtimeControlLabel}
      runtimeSummaryLabel={runtimeSummaryLabel}
      activationStage={appState?.lifecycle.activation.stage ?? null}
      activationUpdatedAt={appState?.lifecycle.activation.updatedAt ?? null}
      runtimeError={displayRuntimeError}
      sharePublicKey={appState?.runtime.metadata?.share_public_key ?? profile.sharePublicKey ?? ''}
      groupPublicKey={appState?.runtime.metadata?.group_public_key ?? profile.groupPublicKey ?? ''}
      copiedField={copiedField}
      onCopyGroupKey={() => void handleCopy('group')}
      onCopyShareKey={() => void handleCopy('share')}
      onPrimaryAction={isSignerRunning ? () => void handleStop() : () => void handleStart()}
      primaryActionDisabled={isConnecting}
      onRefreshPeers={() => void handleRefreshPeers()}
      refreshPeersDisabled={!isSignerRunning}
      peers={peers}
      pendingOperations={
        appState?.runtime.pendingOperations.map((operation) => ({
          request_id: operation.request_id,
          op_type: operation.op_type,
          threshold: operation.threshold,
          started_at: operation.started_at,
          timeout_at: operation.timeout_at,
          collected_responses: operation.collected_responses.length,
          target_peers: operation.target_peers,
        })) ?? []
      }
      logs={logs}
    />
  );

  if (embedded) return content;

  return <PageLayout header={<AppHeader title="igloo-chrome" subtitle="browser signing device" />}>{content}</PageLayout>;
}
