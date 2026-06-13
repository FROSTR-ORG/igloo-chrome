import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const mockUseStore = vi.hoisted(() => vi.fn());
const mockDeriveRuntimePresentation = vi.hoisted(() => vi.fn());

vi.mock('@/lib/store', () => ({
  useStore: mockUseStore,
}));

vi.mock('@/lib/runtime-activation', () => ({
  deriveRuntimePresentation: mockDeriveRuntimePresentation,
}));

vi.mock('@/lib/observability', () => ({
  createLogger: () => ({
    warn: vi.fn(),
  }),
}));

vi.mock('igloo-ui', () => ({
  AppHeader: ({ taskLabel }: { taskLabel?: string }) => <div>{taskLabel}</div>,
  ContentCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  buildPeerReadinessRows: () => [],
  // The redesigned panel takes a single `view` model; the saved-but-unavailable
  // warning now surfaces through `view.relaySummary`.
  OperatorSignerPanel: ({ view }: { view: { relaySummary: string } | null }) => (
    <div data-testid="runtime-error">{view?.relaySummary ?? ''}</div>
  ),
}));

import { SignerPanel } from '@/pages/Signer';

describe('SignerPanel', () => {
  test('shows an explicit saved-but-unavailable warning when lifecycle activation is degraded', async () => {
    mockUseStore.mockReturnValue({
      appState: {
        runtime: {
          phase: 'cold',
          lastError: null,
          metadata: null,
          summary: null,
          pendingOperations: [],
        },
        lifecycle: {
          activation: {
            stage: 'degraded',
            updatedAt: 1,
            lastError: {
              code: 'runtime_unavailable',
              message:
                'Profile saved, but the signer is unavailable. Start it again when relays are reachable.',
            },
          },
          onboarding: {
            updatedAt: null,
          },
        },
      },
      loadRuntimeDiagnostics: vi.fn().mockResolvedValue({
        diagnostics: [],
      }),
      profile: {
        groupName: 'Chrome signer',
        groupPublicKey: '11'.repeat(32),
        sharePublicKey: '22'.repeat(32),
      },
      refreshRuntimePeers: vi.fn(),
      startRuntime: vi.fn(),
      stopRuntime: vi.fn(),
    });
    mockDeriveRuntimePresentation.mockReturnValue({
      runtimeState: 'stopped',
      runtimeControlLabel: 'Start signer',
      runtimeSummaryLabel: 'Signer stopped',
      runtimeError:
        'Profile saved, but the signer is unavailable. Start it again when relays are reachable.',
    });

    render(<SignerPanel embedded />);

    await waitFor(() => {
      expect(screen.getByTestId('runtime-error').textContent).toContain(
        'Profile saved, signer unavailable.',
      );
    });
  });
});
