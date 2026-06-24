import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getChromeApi, sessionSet, sessionGet } = vi.hoisted(() => ({
  getChromeApi: vi.fn(),
  sessionSet: vi.fn(),
  sessionGet: vi.fn(),
}));

vi.mock('@/extension/chrome', () => ({
  getChromeApi,
}));

import {
  clearUnlockedProfileKeys,
  loadUnlockedProfileIds,
  loadUnlockedProfileKey,
  saveUnlockedProfileKey,
} from '@/extension/storage';

describe('extension unlock storage', () => {
  const sessionKey = {} as CryptoKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    getChromeApi.mockReturnValue({
      storage: {
        session: {
          get: sessionGet,
          set: sessionSet,
        },
      },
    });
    await clearUnlockedProfileKeys();
  });

  test('keeps unlocked profile keys in memory only', async () => {
    await saveUnlockedProfileKey('profile-1', sessionKey);

    await expect(loadUnlockedProfileKey('profile-1')).resolves.toBe(sessionKey);
    await expect(loadUnlockedProfileIds()).resolves.toEqual(new Set(['profile-1']));
    expect(sessionSet).not.toHaveBeenCalled();
    expect(sessionGet).not.toHaveBeenCalled();
  });

  test('returns no unlocked profiles after memory is cleared', async () => {
    await saveUnlockedProfileKey('profile-1', sessionKey);
    await clearUnlockedProfileKeys();

    await expect(loadUnlockedProfileKey('profile-1')).resolves.toBeNull();
    await expect(loadUnlockedProfileIds()).resolves.toEqual(new Set());
  });

  test('starts locked after the background storage module is reloaded', async () => {
    await saveUnlockedProfileKey('profile-1', sessionKey);

    vi.resetModules();
    const freshStorage = await import('@/extension/storage');

    await expect(freshStorage.loadUnlockedProfileIds()).resolves.toEqual(new Set());
    await expect(freshStorage.loadUnlockedProfileKey('profile-1')).resolves.toBeNull();
  });
});
