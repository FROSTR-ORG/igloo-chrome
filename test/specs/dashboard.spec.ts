import { test, expect, TEST_PEER_PUBLIC_KEY, TEST_PUBLIC_KEY } from '../fixtures/extension';

test.describe('extension dashboard smoke', () => {
  test('renders onboarding flow on a fresh profile', async ({
    openExtensionPage,
    clearExtensionStorage
  }) => {
    await clearExtensionStorage();

    const page = await openExtensionPage('options.html');

    await expect(page.getByText('Welcome to igloo web')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Setup' }).click();
    await expect(page.getByPlaceholder('e.g. Laptop Signer, Browser Node A')).toBeVisible();
    await expect(page.getByPlaceholder('bfonboard1...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect and Continue' })).toBeDisabled();
    await page.close();
  });

  test('popup shows configured profile status', async ({
    openExtensionPage,
    seedProfile
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const popup = await openExtensionPage('popup.html');

    await expect(popup.getByText('Playwright Smoke')).toBeVisible();
    await expect(popup.getByText('cold')).toBeVisible();
    await expect(popup.getByText(TEST_PUBLIC_KEY)).toBeVisible();
    await popup.close();
  });

  test('configured options page exposes runtime, permissions, and settings tabs', async ({
    openExtensionPage,
    seedProfile
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const page = await openExtensionPage('options.html');

    await expect(page.getByRole('button', { name: /Signer runtime console/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Runtime background \+ offscreen/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Permissions site and peer policies/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Settings operator controls/i })).toBeVisible();

    await page.getByRole('button', { name: /Runtime background \+ offscreen/i }).click();
    await expect(page.getByText('Runtime Status')).toBeVisible();
    await expect(page.getByText('Offscreen Runtime')).toBeVisible();
    await expect(page.getByText('Runtime Snapshot')).toBeVisible();

    await page.getByRole('button', { name: /Permissions site and peer policies/i }).click();
    await expect(page.getByText('Site Policies')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Peer Policies' })).toBeVisible();

    await page.getByRole('button', { name: /Settings operator controls/i }).click();
    await expect(page.getByText('Profile Settings')).toBeVisible();
    await expect(page.getByText('Maintenance')).toBeVisible();

    await page.close();
  });

  test('runtime tab surfaces live nonce pool diagnostics', async ({
    callOffscreenRpc,
    liveSigner,
    openExtensionPage,
    seedProfile
  }) => {
    await seedProfile(liveSigner.profile);
    await callOffscreenRpc('runtime.ensure', {
      profile: liveSigner.profile
    });

    const page = await openExtensionPage('options.html');
    await page.getByRole('button', { name: /Runtime background \+ offscreen/i }).click();

    await expect(page.getByText('Nonce Pools')).toBeVisible();
    await expect(page.getByText('Pending Operations')).toBeVisible();
    await expect(page.getByText('Known Peers')).toBeVisible();
    await expect(page.getByText('Boot Mode')).toBeVisible();
    await expect(page.getByText('cold_boot')).toBeVisible();
    await expect(page.getByText('Replay Cache')).toBeVisible();
    await expect(page.getByText(TEST_PEER_PUBLIC_KEY)).toBeVisible();
    await expect(page.getByText('No operations are currently pending.')).toBeVisible();

    await page.close();
  });

  test('permissions page lists and revokes stored site policies', async ({
    openExtensionPage,
    seedPeerPolicies,
    seedPermissionPolicies,
    seedProfile,
    server
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });
    await seedPermissionPolicies([
      {
        host: new URL(server.origin).host,
        type: 'nostr.getPublicKey',
        allow: true,
        createdAt: Date.UTC(2026, 2, 6, 12, 0, 0)
      }
    ]);
    await seedPeerPolicies([
      {
        pubkey: TEST_PEER_PUBLIC_KEY,
        send: true,
        receive: false
      }
    ]);

    const page = await openExtensionPage('options.html');
    await page.getByRole('button', { name: /Permissions site and peer policies/i }).click();

    await expect(page.getByText(new URL(server.origin).host)).toBeVisible();
    await expect(page.getByText('Method: getPublicKey • all kinds')).toBeVisible();
    await expect(page.getByText(TEST_PEER_PUBLIC_KEY)).toBeVisible();
    await expect(page.getByText('send: allow')).toBeVisible();
    await expect(page.getByText('receive: deny')).toBeVisible();

    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('No website permissions have been granted yet.')).toBeVisible();
    await expect(page.getByText(TEST_PEER_PUBLIC_KEY)).toBeVisible();

    await page.close();
  });

  test('settings page clears stored policies and resets the profile', async ({
    openExtensionPage,
    seedPeerPolicies,
    seedPermissionPolicies,
    seedProfile,
    server
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });
    await seedPermissionPolicies([
      {
        host: new URL(server.origin).host,
        type: 'nostr.getPublicKey',
        allow: true
      }
    ]);
    await seedPeerPolicies([
      {
        pubkey: TEST_PEER_PUBLIC_KEY,
        send: true,
        receive: true
      }
    ]);

    const page = await openExtensionPage('options.html');

    await page.getByRole('button', { name: /Settings operator controls/i }).click();
    await page.getByRole('button', { name: 'Clear Website Policies' }).click();
    await expect(page.getByText('Website permissions cleared')).toBeVisible();

    await page.getByRole('button', { name: 'Clear Peer Policies' }).click();
    await expect(page.getByText('Peer policies cleared')).toBeVisible();

    await page.getByRole('button', { name: /Permissions site and peer policies/i }).click();
    await expect(page.getByText('No website permissions have been granted yet.')).toBeVisible();
    await expect(page.getByText('No peer policy state has been saved yet.')).toBeVisible();

    await page.getByRole('button', { name: /Settings operator controls/i }).click();
    await page.getByRole('button', { name: 'Clear Profile' }).click();
    await expect(page.getByText('Welcome to igloo web')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to Setup' })).toBeVisible();

    await page.close();
  });

  test('provider approvals are surfaced in the permissions dashboard', async ({
    context,
    openExtensionPage,
    seedProfile,
    server
  }) => {
    await seedProfile({ publicKey: TEST_PUBLIC_KEY });

    const providerPage = await context.newPage();
    await providerPage.goto(`${server.origin}/provider`);

    const promptPromise = context.waitForEvent(
      'page',
      (candidate) => candidate.url().includes('/prompt.html')
    );
    const resultPromise = providerPage.evaluate(() => window.nostr!.getRelays());

    const prompt = await promptPromise;
    await prompt.waitForLoadState('domcontentloaded');
    await prompt
      .getByRole('button', { name: 'Always allow this method' })
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

    const page = await openExtensionPage('options.html');
    await page.getByRole('button', { name: /Permissions site and peer policies/i }).click();
    await expect(page.getByText(new URL(server.origin).host)).toBeVisible();
    await expect(page.getByText('Method: getRelays • all kinds')).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^allow$/ })).toHaveCount(1);

    await providerPage.close();
    await page.close();
  });

});
