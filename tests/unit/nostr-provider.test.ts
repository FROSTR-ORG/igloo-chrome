import { beforeEach, describe, expect, test, vi } from 'vitest';

import { EXTENSION_SOURCE, PROVIDER_METHOD } from '@/extension/protocol';

describe('nostr provider bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.nostr;
  });

  test('posts a request and resolves a valid getPublicKey response', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    await import('@/nostr-provider');

    const pending = window.nostr!.getPublicKey();

    expect(postMessage).toHaveBeenCalledOnce();
    const payload = postMessage.mock.calls.at(-1)?.[0] as { id: string; type: string };
    expect(payload.type).toBe(PROVIDER_METHOD.GET_PUBLIC_KEY);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          source: EXTENSION_SOURCE,
          direction: 'provider_response',
          id: payload.id,
          ok: true,
          result: 'pubkey-123'
        }
      })
    );

    await expect(pending).resolves.toBe('pubkey-123');
  });

  test('rejects when the extension responds with an error', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    await import('@/nostr-provider');

    const pending = window.nostr!.getPublicKey();
    const payload = postMessage.mock.calls.at(-1)?.[0] as { id: string };

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          source: EXTENSION_SOURCE,
          direction: 'provider_response',
          id: payload.id,
          ok: false,
          error: { message: 'User denied the request' }
        }
      })
    );

    await expect(pending).rejects.toThrow('User denied the request');
  });

  test('rejects invalid relay responses from the extension', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    await import('@/nostr-provider');

    const pending = window.nostr!.getRelays();
    const payload = postMessage.mock.calls.at(-1)?.[0] as { id: string };

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          source: EXTENSION_SOURCE,
          direction: 'provider_response',
          id: payload.id,
          ok: true,
          result: 'not-an-object'
        }
      })
    );

    await expect(pending).rejects.toThrow('Invalid relay response');
  });

  test('ignores a provider_response from a foreign origin (no cross-origin forgery)', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    await import('@/nostr-provider');

    const pending = window.nostr!.getPublicKey();
    const payload = postMessage.mock.calls.at(-1)?.[0] as { id: string };

    // A cross-origin frame forges a (correctly-shaped) response — must be dropped
    // by the origin check, leaving the request unresolved.
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: 'https://evil.example',
        data: {
          source: EXTENSION_SOURCE,
          direction: 'provider_response',
          id: payload.id,
          ok: true,
          result: 'forged-pubkey'
        }
      })
    );

    const settled = await Promise.race([
      pending.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20))
    ]);
    expect(settled).toBe('pending');
  });
});
