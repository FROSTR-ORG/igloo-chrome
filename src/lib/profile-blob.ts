import type { BrowserProfilePackagePayload } from 'igloo-shared';

import type { SignerSettings } from '@/lib/signer-settings';

export type LocalEncryptedProfileBlob = {
  version: 1;
  kdf: {
    saltB64: string;
    iterations: number;
    hash: 'SHA-256';
  };
  cipher: {
    ivB64: string;
    ciphertextB64: string;
  };
};

export type LocalProfileBlobRecord = {
  id: string;
  label: string;
  blob: LocalEncryptedProfileBlob;
  createdAt: number;
  updatedAt: number;
};

export type LocalProfileBlobPayload = {
  version: 1;
  profile: BrowserProfilePackagePayload;
  signerSettings: SignerSettings;
  runtimeSnapshotJson?: string | null;
  peerPubkey?: string | null;
};

const PBKDF2_ITERATIONS = 200_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return globalThis.btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function utf8ToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToUtf8(value: Uint8Array) {
  return new TextDecoder().decode(value);
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBufferSource(bytes: Uint8Array) {
  return bytes as unknown as BufferSource;
}

async function importPasswordKey(password: string) {
  return await crypto.subtle.importKey('raw', utf8ToBytes(password), 'PBKDF2', false, ['deriveKey']);
}

async function deriveAesKey(password: string, salt: Uint8Array) {
  const baseKey = await importPasswordKey(password);
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toBufferSource(salt),
      iterations: PBKDF2_ITERATIONS
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
}

async function importSessionKey(keyB64: string) {
  return await crypto.subtle.importKey(
    'raw',
    base64ToBytes(keyB64),
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

async function exportSessionKey(key: CryptoKey) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

async function encryptWithKey(
  payload: LocalProfileBlobPayload,
  key: CryptoKey,
  saltB64: string
): Promise<LocalEncryptedProfileBlob> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    utf8ToBytes(JSON.stringify(payload))
  );
  return {
    version: 1,
    kdf: {
      saltB64,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    cipher: {
      ivB64: bytesToBase64(iv),
      ciphertextB64: bytesToBase64(new Uint8Array(ciphertext))
    }
  };
}

async function decryptWithKey(blob: LocalEncryptedProfileBlob, key: CryptoKey) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(blob.cipher.ivB64)
    },
    key,
    base64ToBytes(blob.cipher.ciphertextB64)
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plaintext))) as LocalProfileBlobPayload;
}

export async function encryptLocalProfileBlobPayload(
  payload: LocalProfileBlobPayload,
  password: string
) {
  const salt = randomBytes(16);
  const key = await deriveAesKey(password, salt);
  return {
    blob: await encryptWithKey(payload, key, bytesToBase64(salt)),
    sessionKeyB64: await exportSessionKey(key)
  };
}

export async function decryptLocalProfileBlobWithPassword(
  blob: LocalEncryptedProfileBlob,
  password: string
) {
  const key = await deriveAesKey(password, base64ToBytes(blob.kdf.saltB64));
  const payload = await decryptWithKey(blob, key);
  return {
    payload,
    sessionKeyB64: await exportSessionKey(key)
  };
}

export async function decryptLocalProfileBlobWithSessionKey(
  blob: LocalEncryptedProfileBlob,
  sessionKeyB64: string
) {
  return await decryptWithKey(blob, await importSessionKey(sessionKeyB64));
}

export async function reencryptLocalProfileBlobWithSessionKey(
  payload: LocalProfileBlobPayload,
  sessionKeyB64: string,
  existingBlob: LocalEncryptedProfileBlob
) {
  const key = await importSessionKey(sessionKeyB64);
  return await encryptWithKey(payload, key, existingBlob.kdf.saltB64);
}
