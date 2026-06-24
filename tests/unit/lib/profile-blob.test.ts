import { describe, expect, test } from 'vitest';

import {
  decryptLocalProfileBlobWithPassword,
  decryptLocalProfileBlobWithSessionKey,
  encryptLocalProfileBlobPayload,
  type LocalEncryptedProfileBlob,
  type LocalProfileBlobPayload,
} from '@/lib/profile-blob';

// The cipher round-trips an arbitrary JSON payload, so the exact profile schema is
// irrelevant here — a representative fixture (cast) keeps this crypto test decoupled
// from the profile-package shape.
const PAYLOAD = {
  version: 1,
  profile: {
    profileId: 'profile-under-test',
    version: 1,
    device: {
      name: 'Test Device',
      shareSecret: '11'.repeat(32),
      manualPeerPolicyOverrides: [],
      relays: ['ws://127.0.0.1:8194'],
    },
    groupPackage: { note: 'opaque to the cipher test' },
  },
  signerSettings: { sign_timeout_secs: 30, ping_timeout_secs: 15, request_ttl_secs: 300 },
  runtimeSnapshotJson: null,
  peerPubkey: null,
} as unknown as LocalProfileBlobPayload;

const PASSWORD = 'correct horse battery staple';

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return globalThis.btoa(binary);
}

describe('profile-blob local at-rest cipher', () => {
  test('encrypt -> decrypt round-trips with the password and returns a non-extractable session key', async () => {
    const { blob, sessionKey } = await encryptLocalProfileBlobPayload(PAYLOAD, PASSWORD);
    expect(sessionKey).toBeInstanceOf(CryptoKey);
    expect(sessionKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', sessionKey)).rejects.toThrow();
    const { payload } = await decryptLocalProfileBlobWithPassword(blob, PASSWORD);
    expect(payload).toEqual(PAYLOAD);
  });

  test('the derived session key decrypts the same blob (no second PBKDF2)', async () => {
    const { blob, sessionKey } = await encryptLocalProfileBlobPayload(PAYLOAD, PASSWORD);
    const payload = await decryptLocalProfileBlobWithSessionKey(blob, sessionKey);
    expect(payload).toEqual(PAYLOAD);
  });

  test('pins the KDF/cipher parameters (PBKDF2-SHA-256 x200000, 12-byte AES-GCM IV)', async () => {
    const { blob } = await encryptLocalProfileBlobPayload(PAYLOAD, PASSWORD);
    expect(blob.version).toBe(1);
    expect(blob.kdf.iterations).toBe(200_000);
    expect(blob.kdf.hash).toBe('SHA-256');
    expect(base64ToBytes(blob.cipher.ivB64).length).toBe(12);
  });

  test('KAT: an independent PBKDF2-SHA-256 + AES-GCM path recovers the plaintext', async () => {
    // Decrypt a profile-blob-produced blob using raw WebCrypto with the blob's own
    // recorded params. If the cipher/KDF drifted from a standard construction this
    // independent path would fail to recover the plaintext.
    const { blob } = await encryptLocalProfileBlobPayload(PAYLOAD, PASSWORD);
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(PASSWORD),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: blob.kdf.hash,
        salt: base64ToBytes(blob.kdf.saltB64),
        iterations: blob.kdf.iterations,
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(blob.cipher.ivB64) },
      key,
      base64ToBytes(blob.cipher.ciphertextB64),
    );
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(PAYLOAD);
  });

  test('rejects a wrong password', async () => {
    const { blob } = await encryptLocalProfileBlobPayload(PAYLOAD, PASSWORD);
    await expect(decryptLocalProfileBlobWithPassword(blob, 'wrong-password')).rejects.toThrow();
  });

  test('rejects a single-bit-flipped ciphertext (GCM tag failure)', async () => {
    const { blob } = await encryptLocalProfileBlobPayload(PAYLOAD, PASSWORD);
    const bytes = base64ToBytes(blob.cipher.ciphertextB64);
    bytes[bytes.length - 1] ^= 0x01;
    const tampered: LocalEncryptedProfileBlob = {
      ...blob,
      cipher: { ...blob.cipher, ciphertextB64: bytesToBase64(bytes) },
    };
    await expect(decryptLocalProfileBlobWithPassword(tampered, PASSWORD)).rejects.toThrow();
  });

  test('rejects a wrong session key', async () => {
    const { blob } = await encryptLocalProfileBlobPayload(PAYLOAD, PASSWORD);
    const wrongKey = await crypto.subtle.importKey(
      'raw',
      crypto.getRandomValues(new Uint8Array(32)),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    await expect(decryptLocalProfileBlobWithSessionKey(blob, wrongKey)).rejects.toThrow();
  });
});
