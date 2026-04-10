import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { SettingsPanel } from '@/components/options/SettingsPanel';

describe('chrome settings panel', () => {
  test('shows the unified settings actions and no wipe/reset control', () => {
    render(
      <SettingsPanel
        profile={{
          id: '11'.repeat(32),
          groupName: 'Chrome signer',
          groupPublicKey: '22'.repeat(32),
          sharePublicKey: '33'.repeat(32),
          relays: ['wss://relay.primal.net'],
          signerSettings: {
            sign_timeout_secs: 30,
            ping_timeout_secs: 15,
            request_ttl_secs: 300,
            state_save_interval_secs: 30,
            peer_selection_strategy: 'deterministic_sorted',
          },
        }}
        saveProfile={vi.fn().mockResolvedValue(undefined)}
        connectOnboarding={vi.fn().mockResolvedValue({
          id: '44'.repeat(32),
          label: 'Rotated Device',
          groupName: 'Chrome signer',
          sharePublicKey: '55'.repeat(32),
          groupPublicKey: '22'.repeat(32),
          relays: ['wss://relay.primal.net'],
          profilePayload: {
            profileId: '44'.repeat(32),
            groupPackage: { group_name: 'Chrome signer', group_pk: '22'.repeat(32), threshold: 1, members: [] },
            sharePackage: { share: 'demo' },
            relays: ['wss://relay.primal.net'],
            signerSettings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
          },
        } as never)}
        completeRotationUpdate={vi.fn().mockResolvedValue(undefined as never)}
        copyProfilePackage={vi.fn().mockResolvedValue('bfprofile1encoded')}
        logout={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: 'copy profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copy share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'rotate share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'logout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wipe all data/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
  });

  test('preserves peer bootstrap metadata when saving settings', async () => {
    const saveProfile = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPanel
        profile={{
          id: '11'.repeat(32),
          groupName: 'Chrome signer',
          groupPublicKey: '22'.repeat(32),
          sharePublicKey: '33'.repeat(32),
          peerPubkey: '44'.repeat(32),
          runtimeSnapshotJson: '{"snapshot":true}',
          relays: ['wss://relay.primal.net'],
          signerSettings: {
            sign_timeout_secs: 30,
            ping_timeout_secs: 15,
            request_ttl_secs: 300,
            state_save_interval_secs: 30,
            peer_selection_strategy: 'deterministic_sorted',
          },
        }}
        saveProfile={saveProfile}
        connectOnboarding={vi.fn().mockResolvedValue({
          id: '55'.repeat(32),
          label: 'Rotated Device',
          groupName: 'Chrome signer',
          sharePublicKey: '66'.repeat(32),
          groupPublicKey: '22'.repeat(32),
          relays: ['wss://relay.primal.net'],
          profilePayload: {
            profileId: '55'.repeat(32),
            groupPackage: { group_name: 'Chrome signer', group_pk: '22'.repeat(32), threshold: 1, members: [] },
            sharePackage: { share: 'demo' },
            relays: ['wss://relay.primal.net'],
            signerSettings: {
              sign_timeout_secs: 30,
              ping_timeout_secs: 15,
              request_ttl_secs: 300,
              state_save_interval_secs: 30,
              peer_selection_strategy: 'deterministic_sorted',
            },
          },
        } as never)}
        completeRotationUpdate={vi.fn().mockResolvedValue(undefined as never)}
        copyProfilePackage={vi.fn().mockResolvedValue('bfprofile1encoded')}
        logout={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(1));
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        peerPubkey: '44'.repeat(32),
        runtimeSnapshotJson: '{"snapshot":true}',
      }),
    );
  });
});
