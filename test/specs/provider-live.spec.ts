import { test, expect, TEST_PEER_PUBLIC_KEY, TEST_PUBLIC_KEY } from '../fixtures/extension';
import { verifyEvent } from 'nostr-tools/pure';

const SIGN_EVENT_PAYLOAD = {
  kind: 1,
  created_at: 1_700_000_000,
  tags: [],
  content: 'playwright live signEvent'
};

async function approvePromptOnce(prompt: import('@playwright/test').Page) {
  await prompt.waitForLoadState('domcontentloaded');
  await prompt
    .getByRole('button', { name: 'Allow once' })
    .evaluate((button: HTMLButtonElement) => button.click())
    .catch(() => {
      // The background closes the prompt as part of successful approval.
    });
}

test.describe('provider bridge live signer', () => {
  test.setTimeout(180_000);

  test('responder returns nonce material only on the first manual onboard request', async ({
    liveSigner
  }) => {
    const firstCount = await liveSigner.requestOnboardNonceCount();
    const secondCount = await liveSigner.requestOnboardNonceCount();

    expect(firstCount).toBeGreaterThan(0);
    expect(secondCount).toBe(0);
  });

  test('runtime snapshot reports nonce pool state once peers are hydrated', async ({
    callOffscreenRpc,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);

    await expect(
      callOffscreenRpc('runtime.ensure', {
        profile: liveSigner.profile
      })
    ).resolves.toEqual({
      runtime: 'ready'
    });

    await expect(
      callOffscreenRpc<{
        runtime: 'cold' | 'ready';
        status: {
          pending_ops: number;
          request_seq: number;
        } | null;
        snapshot: unknown;
        snapshotError: string | null;
      }>('runtime.snapshot')
    ).resolves.toMatchObject({
      runtime: 'ready',
      snapshotError: null,
      status: {
        pending_ops: 0
      },
      snapshot: {
        state: {
          nonce_pool: {
            peers: [
              {
                pubkey: TEST_PEER_PUBLIC_KEY,
                incoming_available: expect.any(Number),
                outgoing_available: expect.any(Number)
              }
            ]
          }
        }
      }
    });
  });

  test('getPublicKey always returns the group public key', async ({
    context,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile({
      ...liveSigner.profile,
      publicKey: TEST_PEER_PUBLIC_KEY
    });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(() => window.nostr!.getPublicKey());

    const prompt = await promptPromise;
    await expect(prompt.getByText('wants to read your public key')).toBeVisible();
    await approvePromptOnce(prompt);

    await expect(resultPromise).resolves.toBe(TEST_PUBLIC_KEY);

    await page.close();
  });

  test('signEvent succeeds against a live responder after bootstrap hydration', async ({
    callOffscreenRpc,
    context,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(async (event) => {
      try {
        return { ok: true, event: await window.nostr!.signEvent(event), message: null };
      } catch (error) {
        return {
          ok: false,
          event: null,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }, SIGN_EVENT_PAYLOAD);

    const prompt = await promptPromise;
    await expect(prompt.getByText('wants to sign a Nostr event')).toBeVisible();
    await approvePromptOnce(prompt);

    const result = await resultPromise;
    if (!result.ok) {
      const diagnostics = await callOffscreenRpc<{
        runtime: 'cold' | 'ready';
        diagnostics: Array<Record<string, unknown>>;
      }>('runtime.diagnostics');
      throw new Error(
        `signEvent failed: ${result.message}\n${JSON.stringify(diagnostics.diagnostics.slice(-8), null, 2)}`
      );
    }
    expect(result.ok).toBe(true);
    expect(result.message).toBeNull();
    expect(result.event).toMatchObject({
      kind: SIGN_EVENT_PAYLOAD.kind,
      content: SIGN_EVENT_PAYLOAD.content,
      created_at: SIGN_EVENT_PAYLOAD.created_at,
      pubkey: liveSigner.profile.publicKey
    });
    expect(result.event?.tags).toEqual(SIGN_EVENT_PAYLOAD.tags);
    expect(typeof result.event?.id).toBe('string');
    expect(typeof result.event?.sig).toBe('string');
    expect(verifyEvent(result.event!)).toBe(true);

    await page.close();
  });

  test('signEvent fails cleanly when the live responder disappears mid-session', async ({
    callOffscreenRpc,
    context,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);
    await callOffscreenRpc('runtime.ensure', {
      profile: liveSigner.profile
    });
    await liveSigner.stopResponder();

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(async (event) => {
      try {
        await window.nostr!.signEvent(event);
        return { ok: true, message: null };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }, SIGN_EVENT_PAYLOAD);

    const prompt = await promptPromise;
    await expect(prompt.getByText('wants to sign a Nostr event')).toBeVisible();
    await approvePromptOnce(prompt);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      message: 'locked peer response timeout'
    });

    await page.close();
  });

  test('nip44 encrypt fails cleanly when the relay disconnects mid-session', async ({
    callOffscreenRpc,
    context,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);
    await callOffscreenRpc('runtime.ensure', {
      profile: liveSigner.profile
    });
    await liveSigner.stopRelay();

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(async ({ pubkey, value }) => {
      try {
        await window.nostr!.nip44.encrypt(pubkey, value);
        return { ok: true, message: null };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }, {
      pubkey: TEST_PEER_PUBLIC_KEY,
      value: 'playwright live nip44 relay disconnect'
    });

    const prompt = await promptPromise;
    await expect(prompt.getByText('wants to encrypt a NIP-44 message')).toBeVisible();
    await approvePromptOnce(prompt);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      message: 'locked peer response timeout'
    });

    await page.close();
  });

  test('nip44 encrypt and decrypt succeed against a live responder', async ({
    context,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const plaintext = 'playwright live nip44 message';

    const encryptPromptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const encryptResultPromise = page.evaluate(
      async ({ pubkey, value }) => await window.nostr!.nip44.encrypt(pubkey, value),
      {
        pubkey: TEST_PEER_PUBLIC_KEY,
        value: plaintext
      }
    );

    const encryptPrompt = await encryptPromptPromise;
    await expect(encryptPrompt.getByText('wants to encrypt a NIP-44 message')).toBeVisible();
    await approvePromptOnce(encryptPrompt);

    const ciphertext = await encryptResultPromise;
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.length).toBeGreaterThan(32);

    const decryptPromptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const decryptResultPromise = page.evaluate(
      async ({ pubkey, value }) => await window.nostr!.nip44.decrypt(pubkey, value),
      {
        pubkey: TEST_PEER_PUBLIC_KEY,
        value: ciphertext
      }
    );

    const decryptPrompt = await decryptPromptPromise;
    await expect(decryptPrompt.getByText('wants to decrypt a NIP-44 message')).toBeVisible();
    await approvePromptOnce(decryptPrompt);

    await expect(decryptResultPromise).resolves.toBe(plaintext);

    await page.close();
  });
});
