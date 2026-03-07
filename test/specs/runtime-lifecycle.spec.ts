import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { chromium, expect as pwExpect, type BrowserContext, type Page } from '@playwright/test';

import { test, expect, TEST_PUBLIC_KEY } from '../fixtures/extension';

const SIGN_EVENT_PAYLOAD = {
  kind: 1,
  created_at: 1_700_000_000,
  tags: [],
  content: 'playwright restored signEvent'
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

const extensionPath = path.resolve(process.cwd(), 'dist');
async function waitForServiceWorker(context: BrowserContext) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return await context.waitForEvent('serviceworker');
}

async function gotoExtensionPage(page: Page, extensionId: string, targetPath: string) {
  const url = `chrome-extension://${extensionId}/${targetPath}`;
  await page.goto(url).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('interrupted by another navigation')) {
      throw error;
    }
  });
  await page.waitForURL(url);
}

async function fetchExtensionStatus(page: Page) {
  return await page.evaluate(async () => {
    const response = (await chrome.runtime.sendMessage({
      type: 'ext.getStatus'
    })) as { ok?: boolean; result?: Record<string, unknown>; error?: string } | undefined;

    if (!response?.ok || !response.result) {
      throw new Error(response?.error || 'Failed to load extension status');
    }

    return response.result;
  });
}

async function seedCanonicalProfile(
  context: BrowserContext,
  extensionId: string,
  profile: {
    keysetName?: string;
    onboardPackage: string;
    relays: string[];
    publicKey: string;
    peerPubkey: string;
  }
) {
  const page = await context.newPage();
  try {
    await gotoExtensionPage(page, extensionId, 'options.html');
    await pwExpect(page.getByText('igloo ext')).toBeVisible();
    await page.evaluate(async (nextProfile) => {
      const payload = {
        ...nextProfile,
        groupPublicKey: nextProfile.publicKey
      };
      localStorage.setItem('igloo.v2.profile', JSON.stringify(payload));
      await chrome.storage.local.set({
        'igloo.ext.profile': payload
      });
    }, profile);
  } finally {
    await page.close();
  }
}

async function ensureRuntimeSnapshot(
  context: BrowserContext,
  extensionId: string,
  profile: {
    onboardPackage: string;
    relays: string[];
    publicKey: string;
    peerPubkey: string;
  }
) {
  const page = await context.newPage();
  try {
    await gotoExtensionPage(page, extensionId, 'options.html');
    await pwExpect(page.getByText('igloo ext')).toBeVisible();
    await page.evaluate(async (nextProfile) => {
      const response = (await chrome.runtime.sendMessage({
        type: 'ext.offscreenRpc',
        rpcType: 'runtime.ensure',
        payload: {
          profile: {
            ...nextProfile,
            groupPublicKey: nextProfile.publicKey
          }
        }
      })) as { ok?: boolean; result?: unknown; error?: string } | undefined;

      if (!response?.ok) {
        throw new Error(response?.error || 'runtime.ensure failed');
      }
    }, profile);
  } finally {
    await page.close();
  }
}

async function launchExtensionContext(userDataDir: string) {
  return await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
}

test.describe('runtime lifecycle', () => {
  test.setTimeout(180_000);

  test('recreates the offscreen document after explicit teardown', async ({
    callOffscreenRpc,
    context,
    runRuntimeControl,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);
    await callOffscreenRpc('runtime.ensure', {
      profile: liveSigner.profile
    });

    await runRuntimeControl('closeOffscreen');

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
    await expect(callOffscreenRpc<{ runtime: 'cold' | 'ready' }>('runtime.status')).resolves.toEqual({
      runtime: 'ready'
    });

    await page.close();
  });

  test('provider prompts still complete while the runtime is cold after offscreen teardown', async ({
    callOffscreenRpc,
    context,
    openExtensionPage,
    runRuntimeControl,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);
    await callOffscreenRpc('runtime.ensure', {
      profile: liveSigner.profile
    });

    await runRuntimeControl('closeOffscreen');

    const dashboard = await openExtensionPage('options.html');
    const status = await fetchExtensionStatus(dashboard);
    expect(status).toMatchObject({
      runtime: 'cold',
      runtimeDetails: {
        status: null,
        snapshot: null,
        snapshotError: null
      }
    });
    await dashboard.close();

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

    await expect(callOffscreenRpc<{ runtime: 'cold' | 'ready' }>('runtime.status')).resolves.toEqual({
      runtime: 'ready'
    });

    await page.close();
  });

  test('restores signer nonce state after offscreen teardown so signEvent still succeeds', async ({
    callOffscreenRpc,
    context,
    runRuntimeControl,
    server,
    liveSigner,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);
    await callOffscreenRpc('runtime.ensure', {
      profile: liveSigner.profile
    });

    await runRuntimeControl('closeOffscreen');

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
      const snapshot = await callOffscreenRpc<{
        runtime: 'cold' | 'ready';
        status: unknown;
        snapshot: unknown;
        snapshotError: string | null;
      }>('runtime.snapshot');
      const diagnostics = await callOffscreenRpc<{
        runtime: 'cold' | 'ready';
        diagnostics: Array<Record<string, unknown>>;
      }>('runtime.diagnostics');
      throw new Error(
        `restored signEvent failed: ${result.message}\n${JSON.stringify({ snapshot, diagnostics }, null, 2)}`
      );
    }

    expect(result.event).toMatchObject({
      kind: SIGN_EVENT_PAYLOAD.kind,
      created_at: SIGN_EVENT_PAYLOAD.created_at,
      content: SIGN_EVENT_PAYLOAD.content,
      pubkey: TEST_PUBLIC_KEY
    });

    await page.close();
  });

  test('recovers provider access after extension context relaunch', async ({
    server,
    liveSigner
  }) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'igloo-ext-relaunch-'));
    let firstContext: BrowserContext | null = null;
    let secondContext: BrowserContext | null = null;

    try {
      firstContext = await launchExtensionContext(userDataDir);
      const firstWorker = await waitForServiceWorker(firstContext);
      const extensionId = new URL(firstWorker.url()).host;
      await seedCanonicalProfile(firstContext, extensionId, liveSigner.profile);
      await firstContext.close();
      firstContext = null;

      secondContext = await launchExtensionContext(userDataDir);
      await waitForServiceWorker(secondContext);

      const page = await secondContext.newPage();
      await page.goto(`${server.origin}/provider`);

      await expect
        .poll(async () => {
          return await page.evaluate(() => ({
            hasNostr: typeof window.nostr === 'object',
            hasGetPublicKey: typeof window.nostr?.getPublicKey === 'function'
          }));
        })
        .toEqual({
          hasNostr: true,
          hasGetPublicKey: true
        });

      const promptPromise = secondContext.waitForEvent(
        'page',
        (candidate) => candidate.url().includes('/prompt.html')
      );
      const resultPromise = page.evaluate(() => window.nostr!.getPublicKey());

      const prompt = await promptPromise;
      await expect(prompt.getByText('wants to read your public key')).toBeVisible();
      await approvePromptOnce(prompt);

      await expect(resultPromise).resolves.toBe(TEST_PUBLIC_KEY);
      await page.close();
    } finally {
      await secondContext?.close().catch(() => undefined);
      await firstContext?.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true });
    }
  });

  test('restores signEvent capability after a full browser-context relaunch', async ({
    server,
    liveSigner
  }) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'igloo-ext-relaunch-sign-'));
    let firstContext: BrowserContext | null = null;
    let secondContext: BrowserContext | null = null;

    try {
      firstContext = await launchExtensionContext(userDataDir);
      const firstWorker = await waitForServiceWorker(firstContext);
      const firstExtensionId = new URL(firstWorker.url()).host;
      await seedCanonicalProfile(firstContext, firstExtensionId, liveSigner.profile);
      await ensureRuntimeSnapshot(firstContext, firstExtensionId, liveSigner.profile);
      await firstContext.close();
      firstContext = null;

      secondContext = await launchExtensionContext(userDataDir);
      const secondWorker = await waitForServiceWorker(secondContext);
      const secondExtensionId = new URL(secondWorker.url()).host;

      const page = await secondContext.newPage();
      await page.goto(`${server.origin}/provider`);

      const promptPromise = secondContext.waitForEvent(
        'page',
        (candidate) => candidate.url().includes('/prompt.html')
      );
      const resultPromise = page.evaluate(async (event) => await window.nostr!.signEvent(event), SIGN_EVENT_PAYLOAD);

      const prompt = await promptPromise;
      await expect(prompt.getByText('wants to sign a Nostr event')).toBeVisible();
      await approvePromptOnce(prompt);

      await expect(resultPromise).resolves.toMatchObject({
        kind: SIGN_EVENT_PAYLOAD.kind,
        created_at: SIGN_EVENT_PAYLOAD.created_at,
        content: SIGN_EVENT_PAYLOAD.content,
        pubkey: TEST_PUBLIC_KEY
      });

      const statusPage = await secondContext.newPage();
      await gotoExtensionPage(statusPage, secondExtensionId, 'options.html');
      const status = await fetchExtensionStatus(statusPage);
      expect(status).toMatchObject({
        runtime: 'ready',
        runtimeDetails: {
          lifecycle: {
            bootMode: expect.stringMatching(/^(cold_boot|restored)$/)
          }
        }
      });

      await statusPage.close();
      await page.close();
    } finally {
      await secondContext?.close().catch(() => undefined);
      await firstContext?.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true });
    }
  });
});
