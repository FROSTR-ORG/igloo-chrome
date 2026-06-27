import { describe, expect, test } from 'vitest';

const LOCAL_CSP =
  "default-src 'none'; connect-src 'self' wss: https: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*; object-src 'none';";

describe('production package helpers', () => {
  test('release manifest strips local relay CSP entries without mutating the source manifest', async () => {
    const { createReleaseManifest } = await import('../../../scripts/production-package.mjs');
    const source = {
      manifest_version: 3,
      content_security_policy: {
        extension_pages: LOCAL_CSP,
      },
    };

    const releaseManifest = createReleaseManifest(source);

    expect(source.content_security_policy.extension_pages).toContain('localhost');
    expect(releaseManifest.content_security_policy.extension_pages).not.toContain('localhost');
    expect(releaseManifest.content_security_policy.extension_pages).not.toContain('127.0.0.1');
    expect(releaseManifest.content_security_policy.extension_pages).toContain("connect-src 'self' wss: https:");
  });

  test('production package assertion rejects local CSP and debug command literals', async () => {
    const { assertProductionPackage } = await import('../../../scripts/production-package.mjs');

    expect(() =>
      assertProductionPackage({
        manifest: {
          content_security_policy: {
            extension_pages: LOCAL_CSP,
          },
        },
        backgroundSource: 'const command = "ext.debug.reload";',
      }),
    ).toThrow(/local relay CSP|debug command/);
  });
});
