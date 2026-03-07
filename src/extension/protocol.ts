export const EXTENSION_SOURCE = 'igloo-chrome';
export const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
export const PROMPT_DOCUMENT_PATH = 'prompt.html';
export const PROMPT_WIDTH = 448;
export const PROMPT_HEIGHT = 720;

export const MESSAGE_TYPE = {
  GET_STATUS: 'ext.getStatus',
  OPEN_DASHBOARD: 'ext.openDashboard',
  RUNTIME_CONTROL: 'ext.runtimeControl',
  PROVIDER_REQUEST: 'ext.providerRequest',
  PROMPT_RESPONSE: 'ext.promptResponse',
  OFFSCREEN_RPC: 'ext.offscreenRpc',
  NOSTR_GET_PUBLIC_KEY: 'nostr.getPublicKey',
  NOSTR_GET_RELAYS: 'nostr.getRelays',
  NOSTR_SIGN_EVENT: 'nostr.signEvent',
  NOSTR_NIP04_ENCRYPT: 'nostr.nip04.encrypt',
  NOSTR_NIP04_DECRYPT: 'nostr.nip04.decrypt',
  NOSTR_NIP44_ENCRYPT: 'nostr.nip44.encrypt',
  NOSTR_NIP44_DECRYPT: 'nostr.nip44.decrypt'
} as const;

export type ProviderMethod =
  | typeof MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY
  | typeof MESSAGE_TYPE.NOSTR_GET_RELAYS
  | typeof MESSAGE_TYPE.NOSTR_SIGN_EVENT
  | typeof MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT
  | typeof MESSAGE_TYPE.NOSTR_NIP04_DECRYPT
  | typeof MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT
  | typeof MESSAGE_TYPE.NOSTR_NIP44_DECRYPT;

export type PromptDecisionScope = 'once' | 'forever' | 'kind';

export type StoredExtensionProfile = {
  keysetName?: string;
  onboardPackage: string;
  relays: string[];
  groupPublicKey?: string;
  publicKey?: string;
  peerPubkey?: string;
};

export type StoredPeerPolicy = {
  pubkey: string;
  send: boolean;
  receive: boolean;
};

export type StoredPermissionPolicy = {
  host: string;
  type: ProviderMethod;
  allow: boolean;
  createdAt: number;
  kind?: number;
};

export type ProviderRequestEnvelope = {
  id: string;
  type: ProviderMethod;
  params?: Record<string, unknown>;
  host: string;
  origin?: string;
  href?: string;
};

export type PromptResponseMessage = {
  type: typeof MESSAGE_TYPE.PROMPT_RESPONSE;
  id: string;
  allow: boolean;
  scope: PromptDecisionScope;
  kind?: number;
};

export type RuntimeControlMessage = {
  type: typeof MESSAGE_TYPE.RUNTIME_CONTROL;
  action: 'closeOffscreen' | 'reloadExtension';
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isProviderMethod(value: unknown): value is ProviderMethod {
  return (
    value === MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY ||
    value === MESSAGE_TYPE.NOSTR_GET_RELAYS ||
    value === MESSAGE_TYPE.NOSTR_SIGN_EVENT ||
    value === MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT ||
    value === MESSAGE_TYPE.NOSTR_NIP04_DECRYPT ||
    value === MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT ||
    value === MESSAGE_TYPE.NOSTR_NIP44_DECRYPT
  );
}

export function getPermissionLabel(type: ProviderMethod) {
  switch (type) {
    case MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY:
      return 'read your public key';
    case MESSAGE_TYPE.NOSTR_GET_RELAYS:
      return 'read your relay list';
    case MESSAGE_TYPE.NOSTR_SIGN_EVENT:
      return 'sign a Nostr event';
    case MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT:
      return 'encrypt a NIP-04 message';
    case MESSAGE_TYPE.NOSTR_NIP04_DECRYPT:
      return 'decrypt a NIP-04 message';
    case MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT:
      return 'encrypt a NIP-44 message';
    case MESSAGE_TYPE.NOSTR_NIP44_DECRYPT:
      return 'decrypt a NIP-44 message';
  }
}

export function extractEventKind(params: unknown): number | undefined {
  if (!isRecord(params)) return undefined;
  const event = params.event;
  if (!isRecord(event)) return undefined;
  const kind = event.kind;
  return typeof kind === 'number' ? kind : undefined;
}
