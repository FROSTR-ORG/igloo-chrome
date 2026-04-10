export const EXTENSION_SOURCE = 'igloo-chrome';
export const PROMPT_DOCUMENT_PATH = 'prompt.html';
export const PROMPT_WIDTH = 448;
export const PROMPT_HEIGHT = 720;

export const PROVIDER_METHOD = {
  GET_PUBLIC_KEY: 'nostr.getPublicKey',
  GET_RELAYS: 'nostr.getRelays',
  SIGN_EVENT: 'nostr.signEvent',
  NIP04_ENCRYPT: 'nostr.nip04.encrypt',
  NIP04_DECRYPT: 'nostr.nip04.decrypt',
  NIP44_ENCRYPT: 'nostr.nip44.encrypt',
  NIP44_DECRYPT: 'nostr.nip44.decrypt',
} as const;

export type ProviderMethod =
  | typeof PROVIDER_METHOD.GET_PUBLIC_KEY
  | typeof PROVIDER_METHOD.GET_RELAYS
  | typeof PROVIDER_METHOD.SIGN_EVENT
  | typeof PROVIDER_METHOD.NIP04_ENCRYPT
  | typeof PROVIDER_METHOD.NIP04_DECRYPT
  | typeof PROVIDER_METHOD.NIP44_ENCRYPT
  | typeof PROVIDER_METHOD.NIP44_DECRYPT;

export type ProviderRequestEnvelope = {
  id: string;
  type: ProviderMethod;
  params?: Record<string, unknown>;
  host: string;
  origin?: string;
  href?: string;
};

export type StoredPermissionPolicy = {
  host: string;
  type: ProviderMethod;
  allow: boolean;
  createdAt: number;
  kind?: number;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isProviderMethod(value: unknown): value is ProviderMethod {
  return (
    value === PROVIDER_METHOD.GET_PUBLIC_KEY ||
    value === PROVIDER_METHOD.GET_RELAYS ||
    value === PROVIDER_METHOD.SIGN_EVENT ||
    value === PROVIDER_METHOD.NIP04_ENCRYPT ||
    value === PROVIDER_METHOD.NIP04_DECRYPT ||
    value === PROVIDER_METHOD.NIP44_ENCRYPT ||
    value === PROVIDER_METHOD.NIP44_DECRYPT
  );
}

export function getPermissionLabel(type: ProviderMethod) {
  switch (type) {
    case PROVIDER_METHOD.GET_PUBLIC_KEY:
      return 'read your public key';
    case PROVIDER_METHOD.GET_RELAYS:
      return 'read your relay list';
    case PROVIDER_METHOD.SIGN_EVENT:
      return 'sign a Nostr event';
    case PROVIDER_METHOD.NIP04_ENCRYPT:
      return 'encrypt a NIP-04 message';
    case PROVIDER_METHOD.NIP04_DECRYPT:
      return 'decrypt a NIP-04 message';
    case PROVIDER_METHOD.NIP44_ENCRYPT:
      return 'encrypt a NIP-44 message';
    case PROVIDER_METHOD.NIP44_DECRYPT:
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
