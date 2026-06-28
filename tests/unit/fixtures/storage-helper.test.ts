import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { openPageForStorage, buildSeedProfile, createSeededProfileRecord } = vi.hoisted(() => ({
  openPageForStorage: vi.fn(),
  buildSeedProfile: vi.fn(),
  createSeededProfileRecord: vi.fn(),
}));

vi.mock('../../../../../test/igloo-chrome/fixtures/helpers/transport', () => ({
  openPageForStorage,
}));

vi.mock('../../../../../test/igloo-chrome/fixtures/helpers/seed-profile', () => ({
  buildSeedProfile,
}));

vi.mock('../../../../../test/igloo-chrome/fixtures/helpers/seed-crypto', () => ({
  createSeededProfileRecord,
}));

import {
  clearExtensionStorageState,
  clearSessionUnlocksInExtension,
  seedProfileIntoExtension,
} from '../../../../../test/igloo-chrome/fixtures/helpers/storage';

describe('fixture storage helpers', () => {
  const localClear = vi.fn();
  const sessionClear = vi.fn();
  const sendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage,
      },
      storage: {
        local: {
          clear: localClear,
          set: vi.fn(async (value: Record<string, unknown>) => {
            const local = (globalThis as { __localStorageMock?: Record<string, unknown> }).__localStorageMock ?? {};
            Object.assign(local, value);
            (globalThis as { __localStorageMock?: Record<string, unknown> }).__localStorageMock = local;
          }),
          get: vi.fn(async (keys: string | string[]) => {
            const local = (globalThis as { __localStorageMock?: Record<string, unknown> }).__localStorageMock ?? {};
            const entries = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(entries.map((key) => [key, local[key]]));
          }),
        },
        session: {
          clear: sessionClear,
          set: vi.fn(async (value: Record<string, unknown>) => {
            const session = (globalThis as { __sessionStorageMock?: Record<string, unknown> }).__sessionStorageMock ?? {};
            Object.assign(session, value);
            (globalThis as { __sessionStorageMock?: Record<string, unknown> }).__sessionStorageMock = session;
          }),
          get: vi.fn(async (key: string) => {
            const session = (globalThis as { __sessionStorageMock?: Record<string, unknown> }).__sessionStorageMock ?? {};
            return { [key]: session[key] };
          }),
        },
      },
    };
    localClear.mockResolvedValue(undefined);
    sessionClear.mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: true, result: {} });
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { __localStorageMock?: unknown }).__localStorageMock;
    delete (globalThis as { __sessionStorageMock?: unknown }).__sessionStorageMock;
  });

  test('uses prebuilt seeded records without rebuilding payload crypto', async () => {
    const page = {
      evaluate: vi.fn(async (fn: (arg: unknown) => unknown, arg: unknown) => await fn(arg)),
      close: vi.fn().mockResolvedValue(undefined),
    };
    openPageForStorage.mockResolvedValue(page);

    const storedBlobRecord = { id: 'profile-1', blob: { version: 1 } };
    await seedProfileIntoExtension({} as never, 'extension-id', {
      storedBlobRecord,
      sessionKeyB64: 'seed-session-key',
    } as never);

    expect(buildSeedProfile).not.toHaveBeenCalled();
    expect(createSeededProfileRecord).not.toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      storedBlobRecord,
      sessionKeyB64: 'seed-session-key',
    });
    expect(page.close).toHaveBeenCalled();
  });

  test('clears extension storage and in-memory unlocks', async () => {
    const page = {
      evaluate: vi.fn(async (fn: () => unknown) => await fn()),
      close: vi.fn().mockResolvedValue(undefined),
    };
    openPageForStorage.mockResolvedValue(page);

    const context = {};
    await clearExtensionStorageState(context as never, 'extension-id');
    await clearSessionUnlocksInExtension(context as never, 'extension-id');

    expect(localClear).toHaveBeenCalledTimes(1);
    expect(sessionClear).toHaveBeenCalledTimes(2);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledTimes(2);
  });
});
