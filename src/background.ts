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
  type PromptResponseMessage,
  type ProviderMethod,
  type ProviderRequestEnvelope
} from '@/extension/protocol';
import {
  loadExtensionProfile,
  resolvePermissionDecision,
  savePermissionDecision
} from '@/extension/storage';

type PromptState = {
  request: ProviderRequestEnvelope;
  resolve: (allow: boolean) => void;
  windowId?: number;
};

type RuntimeStatusDetails = {
  device_id: string;
  pending_ops: number;
  last_active: number;
  known_peers: number;
  request_seq: number;
};

type RuntimePendingOperation = {
  op_type: string;
  request_id: string;
  started_at: number;
  timeout_at: number;
  target_peers: string[];
  threshold: number;
  collected_responses: unknown[];
  context: unknown;
};

type RuntimeSnapshotDetails = {
  bootstrap: unknown;
  state_hex: string;
  status: RuntimeStatusDetails;
  state: {
    version: number;
    last_active: number;
    request_seq: number;
    replay_cache_size: number;
    ecdh_cache_size: number;
    sig_cache_size: number;
    policies: Record<string, unknown>;
    remote_scoped_policies: Record<string, unknown>;
    pending_operations: Record<string, RuntimePendingOperation>;
    nonce_pool: {
      peers: Array<{
        idx: number;
        pubkey: string;
        incoming_available: number;
        outgoing_available: number;
        outgoing_spent: number;
        can_sign: boolean;
        should_send_nonces: boolean;
      }>;
    };
  };
};

type RuntimeSnapshotResult = {
  runtime: 'cold' | 'ready';
  status: RuntimeStatusDetails | null;
  snapshot: RuntimeSnapshotDetails | null;
  snapshotError: string | null;
  lifecycle?: {
    bootMode: 'cold_boot' | 'restored' | 'unknown';
    reason: string | null;
    updatedAt: number | null;
  };
};

const pendingPrompts = new Map<string, PromptState>();
const promptWindowMap = new Map<number, string>();
let creatingOffscreen: Promise<void> | null = null;
let offscreenCreatedWithoutContextApi = false;

function toErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return fallback;
}

function responseOk(result: unknown) {
  return { ok: true, result };
}

function responseError(error: unknown) {
  return { ok: false, error: toErrorMessage(error) };
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
  if (!chromeApi?.offscreen?.createDocument) return;
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
    await chromeApi.offscreen.closeDocument();
  } finally {
    offscreenCreatedWithoutContextApi = false;
    creatingOffscreen = null;
  }
}

async function callOffscreen<T>(rpcType: string, payload?: Record<string, unknown>) {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error('Extension runtime messaging is unavailable');
  }

  await ensureOffscreenDocument();

  const response = (await chromeApi.runtime.sendMessage({
    type: MESSAGE_TYPE.OFFSCREEN_RPC,
    rpcType,
    payload
  })) as { ok?: boolean; result?: T; error?: string } | undefined;

  if (!response?.ok) {
    throw new Error(response?.error || 'Offscreen document did not respond');
  }

  return response.result as T;
}

async function executeProviderMethod(request: ProviderRequestEnvelope) {
  const profile = await loadExtensionProfile();
  if (!profile) {
    throw new Error('Signer is not configured yet. Open the extension dashboard first.');
  }

  switch (request.type) {
    case MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY: {
      const decoded = await callOffscreen<{ publicKey: string }>('profile.decode', { profile });
      return decoded.publicKey;
    }
    case MESSAGE_TYPE.NOSTR_GET_RELAYS:
      return Object.fromEntries(
        profile.relays.map((relay) => [relay, { read: true, write: true }])
      );
    default:
      return await callOffscreen('nostr.execute', {
        profile,
        method: request.type,
        params: request.params ?? {}
      });
  }
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
    pendingPrompts.set(request.id, { request, resolve });
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
    throw new Error('User denied the request');
  }
  return await executeProviderMethod(request);
}

async function handlePromptResponse(message: PromptResponseMessage) {
  const chromeApi = getChromeApi();
  const pending = pendingPrompts.get(message.id);
  if (!pending) return;

  pendingPrompts.delete(message.id);
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
  }

  pending.resolve(message.allow);

  if (typeof pending.windowId === 'number' && chromeApi?.windows?.remove) {
    try {
      await chromeApi.windows.remove(pending.windowId);
    } catch {
      // Ignore user-closed prompt windows.
    }
  }
}

async function getStatusSnapshot() {
  const profile = await loadExtensionProfile();
  let runtimeDetails: RuntimeSnapshotResult = {
    runtime: 'cold',
    status: null,
    snapshot: null,
    snapshotError: null,
    lifecycle: {
      bootMode: 'unknown',
      reason: null,
      updatedAt: null
    }
  };

  try {
    runtimeDetails = await callOffscreen<RuntimeSnapshotResult>('runtime.snapshot');
  } catch {
    runtimeDetails = {
      runtime: 'cold',
      status: null,
      snapshot: null,
      snapshotError: null,
      lifecycle: {
        bootMode: 'unknown',
        reason: null,
        updatedAt: null
      }
    };
  }

  return {
    configured: !!profile,
    keysetName: profile?.keysetName ?? null,
    publicKey: profile?.groupPublicKey ?? null,
    relays: profile?.relays ?? [],
    runtime: runtimeDetails.runtime,
    pendingPrompts: pendingPrompts.size,
    runtimeDetails: {
      status: runtimeDetails.status,
      snapshot: runtimeDetails.snapshot,
      snapshotError: runtimeDetails.snapshotError,
      lifecycle: runtimeDetails.lifecycle ?? {
        bootMode: 'unknown',
        reason: null,
        updatedAt: null
      }
    }
  };
}

const chromeApi = getChromeApi();

chromeApi?.runtime?.onInstalled?.addListener((details) => {
  if (details.reason === 'install') {
    void chromeApi.runtime?.openOptionsPage?.();
  }
  void ensureOffscreenDocument();
});

chromeApi?.runtime?.onStartup?.addListener(() => {
  void ensureOffscreenDocument();
});

chromeApi?.windows?.onRemoved?.addListener((windowId) => {
  const requestId = promptWindowMap.get(windowId);
  if (!requestId) return;
  promptWindowMap.delete(windowId);
  const pending = pendingPrompts.get(requestId);
  if (!pending) return;
  pendingPrompts.delete(requestId);
  pending.resolve(false);
});

chromeApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (!isRecord(message) || typeof message.type !== 'string') return;

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
    if (message.action === 'closeOffscreen') {
      void closeOffscreenDocument()
        .then(() => sendResponse(responseOk(true)))
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
