import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getE2EEvents,
  fetchExtensionAppStateFromPage,
  fetchRuntimeDiagnosticsFromPage,
  fetchWorkerStorageSnapshot,
  getPageDiagnostics,
  getWorkerOnboardingFailureBundle,
  openPageForStorage,
} = vi.hoisted(() => ({
  getE2EEvents: vi.fn(),
  fetchExtensionAppStateFromPage: vi.fn(),
  fetchRuntimeDiagnosticsFromPage: vi.fn(),
  fetchWorkerStorageSnapshot: vi.fn(),
  getPageDiagnostics: vi.fn(),
  getWorkerOnboardingFailureBundle: vi.fn(),
  openPageForStorage: vi.fn(),
}));

vi.mock('../../../../../test/shared/observability', () => ({
  getE2EEvents,
}));

vi.mock('../../../../../test/igloo-chrome/support/extension-status', () => ({
  fetchExtensionAppStateFromPage,
  fetchRuntimeDiagnosticsFromPage,
  fetchWorkerStorageSnapshot,
}));

vi.mock('../../../../../test/igloo-chrome/fixtures/helpers/fixture-state', () => ({
  getPageDiagnostics,
  getWorkerOnboardingFailureBundle,
}));

vi.mock('../../../../../test/igloo-chrome/fixtures/helpers/transport', () => ({
  openPageForStorage,
}));

import { collectFailureBundle } from '../../../../../test/igloo-chrome/fixtures/helpers/failure-bundle';

describe('failure bundle helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getE2EEvents.mockReturnValue([{ event: 'e2e' }]);
    getPageDiagnostics.mockReturnValue({ optionsPage: [] });
    getWorkerOnboardingFailureBundle.mockReturnValue({ stage: 'failed' });
  });

  test('collects the current state, runtime diagnostics, and storage snapshot', async () => {
    const page = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    openPageForStorage.mockResolvedValue(page);
    fetchRuntimeDiagnosticsFromPage.mockResolvedValue({ runtime: 'ready' });
    fetchExtensionAppStateFromPage.mockResolvedValue({ configured: true });
    fetchWorkerStorageSnapshot.mockResolvedValue({ chromeStorage: {} });

    const bundle = await collectFailureBundle({} as never, 'extension-id');

    expect(bundle).toEqual({
      e2eEvents: [{ event: 'e2e' }],
      runtimeDiagnostics: { runtime: 'ready' },
      state: { configured: true },
      storageSnapshot: { chromeStorage: {} },
      pageDiagnostics: { optionsPage: [] },
      workerOnboardingFailureBundle: { stage: 'failed' },
    });
    expect(page.close).toHaveBeenCalled();
  });

  test('returns a fallback bundle when the extension page cannot be opened', async () => {
    openPageForStorage.mockRejectedValue(new Error('page unavailable'));

    const bundle = await collectFailureBundle({} as never, 'extension-id');

    expect(bundle).toEqual({
      e2eEvents: [{ event: 'e2e' }],
      extensionDiagnosticsError: 'failed to open extension storage page',
      workerOnboardingFailureBundle: { stage: 'failed' },
    });
  });
});
