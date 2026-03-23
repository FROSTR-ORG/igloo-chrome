import type { ActivationStage, RuntimePhase } from '@/extension/protocol';

export type RuntimePresentation = {
  runtimeState: 'stopped' | 'connecting' | 'running';
  runtimeControlLabel: string;
  runtimeSummaryLabel: string;
  runtimeError: string | null;
};

function formatActivationError(
  activationStage: ActivationStage,
  runtimeError: string | null,
): string | null {
  if (activationStage !== 'failed') {
    return runtimeError;
  }
  if (!runtimeError) {
    return 'Signer activation failed before the extension runtime became ready. Retry runtime startup.';
  }
  return `Signer activation failed before the extension runtime became ready. ${runtimeError}`;
}

export function deriveRuntimePresentation(
  activationStage: ActivationStage,
  runtimePhase: RuntimePhase,
  runtimeError: string | null,
): RuntimePresentation {
  const isConnecting =
    activationStage === 'creating_offscreen' ||
    activationStage === 'waiting_offscreen_ready' ||
    activationStage === 'calling_offscreen' ||
    activationStage === 'ensuring_offscreen' ||
    activationStage === 'restoring_runtime' ||
    activationStage === 'syncing_status';
  const runtimeState =
    isConnecting
      ? 'connecting'
      : runtimePhase === 'ready' || runtimePhase === 'degraded'
        ? 'running'
        : 'stopped';
  const runtimeControlLabel =
    activationStage === 'failed'
      ? 'Retry Runtime'
      : runtimeState === 'running'
        ? 'Stop Signer'
        : runtimeState === 'connecting'
          ? 'Starting...'
          : 'Start Signer';
  const runtimeSummaryLabel =
    activationStage === 'creating_offscreen'
      ? 'Creating offscreen runtime'
      : activationStage === 'waiting_offscreen_ready'
        ? 'Waiting for offscreen runtime'
        : activationStage === 'calling_offscreen'
          ? 'Starting signer runtime'
          : activationStage === 'ensuring_offscreen'
            ? 'Ensuring offscreen runtime'
            : activationStage === 'restoring_runtime' || activationStage === 'syncing_status'
              ? 'Restoring runtime'
              : activationStage === 'failed'
                ? 'Runtime failed'
                : runtimeState === 'running'
                  ? 'Signer Running'
                  : 'Signer Stopped';

  return {
    runtimeState,
    runtimeControlLabel,
    runtimeSummaryLabel,
    runtimeError: formatActivationError(activationStage, runtimeError),
  };
}
