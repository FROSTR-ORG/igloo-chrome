import { describe, expect, test, vi } from 'vitest';

import { PROVIDER_METHOD } from '@/extension/protocol';

// The reject arms validate params before touching the WASM bridge, so stub it out
// — importing the real `@/lib/igloo` would pull in the configured signer runtime.
vi.mock('@/lib/igloo', () => ({
  prepareSignOnNode: vi.fn(),
  prepareEcdhOnNode: vi.fn(),
  signNostrEvent: vi.fn(),
  nip44EncryptWithNode: vi.fn(),
  nip44DecryptWithNode: vi.fn(),
}));

import { executeProviderMethodOnSession } from '@/lib/runtime-host/provider-execution';

const session = {} as never;

describe('executeProviderMethodOnSession input validation', () => {
  test('signEvent without an event payload rejects', async () => {
    await expect(
      executeProviderMethodOnSession({ session, method: PROVIDER_METHOD.SIGN_EVENT, params: {} }),
    ).rejects.toThrow('signEvent requires an event payload');
  });

  test('nip44.encrypt without pubkey + plaintext rejects', async () => {
    await expect(
      executeProviderMethodOnSession({
        session,
        method: PROVIDER_METHOD.NIP44_ENCRYPT,
        params: { pubkey: 'abc' },
      }),
    ).rejects.toThrow('nip44.encrypt requires pubkey and plaintext');
  });

  test('nip44.decrypt without pubkey + ciphertext rejects', async () => {
    await expect(
      executeProviderMethodOnSession({
        session,
        method: PROVIDER_METHOD.NIP44_DECRYPT,
        params: { pubkey: 'abc' },
      }),
    ).rejects.toThrow('nip44.decrypt requires pubkey and ciphertext');
  });

  test('an unsupported method rejects', async () => {
    await expect(
      executeProviderMethodOnSession({ session, method: 'bogus' as never, params: {} }),
    ).rejects.toThrow('Unsupported runtime method');
  });
});
