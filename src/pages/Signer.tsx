import * as React from 'react';
import {
  AppHeader,
  Button,
  ContentCard,
  OperatorSignerPanel,
  PageLayout,
  type LogEntry,
  type PeerPolicy,
} from 'igloo-ui';
import { getChromeApi } from '@/extension/chrome';
import { MESSAGE_TYPE, type StoredPeerPolicy } from '@/extension/protocol';
import { useStore } from '@/lib/store';
import {
  fetchExtensionStatus,
  fetchRuntimeDiagnostics,
  sendRuntimeControl,
  type ExtensionStatusSnapshot,
} from '@/extension/client';
import { createLogger, type ObservabilityEvent } from '@/lib/observability';

const logger = createLogger('igloo.signer-page');

function initializePeers(savedPolicies: StoredPeerPolicy[] = []): PeerPolicy[] {
  return savedPolicies.map((saved, index) => ({
    alias: `Peer ${index + 1}`,
    pubkey: saved.pubkey,
    send:
      saved.effectivePolicy.request.ping &&
      saved.effectivePolicy.request.onboard &&
      saved.effectivePolicy.request.sign &&
      saved.effectivePolicy.request.ecdh,
    receive:
      saved.effectivePolicy.respond.ping &&
      saved.effectivePolicy.respond.onboard &&
      saved.effectivePolicy.respond.sign &&
      saved.effectivePolicy.respond.ecdh,
    state: 'offline',
    statusLabel: 'offline',
    lastSeen: null,
  }));
}

function toLogEntry(event: ObservabilityEvent): LogEntry {
  return {
    id: `${event.ts}-${event.domain}-${event.event}`,
    time: new Date(event.ts).toLocaleTimeString(),
    level: event.level.toUpperCase(),
    message: `${event.domain}.${event.event}`,
    data: event,
  };
}

function derivePeers(status: ExtensionStatusSnapshot, savedPolicies: StoredPeerPolicy[]): PeerPolicy[] {
  const base = new Map<string, PeerPolicy>();

  for (const [index, saved] of savedPolicies.entries()) {
    base.set(saved.pubkey.toLowerCase(), {
      alias: `Peer ${index + 1}`,
      pubkey: saved.pubkey.toLowerCase(),
      send:
        saved.effectivePolicy.request.ping &&
        saved.effectivePolicy.request.onboard &&
        saved.effectivePolicy.request.sign &&
        saved.effectivePolicy.request.ecdh,
      receive:
        saved.effectivePolicy.respond.ping &&
        saved.effectivePolicy.respond.onboard &&
        saved.effectivePolicy.respond.sign &&
        saved.effectivePolicy.respond.ecdh,
      state: 'offline',
      statusLabel: 'offline',
      lastSeen: null,
    });
  }

  for (const [index, peer] of (status.runtimeDetails.summary?.metadata.peers ?? []).entries()) {
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

  for (const peer of status.runtimeDetails.peerStatus) {
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
  const { appState, profile, logout } = useStore();
  const [copiedField, setCopiedField] = React.useState<'group' | 'share' | null>(null);
  const [peers, setPeers] = React.useState<PeerPolicy[]>(
    () => initializePeers(appState?.runtime.summary?.peer_permission_states)
  );
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [runtimeStatus, setRuntimeStatus] = React.useState<'stopped' | 'connecting' | 'running'>('stopped');
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [status, setStatus] = React.useState<ExtensionStatusSnapshot | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [nextStatus, diagnostics] = await Promise.all([
        fetchExtensionStatus(),
        fetchRuntimeDiagnostics(),
      ]);

      setStatus(nextStatus);
      setRuntimeStatus(
        nextStatus.lifecycle.activation.stage === 'ensuring_offscreen' ||
          nextStatus.lifecycle.activation.stage === 'restoring_runtime' ||
          nextStatus.lifecycle.activation.stage === 'syncing_status'
          ? 'connecting'
          : nextStatus.runtime === 'ready' || nextStatus.runtime === 'degraded'
            ? 'running'
            : 'stopped',
      );
      setRuntimeError(nextStatus.lifecycle.activation.lastError?.message ?? nextStatus.runtimeDetails.snapshotError ?? null);
      setPeers(derivePeers(nextStatus, nextStatus.runtimeDetails.summary?.peer_permission_states ?? []));
      setLogs(diagnostics.diagnostics.map(toLogEntry));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeError(message);
    }
  }, [appState?.runtime.summary?.peer_permission_states]);

  React.useEffect(() => {
    void refresh();
    const chromeApi = getChromeApi();
    const runtimeMessageApi = chromeApi?.runtime?.onMessage as
      | {
          addListener?: (listener: (message: unknown) => void) => void;
          removeListener?: (listener: (message: unknown) => void) => void;
        }
      | undefined;
    const messageListener = (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === MESSAGE_TYPE.RUNTIME_STATUS_UPDATED
      ) {
        void refresh();
      }
    };
    runtimeMessageApi?.addListener?.(messageListener);
    const handle = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      runtimeMessageApi?.removeListener?.(messageListener);
      window.clearInterval(handle);
    };
  }, [refresh, refreshTick]);

  const handleStart = async () => {
    if (!profile) return;
    setRuntimeStatus('connecting');
    setRuntimeError(null);

    try {
      await sendRuntimeControl('ensureConfiguredRuntime');
      setRefreshTick((value) => value + 1);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeError(message);
      setRuntimeStatus('stopped');
    }
  };

  const handleStop = async () => {
    try {
      await sendRuntimeControl('stopRuntime');
      setRefreshTick((value) => value + 1);
      await refresh();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRefreshPeers = async () => {
    try {
      await sendRuntimeControl('refreshAllPeers');
      setRefreshTick((value) => value + 1);
      await refresh();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCopy = async (field: 'group' | 'share') => {
    const value =
      field === 'group'
        ? status?.publicKey ?? profile?.groupPublicKey
        : status?.sharePublicKey ?? profile?.sharePublicKey;
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

  const isSignerRunning = runtimeStatus === 'running';
  const isConnecting = runtimeStatus === 'connecting';
  const activationStage = status?.lifecycle.activation.stage ?? 'idle';
  const runtimeControlLabel =
    activationStage === 'failed'
      ? 'Retry Runtime'
      : isSignerRunning
        ? 'Stop Signer'
        : isConnecting
          ? 'Starting...'
          : 'Start Signer';
  const runtimeSummaryLabel =
    activationStage === 'ensuring_offscreen'
      ? 'Ensuring offscreen runtime'
      : activationStage === 'restoring_runtime' || activationStage === 'syncing_status'
        ? 'Restoring runtime'
        : activationStage === 'failed'
          ? 'Runtime failed'
          : isSignerRunning
            ? 'Signer Running'
            : 'Signer Stopped';

  if (!profile) {
    const emptyState = (
      <ContentCard title="No onboarding profile" description="Complete onboarding to configure this signer.">
        <div className="border border-blue-800/30 rounded-lg p-6">
          <Button variant="ghost" onClick={logout}>
            Go to onboarding
          </Button>
        </div>
      </ContentCard>
    );
    if (embedded) return emptyState;
    return <PageLayout header={<AppHeader title="igloo-chrome" subtitle="browser signing device" />}>{emptyState}</PageLayout>;
  }

  const content = (
    <OperatorSignerPanel
      profile={{
        name: profile.keysetName || 'Unnamed signer',
        groupPublicKey: profile.groupPublicKey,
        sharePublicKey: profile.sharePublicKey,
      }}
      introMessage="The signer runtime is hosted by the extension background and offscreen document. This page is an operator console over that runtime."
      runtimeState={runtimeStatus}
      runtimeControlLabel={runtimeControlLabel}
      runtimeSummaryLabel={runtimeSummaryLabel}
      activationStage={status?.lifecycle.activation.stage ?? null}
      activationUpdatedAt={status?.lifecycle.activation.updatedAt ?? null}
      runtimeError={runtimeError}
      sharePublicKey={status?.sharePublicKey ?? profile.sharePublicKey ?? ''}
      groupPublicKey={status?.publicKey ?? profile.groupPublicKey ?? ''}
      copiedField={copiedField}
      onCopyGroupKey={() => void handleCopy('group')}
      onCopyShareKey={() => void handleCopy('share')}
      onPrimaryAction={isSignerRunning ? () => void handleStop() : () => void handleStart()}
      primaryActionDisabled={isConnecting}
      onRefreshPeers={() => void handleRefreshPeers()}
      refreshPeersDisabled={!isSignerRunning}
      peers={peers}
      pendingOperations={
        status?.runtimeDetails.summary?.pending_operations.map((operation) => ({
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
