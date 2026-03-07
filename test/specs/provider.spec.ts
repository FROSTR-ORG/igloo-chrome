import { test, expect, TEST_PUBLIC_KEY } from '../fixtures/extension';

const SIGN_EVENT_PAYLOAD = {
  id: 'smoke-event',
  kind: 1,
  pubkey: TEST_PUBLIC_KEY,
  created_at: 1_700_000_000,
  tags: [],
  content: 'playwright signEvent smoke'
};

const TEST_COUNTERPARTY_PUBKEY =
  '006008c941d6176a375c72cd08e16502a6a723b4b8b2909b8d7f63807a77c5b6';

const SIGN_EVENT_RUNTIME_ERRORS = [
  'Failed during onboard request: Relay subscription closed before onboard response: websocket error',
  'Failed during onboard request: Onboard response timed out (request_id='
];

const NIP44_RUNTIME_ERRORS = [
  'Failed during onboard request: Relay subscription closed before onboard response: websocket error',
  'Failed during onboard request: Onboard response timed out (request_id='
];

test.describe('provider bridge smoke', () => {
  test('injects window.nostr and resolves getPublicKey after approval', async ({
    context,
    server,
    seedProfile
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    await expect.poll(async () => {
      return await page.evaluate(() => ({
        hasNostr: typeof window.nostr === 'object',
        hasGetPublicKey: typeof window.nostr?.getPublicKey === 'function',
        hasSignEvent: typeof window.nostr?.signEvent === 'function',
        hasNip44Encrypt: typeof window.nostr?.nip44?.encrypt === 'function'
      }));
    }).toEqual({
      hasNostr: true,
      hasGetPublicKey: true,
      hasSignEvent: true,
      hasNip44Encrypt: true
    });

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(() => window.nostr!.getPublicKey());

    const prompt = await promptPromise;
    await prompt.waitForLoadState('domcontentloaded');
    await expect(prompt.getByText('wants to read your public key')).toBeVisible();
    await prompt
      .getByRole('button', { name: 'Allow once' })
      .evaluate((button: HTMLButtonElement) => button.click())
      .catch(() => {
        // The background closes the prompt as part of successful approval.
      });

    const publicKey = await resultPromise;
    expect(publicKey).toBe(TEST_PUBLIC_KEY);

    await page.close();
  });

  test('rejects getPublicKey when the prompt is denied', async ({ context, server, seedProfile }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(async () => {
      try {
        await window.nostr!.getPublicKey();
        return { ok: true, message: null };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const prompt = await promptPromise;
    await prompt.waitForLoadState('domcontentloaded');
    await expect(prompt.getByText('wants to read your public key')).toBeVisible();
    await prompt
      .getByRole('button', { name: 'Deny' })
      .evaluate((button: HTMLButtonElement) => button.click())
      .catch(() => {
        // The background closes the prompt as part of request completion.
      });

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      message: 'User denied the request'
    });

    await page.close();
  });

  test('reuses persisted method approval without opening a second prompt', async ({
    context,
    server,
    seedProfile
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const firstPromptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const firstResultPromise = page.evaluate(() => window.nostr!.getPublicKey());

    const firstPrompt = await firstPromptPromise;
    await firstPrompt.waitForLoadState('domcontentloaded');
    await firstPrompt
      .getByRole('button', { name: 'Always allow this method' })
      .evaluate((button: HTMLButtonElement) => button.click())
      .catch(() => {
        // The background closes the prompt as part of successful approval.
      });

    await expect(firstResultPromise).resolves.toBe(TEST_PUBLIC_KEY);

    let promptOpened = false;
    const handlePage = () => {
      promptOpened = true;
    };
    context.on('page', handlePage);

    const secondPublicKey = await page.evaluate(() => window.nostr!.getPublicKey());
    expect(secondPublicKey).toBe(TEST_PUBLIC_KEY);

    await page.waitForTimeout(300);
    context.off('page', handlePage);
    expect(promptOpened).toBe(false);

    await page.close();
  });

  test('resolves getRelays after approval', async ({ context, server, seedProfile }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(() => window.nostr!.getRelays());

    const prompt = await promptPromise;
    await prompt.waitForLoadState('domcontentloaded');
    await expect(prompt.getByText('wants to read your relay list')).toBeVisible();
    await prompt
      .getByRole('button', { name: 'Allow once' })
      .evaluate((button: HTMLButtonElement) => button.click())
      .catch(() => {
        // The background closes the prompt as part of successful approval.
      });

    await expect(resultPromise).resolves.toEqual({
      'ws://127.0.0.1:8194': {
        read: true,
        write: true
      }
    });

    await page.close();
  });

  test('uses kind-scoped signEvent approval and then fails cleanly without a live responder', async ({
    context,
    server,
    seedProfile
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const firstPromptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const firstResultPromise = page.evaluate(async (event) => {
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

    const firstPrompt = await firstPromptPromise;
    await firstPrompt.waitForLoadState('domcontentloaded');
    await expect(firstPrompt.getByText('wants to sign a Nostr event')).toBeVisible();
    await expect(firstPrompt.getByRole('button', { name: 'Always allow kind 1' })).toBeVisible();
    await firstPrompt
      .getByRole('button', { name: 'Always allow kind 1' })
      .evaluate((button: HTMLButtonElement) => button.click())
      .catch(() => {
        // The background closes the prompt as part of request completion.
      });

    const firstResult = await firstResultPromise;
    expect(firstResult.ok).toBe(false);
    expect(
      SIGN_EVENT_RUNTIME_ERRORS.some((entry) => firstResult.message.includes(entry))
    ).toBe(true);

    let promptOpened = false;
    const handlePage = () => {
      promptOpened = true;
    };
    context.on('page', handlePage);

    const secondResult = await page.evaluate(async (event) => {
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

    await page.waitForTimeout(300);
    context.off('page', handlePage);

    expect(promptOpened).toBe(false);
    expect(secondResult).toEqual(firstResult);

    await page.close();
  });

  test('reuses persisted NIP-44 encrypt approval without a live responder', async ({
    context,
    server,
    seedProfile
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const firstPromptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const firstResultPromise = page.evaluate(async ({ pubkey, plaintext }) => {
      try {
        await window.nostr!.nip44.encrypt(pubkey, plaintext);
        return { ok: true, message: null };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }, {
      pubkey: TEST_COUNTERPARTY_PUBKEY,
      plaintext: 'playwright nip44 encrypt smoke'
    });

    const firstPrompt = await firstPromptPromise;
    await firstPrompt.waitForLoadState('domcontentloaded');
    await expect(firstPrompt.getByText('wants to encrypt a NIP-44 message')).toBeVisible();
    await firstPrompt
      .getByRole('button', { name: 'Always allow this method' })
      .evaluate((button: HTMLButtonElement) => button.click())
      .catch(() => {
        // The background closes the prompt as part of request completion.
      });

    const firstResult = await firstResultPromise;
    expect(firstResult.ok).toBe(false);
    expect(
      NIP44_RUNTIME_ERRORS.some((entry) => firstResult.message.includes(entry))
    ).toBe(true);

    let promptOpened = false;
    const handlePage = () => {
      promptOpened = true;
    };
    context.on('page', handlePage);

    const secondResult = await page.evaluate(async ({ pubkey, plaintext }) => {
      try {
        await window.nostr!.nip44.encrypt(pubkey, plaintext);
        return { ok: true, message: null };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }, {
      pubkey: TEST_COUNTERPARTY_PUBKEY,
      plaintext: 'playwright nip44 encrypt smoke'
    });

    await page.waitForTimeout(300);
    context.off('page', handlePage);

    expect(promptOpened).toBe(false);
    expect(secondResult).toEqual(firstResult);

    await page.close();
  });

  test('rejects NIP-44 decrypt when the prompt is denied', async ({
    context,
    server,
    seedProfile
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await context.newPage();
    await page.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = page.evaluate(async ({ pubkey, ciphertext }) => {
      try {
        await window.nostr!.nip44.decrypt(pubkey, ciphertext);
        return { ok: true, message: null };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }, {
      pubkey: TEST_COUNTERPARTY_PUBKEY,
      ciphertext: 'A'.repeat(64)
    });

    const prompt = await promptPromise;
    await prompt.waitForLoadState('domcontentloaded');
    await expect(prompt.getByText('wants to decrypt a NIP-44 message')).toBeVisible();
    await prompt
      .getByRole('button', { name: 'Deny' })
      .evaluate((button: HTMLButtonElement) => button.click())
      .catch(() => {
        // The background closes the prompt as part of request completion.
      });

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      message: 'User denied the request'
    });

    await page.close();
  });
});
