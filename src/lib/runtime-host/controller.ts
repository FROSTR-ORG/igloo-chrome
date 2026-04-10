import {
  clearRuntimePeerPolicyOverridesOnNode,
  createLogger,
  getRuntimeConfigFromNode,
  getRuntimeSnapshot,
  getRuntimeStatus,
  prepareEcdhOnNode,
  prepareSignOnNode,
  refreshAllPeersOnNode,
  summarizeRuntimeLifecycle,
  updateRuntimeConfigOnNode,
  updateRuntimePeerPolicyOverrideOnNode,
  wipeRuntimeStateOnNode,
  type BrowserProfilePackagePayload,
  type RuntimeStatusSummary,
} from '@/lib/igloo';
import {
  type PendingOnboardingProfile,
  type PolicyOverrideValue,
  type ProviderMethod,
  type RuntimeLifecycleStatus,
  type RuntimePhase,
  type RuntimeSnapshotDetails,
  type StoredExtensionProfile,
} from '@/extension/protocol';
import { createPendingBootDiagnostics, attachDiagnostics } from '@/lib/runtime-host/diagnostics';
import {
  profileKey,
  resolveRuntimePhase,
  shutdownNode,
  toErrorMessage,
} from '@/lib/runtime-host/helpers';
import { captureOnboardingRuntimeProfile } from '@/lib/runtime-host/onboarding-session';
import { executeProviderMethodOnSession } from '@/lib/runtime-host/provider-execution';
import { waitForNonceSnapshot } from '@/lib/runtime-host/readiness';
import {
  persistSessionSnapshot,
  persistSessionSnapshotInBackground,
} from '@/lib/runtime-host/snapshot-persistence';
import { connectRuntimeNode, createRuntimeNodeForProfile } from '@/lib/runtime-host/session-bootstrap';
import type {
  RuntimeStatusListener,
  RuntimeStatusUpdate,
  SignerSession,
} from '@/lib/runtime-host/types';
import { type SignerSettings } from '@/lib/signer-settings';

type PersistMode = 'none' | 'foreground' | 'background';

const logger = createLogger('igloo.runtime-worker');

export function createRuntimeHostController() {
  const pendingBootDiagnostics = createPendingBootDiagnostics();
  let signerSessionPromise: Promise<SignerSession> | null = null;
  let signerSessionKey: string | null = null;
  let runtimePhase: RuntimePhase = 'cold';
  let runtimeStatusListener: RuntimeStatusListener | null = null;

  async function emitStatusUpdate(status: RuntimeStatusSummary | null, runtime = runtimePhase) {
    await runtimeStatusListener?.({
      runtime,
      status,
    });
  }

  function persistDetail(session: Pick<SignerSession, 'profileId' | 'key'>, reason: string) {
    return {
      profileId: session.profileId,
      profileKey: session.key,
      reason,
    };
  }

  async function persistSnapshotNow(
    session: SignerSession,
    reason: string,
    options: {
      suppressErrors?: boolean;
      recordDiagnostics?: boolean;
    } = {}
  ) {
    const detail = persistDetail(session, reason);
    try {
      const result = await persistSessionSnapshot(session);
      logger.info('runtime', 'persist_snapshot_ok', {
        ...detail,
        snapshot_bytes: result.snapshotJson.length,
      });
      if (options.recordDiagnostics ?? true) {
        pendingBootDiagnostics.push('info', 'runtime', 'persist_snapshot_ok', detail);
      }
      return result;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.warn('runtime', 'persist_snapshot_failed', {
        ...detail,
        error_message: errorMessage,
      });
      if (options.recordDiagnostics ?? true) {
        pendingBootDiagnostics.push('warn', 'runtime', 'persist_snapshot_failed', {
          ...detail,
          error_message: errorMessage,
        });
      }
      if (!options.suppressErrors) {
        throw error;
      }
      return null;
    }
  }

  function scheduleBackgroundPersist(session: SignerSession, reason = 'runtime_status') {
    const detail = {
      profileId: session.profileId,
      profileKey: session.key,
    };
    persistSessionSnapshotInBackground(session, async () => {
      await persistSnapshotNow(session, reason, {
        suppressErrors: true,
        recordDiagnostics: true,
      });
    });
  }

  async function updateRuntimeState(
    session: SignerSession,
    options: {
      persist?: PersistMode;
      phaseOverride?: RuntimePhase;
    } = {}
  ) {
    const persist = options.persist ?? 'none';
    if (persist === 'foreground') {
      await persistSnapshotNow(session, 'runtime_update', {
        suppressErrors: true,
      });
    } else if (persist === 'background') {
      scheduleBackgroundPersist(session, 'runtime_update');
    }
    runtimePhase = options.phaseOverride ?? resolveRuntimePhase(session);
    const status = getRuntimeStatus(session.node);
    await emitStatusUpdate(status, runtimePhase);
    return status;
  }

  async function requireSession() {
    if (!signerSessionPromise) {
      throw new Error('runtime is not active');
    }
    return await signerSessionPromise;
  }

  async function runSessionOperation<T>(
    operation: (session: SignerSession) => Promise<T>,
    options: {
      persist?: PersistMode;
      phaseOverride?: RuntimePhase;
      status?: boolean;
    } = {}
  ) {
    const session = await requireSession();
    const result = await operation(session);
    if (options.status !== false) {
      await updateRuntimeState(session, {
        persist: options.persist,
        phaseOverride: options.phaseOverride,
      });
    }
    return result;
  }

  async function ensureSignerSession(
    profile: StoredExtensionProfile,
    profilePayload?: BrowserProfilePackagePayload,
    sessionKeyB64?: string
  ) {
    const nextKey = profileKey(profile);
    if (signerSessionPromise && signerSessionKey === nextKey) {
      return await signerSessionPromise;
    }
    if (!sessionKeyB64?.trim()) {
      throw new Error('Missing unlocked session key for runtime profile.');
    }

    await stopRuntime().catch(() => undefined);
    pendingBootDiagnostics.reset();
    pendingBootDiagnostics.push('info', 'runtime', 'ensure_session_begin', {
      profile_id: profile.id,
      profile_key: nextKey,
    });

    signerSessionKey = nextKey;
    runtimePhase = 'restoring';
    signerSessionPromise = Promise.resolve()
      .then(async () => {
        const node = createRuntimeNodeForProfile(profile, profilePayload);
        const attached = attachDiagnostics(node);
        try {
          await connectRuntimeNode(node);

          const session: SignerSession = {
            key: nextKey,
            profileId: profile.id,
            sessionKeyB64,
            node,
            diagnostics: attached.diagnostics,
            droppedDiagnostics: attached.dropped,
            detachDiagnostics: attached.detach,
            persistInFlight: null,
            persistQueued: false,
          };

          node.on('runtime-status', (status: unknown) => {
            if (!status || typeof status !== 'object') return;
            runtimePhase = resolveRuntimePhase(session);
            void emitStatusUpdate(status as RuntimeStatusSummary, runtimePhase);
            scheduleBackgroundPersist(session);
          });

          await updateRuntimeState(session, { persist: 'background' });
          return session;
        } catch (error) {
          attached.detach();
          await shutdownNode(node).catch(() => undefined);
          throw error;
        }
      })
      .catch(async (error) => {
        logger.error('runtime', 'ensure_session_failed', {
          profile_id: profile.id,
          profile_key: nextKey,
          error_message: toErrorMessage(error),
        });
        signerSessionPromise = null;
        signerSessionKey = null;
        runtimePhase = 'cold';
        await emitStatusUpdate(null, 'cold');
        throw error;
      });

    return await signerSessionPromise;
  }

  async function ensureRuntime(
    profile: StoredExtensionProfile,
    profilePayload?: BrowserProfilePackagePayload,
    sessionKeyB64?: string
  ) {
    const session = await ensureSignerSession(profile, profilePayload, sessionKeyB64);
    refreshAllPeersOnNode(session.node);
    await updateRuntimeState(session);
    return {
      runtime: runtimePhase,
    };
  }

  async function getRuntimeStatusSnapshot() {
    if (!signerSessionPromise) {
      return {
        runtime: 'cold' as const,
        status: null,
      };
    }
    const session = await signerSessionPromise;
    runtimePhase = resolveRuntimePhase(session);
    return {
      runtime: runtimePhase,
      status: getRuntimeStatus(session.node),
    };
  }

  async function getRuntimeSnapshotDetails() {
    if (!signerSessionPromise) {
      return {
        runtime: 'cold' as const,
        status: null,
        snapshot: null,
        snapshotError: null,
      };
    }
    const session = await signerSessionPromise;
    runtimePhase = resolveRuntimePhase(session);
    let snapshot: unknown = null;
    let snapshotError: string | null = null;
    try {
      snapshot = getRuntimeSnapshot(session.node);
      await persistSnapshotNow(session, 'snapshot_inspection', {
        suppressErrors: true,
      });
    } catch (error) {
      snapshotError = toErrorMessage(error);
    }
    return {
      runtime: runtimePhase,
      status: getRuntimeStatus(session.node),
      snapshot: snapshot as RuntimeSnapshotDetails | null,
      snapshotError,
      lifecycle: summarizeRuntimeLifecycle(session.diagnostics()) as RuntimeLifecycleStatus,
    };
  }

  async function getRuntimeDiagnosticsSnapshot() {
    if (!signerSessionPromise) {
      return {
        runtime: 'cold' as const,
        diagnostics: pendingBootDiagnostics.snapshot(),
        dropped: pendingBootDiagnostics.dropped(),
        runtimeStatus: null,
      };
    }
    const session = await signerSessionPromise;
    return {
      runtime: runtimePhase,
      diagnostics: session.diagnostics(),
      dropped: session.droppedDiagnostics(),
      runtimeStatus: getRuntimeStatus(session.node),
    };
  }

  async function stopRuntime() {
    const existing = signerSessionPromise;
    signerSessionPromise = null;
    signerSessionKey = null;
    runtimePhase = 'cold';

    const session = await existing?.catch(() => null);
    if (session) {
      await persistSnapshotNow(session, 'runtime_stop', {
        suppressErrors: true,
      });
      session.detachDiagnostics();
      await shutdownNode(session.node).catch(() => undefined);
    }
    await emitStatusUpdate(null, 'cold');
    return {
      runtime: 'cold' as const,
    };
  }

  async function readRuntimeConfig() {
    const session = await requireSession();
    return getRuntimeConfigFromNode(session.node);
  }

  async function updateRuntimeConfig(settings: Partial<SignerSettings>) {
    return await runSessionOperation(async (session) => {
      updateRuntimeConfigOnNode(session.node, settings);
      return getRuntimeConfigFromNode(session.node);
    }, { persist: 'foreground' });
  }

  async function updateRuntimePeerPolicy(
    pubkey: string,
    patch: {
      direction: 'request' | 'respond';
      method: 'ping' | 'onboard' | 'sign' | 'ecdh';
      value: PolicyOverrideValue;
    }
  ) {
    return await runSessionOperation(async (session) => {
      await updateRuntimePeerPolicyOverrideOnNode(session.node, pubkey, patch);
      return getRuntimeStatus(session.node);
    }, { persist: 'foreground' });
  }

  async function clearRuntimePeerPolicyOverrides() {
    return await runSessionOperation(async (session) => {
      await clearRuntimePeerPolicyOverridesOnNode(session.node);
      return getRuntimeStatus(session.node);
    }, { persist: 'foreground' });
  }

  async function refreshAllPeers() {
    await runSessionOperation(async (session) => {
      refreshAllPeersOnNode(session.node);
      return undefined;
    });
    return {
      runtime: runtimePhase,
    };
  }

  async function prepareSign() {
    const readiness = await runSessionOperation(async (session) => {
      return await prepareSignOnNode(session.node);
    }, { persist: 'background' });
    return {
      runtime: runtimePhase,
      readiness,
    };
  }

  async function prepareEcdh() {
    const readiness = await runSessionOperation(async (session) => {
      return await prepareEcdhOnNode(session.node);
    }, { persist: 'background' });
    return {
      runtime: runtimePhase,
      readiness,
    };
  }

  async function wipeRuntimeState() {
    const status = await runSessionOperation(async (session) => {
      wipeRuntimeStateOnNode(session.node);
      return getRuntimeStatus(session.node);
    }, { persist: 'foreground', phaseOverride: 'degraded' });
    return {
      runtime: runtimePhase,
      status,
    };
  }

  async function decodeProfile(
    profile: StoredExtensionProfile,
    profilePayload?: BrowserProfilePackagePayload,
    sessionKeyB64?: string
  ) {
    const session = await ensureSignerSession(profile, profilePayload, sessionKeyB64);
    const status = getRuntimeStatus(session.node);
    return {
      publicKey: status.metadata.group_public_key,
      sharePublicKey: status.metadata.share_public_key,
      peerPubkey:
        typeof profile.peerPubkey === 'string' && profile.peerPubkey.trim()
          ? profile.peerPubkey.trim().toLowerCase()
          : '',
    };
  }

  async function executeProviderMethod(input: {
    profile: StoredExtensionProfile;
    profilePayload?: BrowserProfilePackagePayload;
    sessionKeyB64?: string;
    method: ProviderMethod;
    params?: Record<string, unknown>;
  }) {
    const { profile, profilePayload, sessionKeyB64, method, params } = input;
    const session = await ensureSignerSession(profile, profilePayload, sessionKeyB64);
    const result = await executeProviderMethodOnSession({
      session,
      method,
      params,
    });
    await updateRuntimeState(session, { persist: 'background' });
    return result;
  }

  async function captureOnboardingProfile(input: {
    packageText: string;
    password: string;
    groupName?: string;
    signerSettings?: Partial<SignerSettings>;
    onProgress?: (
      stage: 'decoding_package' | 'connecting_peer' | 'awaiting_onboard_response' | 'snapshot_captured',
      detail?: Record<string, unknown>
    ) => Promise<void> | void;
  }): Promise<PendingOnboardingProfile> {
    return await captureOnboardingRuntimeProfile(input);
  }

  function setRuntimeHostStatusListener(listener: RuntimeStatusListener | null) {
    runtimeStatusListener = listener;
  }

  function isRuntimeActive() {
    return signerSessionPromise !== null;
  }

  return {
    captureOnboardingProfile,
    clearRuntimePeerPolicyOverrides,
    decodeProfile,
    ensureRuntime,
    executeProviderMethod,
    getRuntimeDiagnosticsSnapshot,
    getRuntimeSnapshotDetails,
    getRuntimeStatusSnapshot,
    isRuntimeActive,
    prepareEcdh,
    prepareSign,
    readRuntimeConfig,
    refreshAllPeers,
    setRuntimeHostStatusListener,
    stopRuntime,
    updateRuntimeConfig,
    updateRuntimePeerPolicy,
    wipeRuntimeState,
    // Internal test hooks.
    _private: {
      ensureSignerSession,
      emitStatusUpdate,
      requireSession,
      updateRuntimeState,
      waitForNonceSnapshot,
    },
  };
}

export type RuntimeHostController = ReturnType<typeof createRuntimeHostController>;
