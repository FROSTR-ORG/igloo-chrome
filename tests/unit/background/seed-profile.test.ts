import { describe, expect, test } from 'vitest';

import { buildSeedProfile } from '../../../../../test/igloo-chrome/fixtures/helpers/seed-profile';
import { createSeededProfileRecord } from '../../../../../test/igloo-chrome/fixtures/helpers/seed-crypto';

describe('seed profile helpers', () => {
  test('builds a seeded profile payload with defaults and overrides', () => {
    const seed = buildSeedProfile({
      groupName: 'Live Seed',
      relays: ['ws://relay'],
      publicKey: 'pubkey-1',
      groupPublicKey: 'group-pubkey-1',
      peerPubkey: 'peer-1',
      runtimeSnapshotJson: '{"nonce":"ready"}',
    });

    expect(seed.label).toBe('Live Seed');
    expect(seed.payload.profile.device.name).toBe('Live Seed');
    expect(seed.payload.profile.device.relays).toEqual(['ws://relay']);
    expect(seed.payload.runtimeSnapshotJson).toBe('{"nonce":"ready"}');
    expect(seed.payload.peerPubkey).toBe('peer-1');
  });

  test('encrypts a seeded profile into the current v3 storage shape', async () => {
    const record = await createSeededProfileRecord({
      ...buildSeedProfile({
        groupName: 'Encrypted Seed',
        relays: ['ws://relay'],
        publicKey: 'pubkey-2',
        groupPublicKey: 'group-pubkey-2',
      }),
      now: 123,
    });

    expect(record.storedBlobRecord).toEqual({
      id: expect.any(String),
      label: 'Encrypted Seed',
      blob: {
        version: 1,
        kdf: expect.objectContaining({
          iterations: 200000,
          hash: 'SHA-256',
          saltB64: expect.any(String),
        }),
        cipher: expect.objectContaining({
          ivB64: expect.any(String),
          ciphertextB64: expect.any(String),
        }),
      },
      createdAt: 123,
      updatedAt: 123,
    });
    expect(record).not.toHaveProperty('sessionKey');
  });
});
