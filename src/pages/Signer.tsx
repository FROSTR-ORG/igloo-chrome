import * as React from 'react';
import {
  AppHeader,
  buildPeerReadinessRows,
  buildPendingApprovalRows,
  ContentCard,
  DashboardConditionBanner,
  DashboardLoadFailedScreen,
  DashboardLoadingScreen,
  deriveDashboardState,
  OperatorSignerPanel,
  PageLayout,
  observabilityEventsToEventRows,
  type PeerReadinessRowModel,
  type PendingOperationRowModel,
  type SignerDashboardViewModel,
} from 'igloo-ui';
import { type RuntimeStatusSummary, type StoredPeerPolicy } from '@/extension/protocol';
import { useStore } from '@/lib/store';
import { toDashboardKey } from '@/lib/dashboard-view';
import { deriveRuntimePresentation } from '@/lib/runtime-activation';
import { createLogger } from '@/lib/observability';
import {
  normalizeStoredPeerPolicies,
  peerAllowsAllRequests,
  peerAllowsAllResponses,
} from '@/lib/peer-policy';

const logger = createLogger('igloo.signer-page');

function derivePeers(
  summary: RuntimeStatusSummary | null,
  savedPolicies: StoredPeerPolicy[],
): PeerReadinessRowModel[] {
  return buildPeerReadinessRows({
    peers: summary?.peers ?? [],
    rosterPubkeys: summary?.metadata.peers ?? [],
    policyPubkeys: normalizeStoredPeerPolicies(savedPolicies).map((policy) => policy.pubkey),
  });
}

export function SignerPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    appState,
    loadRuntimeDiagnostics,
    profile,
    refreshRuntimePeers,
    resolveApproval,
    startRuntime,
    stopRuntime,
    updatePeerPolicy,
  } = useStore();
  const [copiedField, setCopiedField] = React.useState<'group' | 'share' | null>(null);
  const [eventRows, setEventRows] = React.useState<ReturnType<typeof observabilityEventsToEventRows>>([]);
  const [actionError, setActionError] = React.useState<string | null>(null);
  // request_id of a signing-failed banner the operator dismissed.
  const [dismissedSignFailureId, setDismissedSignFailureId] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadRuntimeDiagnostics()
      .then((diagnostics) => {
        setEventRows(observabilityEventsToEventRows(diagnostics.diagnostics));
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

  const handleCopy = async (field: 'group' | 'share', format?: 'npub' | 'hex') => {
    const hex =
      field === 'group'
        ? appState?.runtime.metadata?.group_public_key ?? profile?.groupPublicKey
        : appState?.runtime.metadata?.share_public_key ?? profile?.sharePublicKey;
    if (!hex) return;
    // npub by default (the KeyRow's default copy); hex via the format caret.
    const model = toDashboardKey(hex);
    const value = format === 'hex' ? model?.hex ?? hex : model?.npub ?? hex;
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

  const pendingApprovalRows = buildPendingApprovalRows({
    approvals: appState?.runtime.summary?.pending_approvals ?? [],
    peerAliases: Object.fromEntries(peers.map((row) => [row.pubkey, row.alias])),
  });

  const view: SignerDashboardViewModel = {
    profileName: profile.groupName || 'Unnamed signer',
    thresholdLabel: peers.length ? `${peers.length} peers` : 'no peers',
    publicKeyLabel: groupPublicKey,
    shareLabel: sharePublicKey,
    // Structured keys enable the npub/hex split-copy KeyRow (parity with
    // igloo-pwa); the panel falls back to the plain KeyField if undefined.
    groupKey: toDashboardKey(groupPublicKey),
    shareKey: toDashboardKey(sharePublicKey),
    // Drives the panel's running vs stopped layout (live peers/pending sections
    // vs the static Readiness/Next-Step cards). Without it a running signer would
    // render the stopped cards. Mirrors igloo-pwa's `running` view field.
    running: isSignerRunning,
    readinessLabel: runtimeSummaryLabel,
    relaySummary: displayRuntimeError ?? (isSignerRunning ? 'Runtime connected' : 'Runtime stopped'),
    peerRows: peers,
    pendingApprovalRows,
    pendingOperationRows,
    eventRows,
  };

  const handleAlwaysAllow = (id: string) => {
    const row = pendingApprovalRows.find((approval) => approval.id === id);
    if (!row) return;
    // Approve this request, then persist an Allow override so future requests
    // for this peer+method skip the queue.
    void (async () => {
      try {
        await resolveApproval(id, true);
        await updatePeerPolicy(row.pubkey, { direction: 'respond', method: row.method, value: 'allow' });
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const dashboardState = deriveDashboardState({
    active: isSignerRunning,
    status: appState?.runtime.summary ?? null,
    // "Profile saved, signer unavailable" is a soft, not-yet-started state shown
    // within the panel (relaySummary), not a full-panel load failure. The
    // load-failed screen is driven by a host-surfaced status.last_load_error.
    dismissedSignFailureId,
  });

  const signerPanel = (
    <OperatorSignerPanel
      view={view}
      runtimeControlLabel={runtimeControlLabel}
      copiedField={copiedField}
      onCopyGroupKey={(format) => void handleCopy('group', format)}
      onCopyShareKey={(format) => void handleCopy('share', format)}
      onPrimaryAction={isSignerRunning ? () => void handleStop() : () => void handleStart()}
      primaryActionVariant={isSignerRunning ? 'destructive' : 'success'}
      primaryActionDisabled={isConnecting}
      onRefreshPeers={() => void handleRefreshPeers()}
      refreshPeersDisabled={!isSignerRunning}
      onApproveOnce={(id) => void resolveApproval(id, true)}
      onDenyApproval={(id) => void resolveApproval(id, false)}
      onAlwaysAllow={handleAlwaysAllow}
    />
  );

  const content =
    dashboardState.kind === 'loading' ? (
      <DashboardLoadingScreen detail={dashboardState.detail} />
    ) : dashboardState.kind === 'load-failed' ? (
      <DashboardLoadFailedScreen
        message={dashboardState.message}
        timestampLabel={
          dashboardState.at ? new Date(dashboardState.at * 1000).toLocaleString() : undefined
        }
        onRetry={() => void handleStart()}
      />
    ) : (
      <div className="space-y-4">
        {dashboardState.banners.map((banner) => (
          <DashboardConditionBanner
            key={banner.kind}
            banner={banner}
            timestampLabel={
              banner.kind === 'signing-failed'
                ? new Date(banner.at * 1000).toLocaleString()
                : undefined
            }
            onDismiss={
              banner.kind === 'signing-failed'
                ? () => setDismissedSignFailureId(banner.requestId)
                : undefined
            }
          />
        ))}
        {signerPanel}
      </div>
    );

  if (embedded) return content;

  return <PageLayout header={<AppHeader mode="task" taskLabel="browser signing device" />}>{content}</PageLayout>;
}
