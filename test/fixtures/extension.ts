import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';

import { chromium, expect, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';

import { TEST_PEER_PUBLIC_KEY, TEST_PROFILE, TEST_PUBLIC_KEY } from './constants';
import { startLiveSignerFixture, type LiveSignerFixture } from './live-signer';
import { startTestServer, type TestServer } from './server';

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  server: TestServer;
  liveSigner: LiveSignerFixture;
  openExtensionPage: (path: string) => Promise<Page>;
  callOffscreenRpc: <T>(rpcType: string, payload?: Record<string, unknown>) => Promise<T>;
  runRuntimeControl: (action: 'closeOffscreen' | 'reloadExtension') => Promise<void>;
  reloadExtension: () => Promise<void>;
  seedProfile: (
    overrides?: Partial<typeof TEST_PROFILE> & {
      publicKey?: string;
      groupPublicKey?: string;
      peerPubkey?: string;
    }
  ) => Promise<void>;
  seedPermissionPolicies: (policies: SeedPermissionPolicy[]) => Promise<void>;
  seedPeerPolicies: (policies: SeedPeerPolicy[]) => Promise<void>;
  clearExtensionStorage: () => Promise<void>;
};

type SeedPermissionPolicy = {
  host: string;
  type: string;
  allow: boolean;
  createdAt?: number;
  kind?: number;
};

type SeedPeerPolicy = {
  pubkey: string;
  send: boolean;
  receive: boolean;
};

const extensionPath = path.resolve(process.cwd(), 'dist');
let buildPrepared = false;

function buildExtensionOnce() {
  if (buildPrepared) return;
  execFileSync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  buildPrepared = true;
}

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

async function openPageForStorage(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await gotoExtensionPage(page, extensionId, 'options.html');
  await expect(page.getByText('igloo ext')).toBeVisible();
  return page;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    buildExtensionOnce();
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'igloo-ext-pw-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  serviceWorker: async ({ context }, use) => {
    const worker = await waitForServiceWorker(context);
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
  },

  server: async ({}, use) => {
    const server = await startTestServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },

  liveSigner: async ({}, use) => {
    const fixture = await startLiveSignerFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },

  openExtensionPage: async ({ context, extensionId }, use) => {
    await use(async (targetPath: string) => {
      const page = await context.newPage();
      await gotoExtensionPage(page, extensionId, targetPath);
      return page;
    });
  },

  callOffscreenRpc: async ({ context, extensionId }, use) => {
    await use(async <T>(rpcType: string, payload?: Record<string, unknown>) => {
      const page = await openPageForStorage(context, extensionId);
      try {
        const result = await page.evaluate(
          async ({ nextRpcType, nextPayload }) => {
            await chrome.runtime.sendMessage({ type: 'ext.getStatus' });
            const response = await chrome.runtime.sendMessage({
              type: 'ext.offscreenRpc',
              rpcType: nextRpcType,
              payload: nextPayload
            });
            if (!response?.ok) {
              throw new Error(response?.error || 'Offscreen rpc failed');
            }
            return response.result;
          },
          { nextRpcType: rpcType, nextPayload: payload }
        );
        return result as T;
      } finally {
        await page.close();
      }
    });
  },

  runRuntimeControl: async ({ context, extensionId }, use) => {
    await use(async (action: 'closeOffscreen' | 'reloadExtension') => {
      const page = await openPageForStorage(context, extensionId);
      try {
        await page.evaluate(async (nextAction) => {
          const response = (await chrome.runtime.sendMessage({
            type: 'ext.runtimeControl',
            action: nextAction
          })) as { ok?: boolean; error?: string } | undefined;
          if (!response?.ok) {
            throw new Error(response?.error || 'Runtime control failed');
          }
        }, action);
      } finally {
        await page.close();
      }
    });
  },

  reloadExtension: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await openPageForStorage(context, extensionId);
      try {
        await page.evaluate(async () => {
          const response = (await chrome.runtime.sendMessage({
            type: 'ext.runtimeControl',
            action: 'reloadExtension'
          })) as { ok?: boolean; error?: string } | undefined;
          if (!response?.ok) {
            throw new Error(response?.error || 'Extension reload failed');
          }
        });
      } finally {
        await page.close().catch(() => undefined);
      }
      await context.waitForEvent('serviceworker', { timeout: 5_000 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  },

  seedProfile: async ({ context, extensionId }, use) => {
    await use(async (overrides = {}) => {
      const page = await openPageForStorage(context, extensionId);
      await page.evaluate(
        async ({ profile, publicKey, groupPublicKey, peerPubkey }) => {
          const localProfile = {
            ...profile,
            ...(groupPublicKey ? { groupPublicKey } : publicKey ? { groupPublicKey: publicKey } : {}),
            ...(publicKey ? { publicKey } : {}),
            ...(peerPubkey ? { peerPubkey } : {})
          };
          localStorage.removeItem('igloo.ext.runtimeSnapshot');
          localStorage.setItem('igloo.v2.profile', JSON.stringify(localProfile));
          await chrome.storage.local.set({
            'igloo.ext.profile': {
              ...localProfile
            }
          });
        },
        {
          profile: { ...TEST_PROFILE, ...overrides },
          publicKey: overrides.publicKey,
          groupPublicKey: overrides.groupPublicKey,
          peerPubkey: overrides.peerPubkey
        }
      );
      await page.close();
    });
  },

  seedPermissionPolicies: async ({ context, extensionId }, use) => {
    await use(async (policies) => {
      const page = await openPageForStorage(context, extensionId);
      await page.evaluate(async (entries) => {
        await chrome.storage.local.set({
          'igloo.ext.permissions': entries.map((entry) => ({
            ...entry,
            createdAt: entry.createdAt ?? Date.now()
          }))
        });
      }, policies);
      await page.close();
    });
  },

  seedPeerPolicies: async ({ context, extensionId }, use) => {
    await use(async (policies) => {
      const page = await openPageForStorage(context, extensionId);
      await page.evaluate(
        async (entries) => {
          localStorage.setItem('igloo.policies', JSON.stringify(entries));
          await chrome.storage.local.set({
            'igloo.ext.peerPolicies': entries
          });
        },
        policies
      );
      await page.close();
    });
  },

  clearExtensionStorage: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await openPageForStorage(context, extensionId);
      await page.evaluate(async () => {
        localStorage.removeItem('igloo.v2.profile');
        localStorage.removeItem('igloo.policies');
        localStorage.removeItem('igloo.ext.runtimeSnapshot');
        await chrome.storage.local.clear();
      });
      await page.close();
    });
  }
});

export { expect, TEST_PEER_PUBLIC_KEY, TEST_PROFILE, TEST_PUBLIC_KEY };
