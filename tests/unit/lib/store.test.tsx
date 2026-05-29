import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { StoreProvider, useStore } from '@/lib/store';
import {
  EVENT_TYPE,
  type ExtensionStateSnapshot,
  type PendingOnboardingProfile,
  type StoredExtensionProfile,
  type StoredProfileSummary,
} from '@/extension/protocol';

const runtimeListeners = new Set<(message: unknown) => void>();

const mockClient = vi.hoisted(() => ({
  fetchExtensionState: vi.fn(),
  fetchRuntimeDiagnostics: vi.fn(),
  saveExtensionProfile: vi.fn(),
  startOnboarding: vi.fn(),
  completeOnboarding: vi.fn(),
  completeRotationOnboarding: vi.fn(),
  importBfprofile: vi.fn(),
  activateExtensionProfile: vi.fn(),
  unlockExtensionProfile: vi.fn(),
  logoutExtensionProfile: vi.fn(),
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
  reloadRuntime: vi.fn(),
  refreshRuntimePeers: vi.fn(),
  prepareRuntime: vi.fn(),
  updateRuntimeConfig: vi.fn(),
  updateRuntimePeerPolicy: vi.fn(),
  clearRuntimePeerPolicyOverrides: vi.fn(),
  revokePermissionPolicy: vi.fn(),
  clearPermissionPolicies: vi.fn(),
  exportProfilePackage: vi.fn(),
}));

const mockChrome = vi.hoisted(() => ({
  getChromeApi: vi.fn()
}));

vi.mock('@/extension/client', () => mockClient);
vi.mock('@/extension/chrome', () => mockChrome);

function makeProfileSummary(overrides: Partial<StoredProfileSummary> = {}): StoredProfileSummary {
  return {
    id: '11'.repeat(32),
    label: 'Chrome signer',
    createdAt: 1,
    updatedAt: 1,
    unlocked: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<ExtensionStateSnapshot> = {}): ExtensionStateSnapshot {
  return {
    configured: false,
    profile: null,
    profiles: [],
    activeProfileId: null,
    lifecycle: {
      onboarding: { stage: 'idle', updatedAt: null, lastError: null },
      activation: {
        stage: 'idle',
        updatedAt: null,
        lastError: null,
        restoredFromSnapshot: false,
        runtime: 'cold',
      },
    },
    runtime: {
      desiredActive: false,
      phase: 'cold',
      summary: null,
      metadata: null,
      readiness: null,
      peerStatus: [],
      pendingOperations: [],
      snapshot: null,
      snapshotError: null,
      lifecycle: {
        bootMode: 'unknown',
        reason: null,
        updatedAt: null,
      },
      lastError: null,
    },
    permissionPolicies: [],
    pendingPrompts: 0,
    ...overrides,
  };
}

function Harness({ onReady }: { onReady: (value: ReturnType<typeof useStore>) => void }) {
  const store = useStore();

  React.useEffect(() => {
    onReady(store);
  }, [onReady, store]);

  return <div>{store.route}</div>;
}

describe('igloo-chrome StoreProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeListeners.clear();
    mockChrome.getChromeApi.mockReturnValue({
      runtime: {
        onMessage: {
          addListener: (listener: (message: unknown) => void) => runtimeListeners.add(listener),
          removeListener: (listener: (message: unknown) => void) => runtimeListeners.delete(listener),
        },
      },
    });

    const baseState = makeState();
    mockClient.fetchExtensionState.mockResolvedValue(baseState);
    mockClient.fetchRuntimeDiagnostics.mockResolvedValue({
      runtime: 'cold',
      diagnostics: [],
      dropped: 0,
      runtimeStatus: null,
      runtimeSnapshot: null,
      runtimeSnapshotError: null,
      runtimeLifecycle: null,
      lifecycle: baseState.lifecycle,
      lifecycleHistory: [],
    });
    mockClient.saveExtensionProfile.mockImplementation(async (profile: StoredExtensionProfile) => profile);
    mockClient.startOnboarding.mockResolvedValue(undefined);
    mockClient.completeOnboarding.mockImplementation(async (pendingProfile: PendingOnboardingProfile, label: string) => ({
      id: pendingProfile.id,
      groupName: label,
      relays: pendingProfile.relays,
      sharePublicKey: pendingProfile.sharePublicKey,
    }));
    mockClient.completeRotationOnboarding.mockResolvedValue({
      id: '99'.repeat(32),
      groupName: 'Rotated profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '55'.repeat(32),
    });
    mockClient.importBfprofile.mockResolvedValue({
      id: 'aa'.repeat(32),
      groupName: 'Imported profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '11'.repeat(32),
    });
    mockClient.activateExtensionProfile.mockImplementation(async (profileId: string) => ({
      id: profileId,
      groupName: 'Activated profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '33'.repeat(32),
    }));
    mockClient.unlockExtensionProfile.mockImplementation(async (profileId: string) => ({
      id: profileId,
      groupName: 'Unlocked profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '44'.repeat(32),
    }));
    mockClient.logoutExtensionProfile.mockResolvedValue(undefined);
    mockClient.startRuntime.mockResolvedValue(undefined);
    mockClient.stopRuntime.mockResolvedValue(undefined);
    mockClient.reloadRuntime.mockResolvedValue(undefined);
    mockClient.refreshRuntimePeers.mockResolvedValue(undefined);
    mockClient.prepareRuntime.mockResolvedValue(undefined);
    mockClient.updateRuntimeConfig.mockResolvedValue(undefined);
    mockClient.updateRuntimePeerPolicy.mockResolvedValue([]);
    mockClient.clearRuntimePeerPolicyOverrides.mockResolvedValue([]);
    mockClient.revokePermissionPolicy.mockResolvedValue(undefined);
    mockClient.clearPermissionPolicies.mockResolvedValue(undefined);
    mockClient.exportProfilePackage.mockResolvedValue('bfprofile1encoded');
  });

  test('hydrates from extension state and switches route when configured', async () => {
    mockClient.fetchExtensionState.mockResolvedValue(
      makeState({
        configured: true,
        profile: {
          id: '11'.repeat(32),
          groupName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey',
        },
        profiles: [makeProfileSummary({ id: '11'.repeat(32), label: 'Chrome signer', unlocked: true })],
        activeProfileId: '11'.repeat(32),
      })
    );

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <Harness onReady={(value) => { latestStore = value; }} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
      expect(latestStore?.profile?.groupName).toBe('Chrome signer');
      expect(latestStore?.isHydratingProfile).toBe(false);
    });
  });

  test('derives the last onboarding failure from state update events', async () => {
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <Harness onReady={(value) => { latestStore = value; }} />
      </StoreProvider>
    );

    await waitFor(() => expect(latestStore?.isHydratingProfile).toBe(false));

    const nextState = makeState({
      lifecycle: {
        onboarding: {
          stage: 'failed',
          updatedAt: 1,
          lastError: {
            message: 'Onboarding timed out',
            code: 'onboard_timeout',
            source: 'background',
            updatedAt: 1,
          },
        },
        activation: {
          stage: 'idle',
          updatedAt: null,
          lastError: null,
          restoredFromSnapshot: false,
          runtime: 'cold',
        },
      },
    });

    await act(async () => {
      for (const listener of runtimeListeners) {
        listener({
          type: EVENT_TYPE.STATE_CHANGED,
          state: nextState,
        });
      }
    });

    await waitFor(() => {
      expect(latestStore?.lastOnboardingFailure).toEqual({ message: 'Onboarding timed out' });
    });

    await act(async () => {
      latestStore?.clearOnboardingFailure();
    });
    await waitFor(() => expect(latestStore?.lastOnboardingFailure).toBeNull());
  });

  test('logout clears configured state and requests runtime stop', async () => {
    mockClient.fetchExtensionState.mockResolvedValue(
      makeState({
        configured: true,
        profile: {
          id: '11'.repeat(32),
          groupName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey',
        },
        profiles: [makeProfileSummary({ id: '11'.repeat(32), label: 'Chrome signer', unlocked: true })],
        activeProfileId: '11'.repeat(32),
      })
    );

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <Harness onReady={(value) => { latestStore = value; }} />
      </StoreProvider>
    );

    await waitFor(() => expect(latestStore?.route).toBe('signer'));

    await act(async () => {
      await latestStore?.logout();
    });

    expect(mockClient.stopRuntime).toHaveBeenCalled();
    expect(mockClient.logoutExtensionProfile).toHaveBeenCalled();
    await waitFor(() => {
      expect(latestStore?.route).toBe('onboarding');
      expect(latestStore?.profile).toBeUndefined();
    });
  });

  test('saveProfile surfaces duplicate-profile failures', async () => {
    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <Harness onReady={(value) => { latestStore = value; }} />
      </StoreProvider>
    );

    await waitFor(() => expect(latestStore?.isHydratingProfile).toBe(false));

    mockClient.saveExtensionProfile.mockRejectedValueOnce(new Error('Device profile Chrome signer already exists.'));

    const profile: StoredExtensionProfile = {
      id: '77'.repeat(32),
      groupName: 'Chrome signer',
      relays: ['ws://relay.example'],
      sharePublicKey: '33'.repeat(32),
    };

    await expect(latestStore?.saveProfile(profile)).rejects.toThrow(/already exists/i);
  });

  test('completeOnboarding returns the saved profile and refreshes state', async () => {
    const pendingProfile: PendingOnboardingProfile = {
      id: '55'.repeat(32),
      groupName: 'Onboarded Chrome signer',
      relays: ['ws://relay.example'],
      groupPublicKey: '66'.repeat(32),
      publicKey: '66'.repeat(32),
      sharePublicKey: '44'.repeat(32),
      peerPubkey: '77'.repeat(32),
      signerSettings: undefined,
      runtimeSnapshotJson: 'snapshot-json',
      profilePayload: {
        profileId: '55'.repeat(32),
        version: 1,
        groupName: 'Onboarded Chrome signer',
        device: {
          name: 'Onboarded Chrome signer',
          shareSecret: '88'.repeat(32),
          manualPeerPolicyOverrides: [],
          relays: ['ws://relay.example'],
        },
        groupPackage: {
          groupPk: '66'.repeat(32),
          threshold: 2,
          members: [],
        },
      },
    };
    const completedProfile: StoredExtensionProfile = {
      id: '55'.repeat(32),
      groupName: 'Onboarded Chrome signer',
      relays: ['ws://relay.example'],
      sharePublicKey: '44'.repeat(32),
    };

    mockClient.fetchExtensionState
      .mockResolvedValueOnce(makeState())
      .mockResolvedValueOnce(
        makeState({
          configured: true,
          profile: completedProfile,
          profiles: [makeProfileSummary({ id: completedProfile.id, label: 'Onboarded Chrome signer', unlocked: true })],
          activeProfileId: completedProfile.id,
        })
      );
    mockClient.completeOnboarding.mockResolvedValueOnce(completedProfile);

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <Harness onReady={(value) => { latestStore = value; }} />
      </StoreProvider>
    );

    await waitFor(() => expect(latestStore?.isHydratingProfile).toBe(false));

    let savedProfile: StoredExtensionProfile | undefined;
    await act(async () => {
      savedProfile = await latestStore?.completeOnboarding(
        pendingProfile,
        'Onboarded Chrome signer',
        'password123'
      );
    });

    expect(mockClient.completeOnboarding).toHaveBeenCalledWith(
      pendingProfile,
      'Onboarded Chrome signer',
      'password123'
    );
    expect(savedProfile).toEqual(completedProfile);
    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
      expect(latestStore?.profile?.id).toBe(completedProfile.id);
    });
  });

  test('activateProfile refreshes state after activation', async () => {
    const activatedProfile: StoredExtensionProfile = {
      id: '66'.repeat(32),
      groupName: 'Recovered profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '55'.repeat(32),
    };

    mockClient.fetchExtensionState
      .mockResolvedValueOnce(makeState())
      .mockResolvedValueOnce(
        makeState({
          configured: true,
          profile: activatedProfile,
          profiles: [makeProfileSummary({ id: activatedProfile.id, label: 'Recovered profile', unlocked: true })],
          activeProfileId: activatedProfile.id,
        })
      );
    mockClient.activateExtensionProfile.mockResolvedValueOnce(activatedProfile);

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <Harness onReady={(value) => { latestStore = value; }} />
      </StoreProvider>
    );

    await waitFor(() => expect(latestStore?.isHydratingProfile).toBe(false));

    await act(async () => {
      await latestStore?.activateProfile(activatedProfile.id);
    });

    expect(mockClient.activateExtensionProfile).toHaveBeenCalledWith(activatedProfile.id);
    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
      expect(latestStore?.profile?.id).toBe(activatedProfile.id);
    });
  });

  test('unlockProfile refreshes state after a successful unlock', async () => {
    const unlockedProfile: StoredExtensionProfile = {
      id: '88'.repeat(32),
      groupName: 'Unlocked profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '44'.repeat(32),
    };

    mockClient.fetchExtensionState
      .mockResolvedValueOnce(
        makeState({
          profiles: [makeProfileSummary({ id: unlockedProfile.id, label: 'Unlocked profile', unlocked: false })],
          activeProfileId: unlockedProfile.id,
        })
      )
      .mockResolvedValueOnce(
        makeState({
          configured: true,
          profile: unlockedProfile,
          profiles: [makeProfileSummary({ id: unlockedProfile.id, label: 'Unlocked profile', unlocked: true })],
          activeProfileId: unlockedProfile.id,
        })
      );
    mockClient.unlockExtensionProfile.mockResolvedValueOnce(unlockedProfile);

    let latestStore: ReturnType<typeof useStore> | undefined;
    render(
      <StoreProvider>
        <Harness onReady={(value) => { latestStore = value; }} />
      </StoreProvider>
    );

    await waitFor(() => expect(latestStore?.isHydratingProfile).toBe(false));

    await act(async () => {
      await latestStore?.unlockProfile(unlockedProfile.id, 'password123');
    });

    expect(mockClient.unlockExtensionProfile).toHaveBeenCalledWith(unlockedProfile.id, 'password123');
    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
      expect(latestStore?.profile?.id).toBe(unlockedProfile.id);
      expect(latestStore?.appState?.profiles[0]?.unlocked).toBe(true);
    });
  });
});
