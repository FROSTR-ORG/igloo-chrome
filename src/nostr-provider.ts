import { EXTENSION_SOURCE, MESSAGE_TYPE } from '@/extension/protocol';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>;
      getRelays: () => Promise<Record<string, { read: boolean; write: boolean }>>;
      signEvent: (event: Record<string, unknown>) => Promise<unknown>;
      nip04: {
        encrypt: (pubkey: string, plaintext: string) => Promise<string>;
        decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
      };
      nip44: {
        encrypt: (pubkey: string, plaintext: string) => Promise<string>;
        decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
      };
    };
  }
}

const pending = new Map<string, PendingRequest>();

function request(type: string, params: Record<string, unknown>) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return awaitable(id, type, params);
}

function awaitable(id: string, type: string, params: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.postMessage(
      {
        source: EXTENSION_SOURCE,
        direction: 'provider_request',
        id,
        type,
        params
      },
      '*'
    );
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as
    | {
        source?: string;
        direction?: string;
        id?: string;
        ok?: boolean;
        result?: unknown;
        error?: { message?: string };
      }
    | undefined;

  if (!data || data.source !== EXTENSION_SOURCE || data.direction !== 'provider_response') return;
  if (!data.id) return;
  const entry = pending.get(data.id);
  if (!entry) return;

  pending.delete(data.id);
  if (data.ok) {
    entry.resolve(data.result);
    return;
  }

  entry.reject(new Error(data.error?.message || 'Igloo extension request failed'));
});

window.nostr = {
  async getPublicKey() {
    const result = await request(MESSAGE_TYPE.NOSTR_GET_PUBLIC_KEY, {});
    if (typeof result !== 'string') {
      throw new Error('Invalid public key response');
    }
    return result;
  },
  async getRelays() {
    const result = await request(MESSAGE_TYPE.NOSTR_GET_RELAYS, {});
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid relay response');
    }
    return result as Record<string, { read: boolean; write: boolean }>;
  },
  async signEvent(event: Record<string, unknown>) {
    return await request(MESSAGE_TYPE.NOSTR_SIGN_EVENT, { event });
  },
  nip04: {
    async encrypt(pubkey: string, plaintext: string) {
      const result = await request(MESSAGE_TYPE.NOSTR_NIP04_ENCRYPT, { pubkey, plaintext });
      if (typeof result !== 'string') {
        throw new Error('Invalid encryption response');
      }
      return result;
    },
    async decrypt(pubkey: string, ciphertext: string) {
      const result = await request(MESSAGE_TYPE.NOSTR_NIP04_DECRYPT, { pubkey, ciphertext });
      if (typeof result !== 'string') {
        throw new Error('Invalid decryption response');
      }
      return result;
    }
  },
  nip44: {
    async encrypt(pubkey: string, plaintext: string) {
      const result = await request(MESSAGE_TYPE.NOSTR_NIP44_ENCRYPT, { pubkey, plaintext });
      if (typeof result !== 'string') {
        throw new Error('Invalid encryption response');
      }
      return result;
    },
    async decrypt(pubkey: string, ciphertext: string) {
      const result = await request(MESSAGE_TYPE.NOSTR_NIP44_DECRYPT, { pubkey, ciphertext });
      if (typeof result !== 'string') {
        throw new Error('Invalid decryption response');
      }
      return result;
    }
  }
};
