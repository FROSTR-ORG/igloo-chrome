import { getChromeApi } from '@/extension/chrome';
import {
  MESSAGE_TYPE,
  OFFSCREEN_DOCUMENT_PATH,
  PROMPT_DOCUMENT_PATH,
  PROMPT_HEIGHT,
  PROMPT_WIDTH,
  getPermissionLabel,
  isProviderMethod,
  isRecord,
  type ExtensionAppState,
  type RuntimeLifecycleStatus,
  type RuntimeMetadata,
  type RuntimePendingOperation,
  type RuntimePeerStatus,
  type RuntimePhase,
  type RuntimeReadiness,
  type RuntimeSnapshotDetails,
  type RuntimeStatusDetails,
  type RuntimeStatusSummary,
  type StoredExtensionProfile,
  type PromptResponseMessage,
  type ProviderMethod,
  type ProviderRequestEnvelope
} from '@/extension/protocol';
import {
  clearExtensionProfile,
  loadExtensionAppState,
  loadLifecycleHistory,
  loadLifecycleStatus,
  loadExtensionProfile,
  loadPermissionPolicies,
  loadRuntimeSnapshot as loadPersistedRuntimeSnapshot,
  mirrorProfileToExtensionStorage,
  resolvePermissionDecision,
  saveExtensionAppState,
  savePermissionDecision,
  saveRuntimeSnapshot as savePersistedRuntimeSnapshot,
  updateOnboardingLifecycle,
  updateActivationLifecycle
} from '@/extension/storage';
import { createLogger } from '@/lib/observability';
import { normalizeSignerSettings } from '@/lib/signer-settings';
import type { LifecycleFailure } from '@/extension/protocol';
import { DEFAULT_RELAYS, normalizeRelays } from '@/lib/igloo';
import { deriveProfileIdFromSharePublicKey } from '@/lib/igloo';

type PromptState = {
  request: ProviderRequestEnvelope;
  resolve: (allow: boolean) => void;
  windowId?: number;
};

type RuntimeSnapshotResult = {
  runtime: RuntimePhase;
  snapshot: RuntimeSnapshotDetails | null;
  snapshotError: string | null;
  lifecycle?: RuntimeLifecycleStatus;
};

type RuntimeStatusResult = {
  runtime: RuntimePhase;
  status: RuntimeStatusSummary | null;
};

type RuntimeDiagnosticsResult = {
  runtime: RuntimePhase;
  diagnostics: unknown[];
  dropped: number;
  runtimeStatus?: RuntimeStatusSummary | null;
};

const pendingPrompts = new Map<string, PromptState>();
const promptWindowMap = new Map<number, string>();
let creatingOffscreen: Promise<void> | null = null;
let ensuringConfiguredRuntime: Promise<void> | null = null;
let offscreenCreatedWithoutContextApi = false;
let lastRuntimeStatusCache: RuntimeStatusResult = {
  runtime: 'cold',
  status: null
};
const logger = createLogger('igloo.background');

function toErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return fallback;
}

function activationFailure(
  code: LifecycleFailure['code'],
  message: string,
  source: LifecycleFailure['source'] = 'background'
): LifecycleFailure {
  return {
    code,
    message,
    source,
    updatedAt: Date.now()
  };
}

function profileKey(profile: {
  groupPublicKey?: string;
  publicKey?: string;
  relays: string[];
}) {
  const groupPublicKey =
    typeof profile.groupPublicKey === 'string' && profile.groupPublicKey.trim()
      ? profile.groupPublicKey
      : typeof profile.publicKey === 'string' && profile.publicKey.trim()
        ? profile.publicKey
        : undefined;
  return JSON.stringify({
    groupPublicKey: groupPublicKey?.trim().toLowerCase(),
    relays: profile.relays.map((relay) => relay.trim())
  });
}

async function normalizeProfileInput(profile: StoredExtensionProfile): Promise<StoredExtensionProfile> {
  const { relays } = normalizeRelays(profile.relays?.length ? profile.relays : DEFAULT_RELAYS);
  const sharePublicKey = profile.sharePublicKey?.trim().toLowerCase() || undefined;
  const id =
    profile.id?.trim().toLowerCase() ||
    (sharePublicKey ? await deriveProfileIdFromSharePublicKey(sharePublicKey) : undefined);
  if (!id) {
    throw new Error('Profile is missing a share public key.');
  }
  return {
    ...profile,
    id,
    relays,
    keysetName: profile.keysetName?.trim() || undefined,
    groupPublicKey: profile.groupPublicKey?.trim().toLowerCase() || undefined,
    sharePublicKey,
    publicKey: profile.publicKey?.trim().toLowerCase() || undefined,
    peerPubkey: profile.peerPubkey?.trim().toLowerCase() || undefined,
    signerSettings: normalizeSignerSettings(profile.signerSettings)
  };
}

async function rejectDuplicateProfile(profile: StoredExtensionProfile) {
  const existing = await loadExtensionProfile();
  if (existing?.id?.trim().toLowerCase() === profile.id) {
    throw new Error(`Device profile ${profile.keysetName ?? 'device'} already exists.`);
  }
}

function responseOk(result: unknown) {
  return { ok: true, result };
}

function responseError(error: unknown) {
  return { ok: false, error: toErrorMessage(error) };
}

function peerPermissionStatesFromStatus(status: RuntimeStatusSummary | null) {
  return status?.peer_permission_states ?? [];
}

function toStatusSnapshot(state: ExtensionAppState) {
  return {
    configured: state.configured,
    keysetName: state.profile?.keysetName ?? null,
    publicKey:
      state.runtime.metadata?.group_public_key ??
      state.profile?.groupPublicKey ??
      state.profile?.publicKey ??
      null,
    sharePublicKey:
      state.runtime.metadata?.share_public_key ?? state.profile?.sharePublicKey ?? null,
    relays: state.profile?.relays ?? [],
    runtime: state.runtime.phase,
    pendingPrompts: state.pendingPrompts,
    lifecycle: state.lifecycle,
    runtimeDetails: {
      status: state.runtime.summary?.status ?? null,
      summary: state.runtime.summary,
      snapshot: state.runtime.snapshot,
      snapshotError: state.runtime.snapshotError,
      peerStatus: state.runtime.peerStatus,
      metadata: state.runtime.metadata,
      readiness: state.runtime.readiness,
      lifecycle: state.runtime.lifecycle
    }
  };
}

async function buildAppState(): Promise<ExtensionAppState> {
  const [profile, lifecycle, permissionPolicies] = await Promise.all([
    loadExtensionProfile(),
    loadLifecycleStatus(),
    loadPermissionPolicies()
  ]);

  return {
    configured: !!profile,
    profile,
    lifecycle,
    runtime: {
      phase: lastRuntimeStatusCache.runtime,
      summary: lastRuntimeStatusCache.status,
      metadata: lastRuntimeStatusCache.status?.metadata ?? null,
      readiness: lastRuntimeStatusCache.status?.readiness ?? null,
      peerStatus: lastRuntimeStatusCache.status?.peers ?? [],
      pendingOperations: lastRuntimeStatusCache.status?.pending_operations ?? [],
      snapshot: null,
      snapshotError: null,
      lifecycle: {
        bootMode: 'unknown',
        reason: null,
        updatedAt: null
      },
      lastError:
        lifecycle.activation.lastError?.message ?? lifecycle.onboarding.lastError?.message ?? null
    },
    permissionPolicies,
    pendingPrompts: pendingPrompts.size
  };
}

async function publishAppStateUpdated() {
  const next = await buildAppState();
  await saveExtensionAppState(next).catch(() => undefined);
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    return next;
  }
  try {
    await chromeApi.runtime.sendMessage({
      type: MESSAGE_TYPE.APP_STATE_UPDATED,
      state: next
    });
  } catch {
    // Ignore listenerless broadcasts.
  }
  return next;
}

async function hasOffscreenDocument() {
  const chromeApi = getChromeApi();
  const getContexts = chromeApi?.runtime?.getContexts;
  const getURL = chromeApi?.runtime?.getURL;
  if (typeof getContexts !== 'function' || typeof getURL !== 'function') {
    return offscreenCreatedWithoutContextApi;
  }

  const contexts = await getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  const chromeApi = getChromeApi();
  if (!chromeApi?.offscreen?.createDocument) {
    const failure = activationFailure('offscreen_unavailable', 'Offscreen document APIs are unavailable');
    await updateActivationLifecycle('failed', 'background', 'cold', undefined, {
      lastError: failure
    }).catch(() => undefined);
    throw new Error(failure.message);
  }
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chromeApi.offscreen
    .createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['DOM_PARSER'],
      justification:
        'Host the bifrost-rs WASM runtime and future long-lived relay sessions outside the MV3 service worker.'
    })
    .then(() => {
      logger.info('offscreen', 'document_created', {
        path: OFFSCREEN_DOCUMENT_PATH
      });
      offscreenCreatedWithoutContextApi = true;
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  await creatingOffscreen;
}

async function closeOffscreenDocument() {
  const chromeApi = getChromeApi();
  if (!chromeApi?.offscreen?.closeDocument) return;
  try {
    if (await hasOffscreenDocument()) {
      logger.info('offscreen', 'document_close_requested');
      const profile = await loadExtensionProfile();
      const snapshotResult = await callOffscreen<RuntimeSnapshotResult>('runtime.snapshot').catch(
        () => null
      );
      if (
        profile &&
        snapshotResult?.runtime === 'ready' &&
        snapshotResult.snapshot &&
        snapshotResult.snapshotError === null
      ) {
        logger.info('runtime', 'snapshot_persist_before_close', {
          profile_key: profileKey(profile)
        });
        await savePersistedRuntimeSnapshot(
          profileKey(profile),
          JSON.stringify(snapshotResult.snapshot)
        );
      }
    }
    await chromeApi.offscreen.closeDocument();
  } finally {
    logger.info('offscreen', 'document_closed');
    offscreenCreatedWithoutContextApi = false;
    creatingOffscreen = null;
    lastRuntimeStatusCache = { runtime: 'cold', status: null };
  }
}

async function callOffscreen<T>(rpcType: string, payload?: Record<string, unknown>) {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error('Extension runtime messaging is unavailable');
  }

  await ensureOffscreenDocument();
  logger.debug('offscreen', 'rpc_begin', { rpc_type: rpcType });

  const response = (await chromeApi.runtime.sendMessage({
    type: MESSAGE_TYPE.OFFSCREEN_RPC,
    rpcType,
    payload
  })) as { ok?: boolean; result?: T; error?: string } | undefined;

  if (!response?.ok) {
    logger.warn('offscreen', 'rpc_failed', {
      rpc_type: rpcType,
      error_message: response?.error || 'Offscreen document did not respond'
    });
    throw new Error(response?.error || 'Offscreen document did not respond');
  }

  logger.debug('offscreen', 'rpc_ok', { rpc_type: rpcType });
  return response.result as T;
}

async function buildRuntimeProfile() {
  const profile = await loadExtensionProfile();
  if (!profile) return null;

  const storedSnapshotJson = await loadPersistedRuntimeSnapshot(profileKey(profile)).catch(
    () => null
  );

  return {
    profile,
    runtimeProfile: storedSnapshotJson
      ? {
          ...profile,
          runtimeSnapshotJson: storedSnapshotJson
        }
      : profile,
    restored: !!storedSnapshotJson
  };
}

async function ensureConfiguredRuntime(reason: string) {
  if (ensuringConfiguredRuntime) {
    await ensuringConfiguredRuntime;
    return;
  }

  ensuringConfiguredRuntime = Promise.resolve()
    .then(async () => {
      await updateActivationLifecycle('ensuring_offscreen', 'background', 'restoring', {
        reason
      }).catch(() => undefined);
      await ensureOffscreenDocument();

      const built = await buildRuntimeProfile();
      if (!built) {
        logger.debug('runtime', 'autostart_skipped', { reason, configured: false });
        await updateActivationLifecycle('idle', 'background', 'cold', {
          reason,
          configured: false
        }).catch(() => undefined);
        await publishAppStateUpdated();
        return;
      }

      await callOffscreen('runtime.ensure', {
        profile: built.runtimeProfile
      });

      const runtimeStatus = await callOffscreen<{
        runtime: 'cold' | 'restoring' | 'ready' | 'degraded';
        status: RuntimeStatusSummary | null;
      }>('runtime.status').catch(() => ({
        runtime: 'restoring' as const,
        status: null
      }));
      lastRuntimeStatusCache = {
        runtime: runtimeStatus.runtime,
        status: runtimeStatus.status
      };

      await updateActivationLifecycle(
        runtimeStatus.runtime === 'ready'
          ? 'ready'
          : runtimeStatus.runtime === 'degraded'
            ? 'degraded'
            : 'syncing_status',
        'background',
        runtimeStatus.runtime,
        {
          reason,
          restoredFromSnapshot: built.restored
        },
        {
          restoredFromSnapshot: built.restored
        }
      ).catch(() => undefined);

      logger.info('runtime', 'autostart_ready', {
        reason,
        profile_key: profileKey(built.profile),
        restored: built.restored
      });
      await publishAppStateUpdated();
    })
    .catch((error) => {
      const failure = activationFailure('status_sync_failed', toErrorMessage(error));
      void updateActivationLifecycle('failed', 'background', 'cold', {
        reason
      }, {
        lastError: failure
      }).catch(() => undefined);
      logger.warn('runtime', 'autostart_failed', {
        reason,
        error_message: toErrorMessage(error)
      });
      void publishAppStateUpdated();
      throw error;
    })
    .finally(() => {
      ensuringConfiguredRuntime = null;
    });

  await ensuringConfiguredRuntime;
}

async function reloadConfiguredRuntime(reason: string) {
  const profile = await loadExtensionProfile();
  if (!profile) return;

  const status = await callOffscreen<{ runtime: 'cold' | 'restoring' | 'ready' | 'degraded' }>('runtime.status').catch(
    () => ({ runtime: 'cold' as const })
  );
  if (status.runtime === 'cold' || status.runtime === 'restoring') {
    logger.debug('runtime', 'reload_skipped', { reason, active: false });
    return;
  }

  await callOffscreen('runtime.stop');
  await ensureConfiguredRuntime(reason);
}

async function executeProviderMethod(request: ProviderRequestEnvelope) {
  logger.info('provider', 'request_execute', {
    request_id: request.id,
    method: request.type,
    host: request.host
  });
  const built = await buildRuntimeProfile();
  if (!built) {
    throw new Error('Signer is not configured yet. Open the extension dashboard first.');
  }

  switch (request.type) {
    case MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY: {
      const publicKey =
        built.profile.groupPublicKey ??
        built.profile.publicKey ??
        built.profile.sharePublicKey ??
        null;
      if (!publicKey) {
        throw new Error('Signer is configured without a public key');
      }
      return publicKey;
    }
    case MESSAGE_TYPE.NOSTR_GET_RELAYS:
      return Object.fromEntries(
        built.profile.relays.map((relay) => [relay, { read: true, write: true }])
      );
    default:
      return await callOffscreen('nostr.execute', {
        profile: built.runtimeProfile,
        method: request.type,
        params: request.params ?? {}
      });
  }
}

async function getRuntimeDiagnostics() {
  return await callOffscreen<RuntimeDiagnosticsResult>('runtime.diagnostics');
}

async function requestPermission(request: ProviderRequestEnvelope) {
  const chromeApi = getChromeApi();
  const createWindow = chromeApi?.windows?.create;
  const getRuntimeUrl = chromeApi?.runtime?.getURL;
  if (!createWindow || !getRuntimeUrl) {
    throw new Error('Permission prompt is unavailable in this runtime');
  }

  const query = new URLSearchParams({
    id: request.id,
    host: request.host,
    type: request.type,
    label: getPermissionLabel(request.type),
    params: JSON.stringify(request.params ?? {})
  });

  return await new Promise<boolean>(async (resolve, reject) => {
    logger.info('permission', 'prompt_open', {
      request_id: request.id,
      method: request.type,
      host: request.host
    });
    pendingPrompts.set(request.id, { request, resolve });
    void publishAppStateUpdated();
    try {
      const created = await createWindow({
        url: `${getRuntimeUrl(PROMPT_DOCUMENT_PATH)}?${query.toString()}`,
        type: 'popup',
        width: PROMPT_WIDTH,
        height: PROMPT_HEIGHT
      });
      const pending = pendingPrompts.get(request.id);
      if (!pending) {
        reject(new Error('Permission request was cancelled'));
        return;
      }
      pending.windowId = created.id;
      if (typeof created.id === 'number') {
        promptWindowMap.set(created.id, request.id);
      }
    } catch (error) {
      pendingPrompts.delete(request.id);
      void publishAppStateUpdated();
      reject(error);
    }
  });
}

async function ensurePermission(request: ProviderRequestEnvelope) {
  const existing = await resolvePermissionDecision(request.host, request.type, request.params);
  if (existing !== null) return existing;
  return await requestPermission(request);
}

async function handleProviderRequest(request: ProviderRequestEnvelope) {
  await ensureOffscreenDocument();
  const allowed = await ensurePermission(request);
  if (!allowed) {
    logger.warn('permission', 'request_denied', {
      request_id: request.id,
      method: request.type,
      host: request.host
    });
    throw new Error('User denied the request');
  }
  logger.info('permission', 'request_allowed', {
    request_id: request.id,
    method: request.type,
    host: request.host
  });
  return await executeProviderMethod(request);
}

async function handlePromptResponse(message: PromptResponseMessage) {
  const chromeApi = getChromeApi();
  const pending = pendingPrompts.get(message.id);
  if (!pending) return;

  pendingPrompts.delete(message.id);
  void publishAppStateUpdated();
  if (typeof pending.windowId === 'number') {
    promptWindowMap.delete(pending.windowId);
  }

  if (message.scope !== 'once') {
    await savePermissionDecision(
      pending.request.host,
      pending.request.type,
      message.allow,
      pending.request.params,
      message.scope
    );
    void publishAppStateUpdated();
  }

  pending.resolve(message.allow);
  logger.info('permission', 'prompt_resolved', {
    request_id: message.id,
    scope: message.scope,
    allow: message.allow
  });

  if (typeof pending.windowId === 'number' && chromeApi?.windows?.remove) {
    try {
      await chromeApi.windows.remove(pending.windowId);
    } catch {
      // Ignore user-closed prompt windows.
    }
  }
}

async function getStatusSnapshot() {
  return toStatusSnapshot(await buildAppState());
}

const chromeApi = getChromeApi();

chromeApi?.runtime?.onInstalled?.addListener((details) => {
  logger.info('extension', 'installed', { reason: details.reason });
  if (details.reason === 'install') {
    void chromeApi.runtime?.openOptionsPage?.();
  }
  void publishAppStateUpdated().catch(() => undefined);
  void ensureConfiguredRuntime(`installed:${details.reason}`).catch(() => undefined);
});

chromeApi?.runtime?.onStartup?.addListener(() => {
  logger.info('extension', 'startup');
  void publishAppStateUpdated().catch(() => undefined);
  void ensureConfiguredRuntime('startup').catch(() => undefined);
});

void publishAppStateUpdated().catch(() => undefined);
void ensureConfiguredRuntime('service_worker_boot').catch(() => undefined);

chromeApi?.windows?.onRemoved?.addListener((windowId) => {
  const requestId = promptWindowMap.get(windowId);
  if (!requestId) return;
  promptWindowMap.delete(windowId);
  const pending = pendingPrompts.get(requestId);
  if (!pending) return;
  pendingPrompts.delete(requestId);
  void publishAppStateUpdated();
  logger.warn('permission', 'prompt_window_closed', { request_id: requestId, window_id: windowId });
  pending.resolve(false);
});

chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (!isRecord(message) || typeof message.type !== 'string') return;

  if (message.type === MESSAGE_TYPE.GET_APP_STATE) {
    void buildAppState()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.PROVIDER_REQUEST) {
    const request = message.request;
    if (!isRecord(request) || !isProviderMethod(request.type)) {
      sendResponse(responseError(new Error('Invalid provider request payload')));
      return;
    }
    void handleProviderRequest(request as ProviderRequestEnvelope)
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.PROMPT_RESPONSE) {
    void handlePromptResponse(message as PromptResponseMessage)
      .then(() => sendResponse(responseOk(true)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.GET_STATUS) {
    void getStatusSnapshot()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.GET_RUNTIME_DIAGNOSTICS) {
    void Promise.all([
      getRuntimeDiagnostics(),
      loadLifecycleStatus(),
      loadLifecycleHistory()
    ])
      .then(([result, lifecycle, lifecycleHistory]) =>
        sendResponse(responseOk({
          ...result,
          lifecycle,
          lifecycleHistory
        }))
      )
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.GET_RUNTIME_CONFIG) {
    void (async () => {
      const profile = await loadExtensionProfile();
      const status =
        lastRuntimeStatusCache.runtime === 'ready' || lastRuntimeStatusCache.runtime === 'degraded'
          ? await callOffscreen<{ runtime: 'cold' | 'restoring' | 'ready' | 'degraded' }>('runtime.status')
          : { runtime: lastRuntimeStatusCache.runtime };
      if (status.runtime === 'ready' || status.runtime === 'degraded') {
        return await callOffscreen('runtime.read_config');
      }
      return normalizeSignerSettings(profile?.signerSettings);
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.UPDATE_RUNTIME_PEER_POLICY) {
    const pubkey = typeof message.pubkey === 'string' ? message.pubkey.trim().toLowerCase() : '';
    const patch = isRecord(message.patch) ? message.patch : null;
    if (
      !pubkey ||
      !patch ||
      (patch.direction !== 'request' && patch.direction !== 'respond') ||
      !['ping', 'onboard', 'sign', 'ecdh'].includes(String(patch.method)) ||
      !['unset', 'allow', 'deny'].includes(String(patch.value))
    ) {
      sendResponse(responseError(new Error('Invalid runtime peer policy update payload')));
      return true;
    }
    void callOffscreen<RuntimeStatusSummary>('runtime.update_peer_policy', {
      pubkey,
      patch
    })
      .then((status) => {
        lastRuntimeStatusCache = { ...lastRuntimeStatusCache, status };
        void publishAppStateUpdated();
        sendResponse(responseOk(peerPermissionStatesFromStatus(status)));
      })
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.CLEAR_RUNTIME_PEER_POLICY_OVERRIDES) {
    void callOffscreen<RuntimeStatusSummary>('runtime.clear_peer_policy_overrides')
      .then((status) => {
        lastRuntimeStatusCache = { ...lastRuntimeStatusCache, status };
        void publishAppStateUpdated();
        sendResponse(responseOk(peerPermissionStatesFromStatus(status)));
      })
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.RUNTIME_STATUS_UPDATED) {
    const runtime =
      message.runtime === 'cold' ||
      message.runtime === 'restoring' ||
      message.runtime === 'ready' ||
      message.runtime === 'degraded'
        ? message.runtime
        : 'cold';
    lastRuntimeStatusCache = {
      runtime,
      status: isRecord(message.status) ? (message.status as RuntimeStatusSummary) : null
    };
    void updateActivationLifecycle(
      runtime === 'ready'
        ? 'ready'
        : runtime === 'degraded'
          ? 'degraded'
          : runtime === 'restoring'
            ? 'restoring_runtime'
            : 'idle',
      'background',
      runtime
    ).catch(() => undefined);
    void publishAppStateUpdated();
    sendResponse(responseOk(true));
    return true;
  }

  if (message.type === MESSAGE_TYPE.START_ONBOARDING) {
    const input = isRecord(message.input) ? message.input : null;
    if (!input) {
      sendResponse(responseError(new Error('Invalid onboarding input')));
      return true;
    }
    void updateOnboardingLifecycle('decoding_package', 'background', {
      packageLength:
        typeof input.onboardPackage === 'string' ? input.onboardPackage.trim().length : 0
    })
      .catch(() => undefined)
      .then(() => publishAppStateUpdated().catch(() => undefined))
      .then(() =>
        callOffscreen<StoredExtensionProfile>('onboarding.connect', {
          input
        })
      )
      .then(async (profile) => {
        const normalized = await normalizeProfileInput(profile);
        await rejectDuplicateProfile(normalized);
        await mirrorProfileToExtensionStorage(normalized);
        lastRuntimeStatusCache = { runtime: 'cold', status: null };
        await publishAppStateUpdated();
        await ensureConfiguredRuntime('onboarding_complete');
        sendResponse(responseOk(normalized));
      })
      .catch(async (error) => {
        await updateOnboardingLifecycle(
          'failed',
          'background',
          {
            packageLength:
              typeof input.onboardPackage === 'string' ? input.onboardPackage.trim().length : 0
          },
          activationFailure(
            /timed out/i.test(toErrorMessage(error)) ? 'onboard_timeout' : 'onboard_rejected',
            toErrorMessage(error),
            'background'
          )
        ).catch(() => undefined);
        await publishAppStateUpdated().catch(() => undefined);
        sendResponse(responseError(error));
      });
    return true;
  }

  if (message.type === MESSAGE_TYPE.SAVE_PROFILE) {
    const profile = isRecord(message.profile) ? (message.profile as StoredExtensionProfile) : null;
    if (!profile) {
      sendResponse(responseError(new Error('Invalid profile payload')));
      return true;
    }
    void (async () => {
      const normalized = await normalizeProfileInput(profile);
      await mirrorProfileToExtensionStorage(normalized);
      await publishAppStateUpdated();
      return normalized;
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.CLEAR_PROFILE) {
    void (async () => {
      await callOffscreen('runtime.stop').catch(() => undefined);
      lastRuntimeStatusCache = { runtime: 'cold', status: null };
      await clearExtensionProfile();
      await publishAppStateUpdated();
      return true;
    })()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.UPDATE_RUNTIME_CONFIG) {
    void callOffscreen('runtime.update_config', {
      settings: isRecord(message.settings) ? message.settings : {}
    })
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.OPEN_DASHBOARD) {
    const openOptionsPage = chromeApi?.runtime?.openOptionsPage;
    if (!openOptionsPage) {
      sendResponse(responseError(new Error('Options page is unavailable')));
      return;
    }
    void openOptionsPage()
      .then(() => sendResponse(responseOk(true)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  if (message.type === MESSAGE_TYPE.RUNTIME_CONTROL) {
    if (message.action === 'ensureConfiguredRuntime') {
      void ensureConfiguredRuntime('runtime_control')
        .then(() => sendResponse(responseOk(true)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'stopRuntime') {
      void callOffscreen('runtime.stop')
        .then(() => {
          lastRuntimeStatusCache = { runtime: 'cold', status: null };
          return updateActivationLifecycle('idle', 'background', 'cold').catch(() => undefined);
        })
        .then(() => {
          void publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'wipeRuntime') {
      void callOffscreen('runtime.wipe_state')
        .then((result) => {
          if (
            isRecord(result) &&
            (result.runtime === 'cold' ||
              result.runtime === 'restoring' ||
              result.runtime === 'ready' ||
              result.runtime === 'degraded')
          ) {
            lastRuntimeStatusCache = {
              runtime: result.runtime,
              status: lastRuntimeStatusCache.status
            };
          }
          void publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'reloadConfiguredRuntime') {
      void reloadConfiguredRuntime('runtime_control')
        .then(() => sendResponse(responseOk(true)))
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'refreshAllPeers') {
      void callOffscreen('runtime.refresh_all_peers')
        .then(() => {
          void publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'closeOffscreen') {
      void closeOffscreenDocument()
        .then(async () => {
          await updateActivationLifecycle('idle', 'background', 'cold').catch(() => undefined);
          await publishAppStateUpdated();
          sendResponse(responseOk(true));
        })
        .catch((error) => sendResponse(responseError(error)));
      return true;
    }
    if (message.action === 'reloadExtension') {
      sendResponse(responseOk(true));
      setTimeout(() => {
        try {
          chromeApi?.runtime?.reload?.();
        } catch {
          // Ignore reload failures in test control flow.
        }
      }, 0);
      return;
    }
    sendResponse(responseError(new Error('Unsupported runtime control action')));
    return;
  }
});
