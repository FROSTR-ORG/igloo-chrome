import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { StoreProvider, useStore } from '@/lib/store';
import {
  MESSAGE_TYPE,
  type ExtensionAppState,
  type PendingOnboardingProfile,
  type StoredExtensionProfile,
  type StoredProfileSummary
} from '@/extension/protocol';

const runtimeListeners = new Set<(message: unknown) => void>();

const mockClient = vi.hoisted(() => ({
  fetchExtensionAppState: vi.fn(),
  saveExtensionProfile: vi.fn(),
  startOnboarding: vi.fn(),
  completeOnboarding: vi.fn(),
  importBfprofile: vi.fn(),
  recoverBfshare: vi.fn(),
  activateExtensionProfile: vi.fn(),
  unlockExtensionProfile: vi.fn(),
  clearExtensionProfileState: vi.fn(),
  sendRuntimeControl: vi.fn()
}));

const mockChrome = vi.hoisted(() => ({
  getChromeApi: vi.fn()
}));

vi.mock('@/extension/client', () => mockClient);
vi.mock('@/extension/chrome', () => mockChrome);

function makeState(overrides: Partial<ExtensionAppState> = {}): ExtensionAppState {
  return {
    configured: false,
    profile: null,
    profiles: [],
    activeProfileId: null,
    lifecycle: {
      onboarding: { stage: 'idle', updatedAt: null, lastError: null },
      activation: { stage: 'idle', updatedAt: null, lastError: null, restoredFromSnapshot: false, runtime: 'cold' }
    },
    runtime: {
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
        updatedAt: null
      },
      lastError: null
    },
    permissionPolicies: [],
    pendingPrompts: 0,
    ...overrides
  };
}

function Harness({ onReady }: { onReady: (value: ReturnType<typeof useStore>) => void }) {
  const store = useStore();

  React.useEffect(() => {
    onReady(store);
  }, [onReady, store]);

  return <div>{store.route}</div>;
}

function makeProfileSummary(overrides: Partial<StoredProfileSummary> = {}): StoredProfileSummary {
  return {
    id: '11'.repeat(32),
    label: 'Chrome signer',
    createdAt: 1,
    updatedAt: 1,
    unlocked: false,
    ...overrides
  };
}

describe('igloo-chrome StoreProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeListeners.clear();
    mockChrome.getChromeApi.mockReturnValue({
      runtime: {
        onMessage: {
          addListener: (listener: (message: unknown) => void) => runtimeListeners.add(listener),
          removeListener: (listener: (message: unknown) => void) => runtimeListeners.delete(listener)
        }
      }
    });
    mockClient.fetchExtensionAppState.mockResolvedValue(makeState());
    mockClient.saveExtensionProfile.mockImplementation(async (profile) => profile);
    mockClient.startOnboarding.mockResolvedValue(undefined);
    mockClient.completeOnboarding.mockImplementation(async (pendingProfile, label) => ({
      id: pendingProfile.id,
      keysetName: label,
      relays: pendingProfile.relays,
      sharePublicKey: pendingProfile.sharePublicKey,
    }));
    mockClient.importBfprofile.mockImplementation(async (packageText: string, password: string) => ({
      id: 'aa'.repeat(32),
      keysetName: 'Imported profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '11'.repeat(32),
    }));
    mockClient.recoverBfshare.mockImplementation(async () => ({
      id: 'bb'.repeat(32),
      keysetName: 'Recovered profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '22'.repeat(32),
    }));
    mockClient.activateExtensionProfile.mockImplementation(async (profileId: string) => ({
      id: profileId,
      keysetName: 'Activated profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '33'.repeat(32),
    }));
    mockClient.unlockExtensionProfile.mockImplementation(async (profileId: string) => ({
      id: profileId,
      keysetName: 'Unlocked profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '44'.repeat(32),
    }));
    mockClient.clearExtensionProfileState.mockResolvedValue(undefined);
    mockClient.sendRuntimeControl.mockResolvedValue(undefined);
  });

  test('hydrates from extension app state and switches route when configured', async () => {
    mockClient.fetchExtensionAppState.mockResolvedValue(
      makeState({
        configured: true,
        profile: {
          id: '11'.repeat(32),
          keysetName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey'
        },
        profiles: [{
          id: '11'.repeat(32),
          keysetName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey'
        }],
        activeProfileId: '11'.repeat(32)
      })
    );

    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
      expect(latestStore?.profile?.keysetName).toBe('Chrome signer');
      expect(latestStore?.isHydratingProfile).toBe(false);
    });
  });

  test('derives the last onboarding failure from extension state updates', async () => {
    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.isHydratingProfile).toBe(false);
    });

    const nextState = makeState({
      lifecycle: {
        onboarding: {
          stage: 'failed',
          lastError: { message: 'Onboarding timed out', code: 'onboard_timeout', source: 'offscreen', updatedAt: 1 }
        },
        activation: { stage: 'idle', lastError: null }
      }
    });

    await act(async () => {
      for (const listener of runtimeListeners) {
        listener({
          type: MESSAGE_TYPE.APP_STATE_UPDATED,
          state: nextState
        });
      }
    });

    await waitFor(() => {
      expect(latestStore?.lastOnboardingFailure).toEqual({
        message: 'Onboarding timed out'
      });
    });

    await act(async () => {
      latestStore?.clearOnboardingFailure();
    });
    await waitFor(() => {
      expect(latestStore?.lastOnboardingFailure).toBeNull();
    });
  });

  test('logout clears configured state and requests runtime stop', async () => {
    mockClient.fetchExtensionAppState.mockResolvedValue(
      makeState({
        configured: true,
        profile: {
          id: '11'.repeat(32),
          keysetName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey'
        },
        profiles: [{
          id: '11'.repeat(32),
          keysetName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey'
        }],
        activeProfileId: '11'.repeat(32)
      })
    );

    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
    });

    await act(async () => {
      latestStore?.logout();
    });

    expect(mockClient.sendRuntimeControl).toHaveBeenCalledWith('stopRuntime');
    expect(mockClient.clearExtensionProfileState).toHaveBeenCalled();
    await waitFor(() => {
      expect(latestStore?.route).toBe('onboarding');
      expect(latestStore?.profile).toBeUndefined();
    });
  });

  test('wipeAllData requests runtime cleanup and refreshes app state', async () => {
    mockClient.fetchExtensionAppState
      .mockResolvedValueOnce(
        makeState({
          configured: true,
          profile: {
            id: '11'.repeat(32),
            keysetName: 'Chrome signer',
            relays: ['ws://relay.example'],
            publicKey: 'pubkey'
          },
          profiles: [{
            id: '11'.repeat(32),
            keysetName: 'Chrome signer',
            relays: ['ws://relay.example'],
            publicKey: 'pubkey'
          }],
          activeProfileId: '11'.repeat(32)
        })
      )
      .mockResolvedValueOnce(makeState());

    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
    });

    await act(async () => {
      await latestStore!.wipeAllData();
    });

    expect(mockClient.sendRuntimeControl).toHaveBeenNthCalledWith(1, 'wipeRuntime');
    expect(mockClient.sendRuntimeControl).toHaveBeenNthCalledWith(2, 'stopRuntime');
    expect(mockClient.clearExtensionProfileState).toHaveBeenCalled();
    await waitFor(() => {
      expect(latestStore?.route).toBe('onboarding');
    });
  });

  test('saveProfile surfaces duplicate-profile failures', async () => {
    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.isHydratingProfile).toBe(false);
    });

    mockClient.saveExtensionProfile.mockRejectedValueOnce(new Error('Device profile Chrome signer already exists.'));

    const profile: StoredExtensionProfile = {
      id: '77'.repeat(32),
      keysetName: 'Chrome signer',
      relays: ['ws://relay.example'],
      sharePublicKey: '33'.repeat(32),
    };

    await expect(latestStore?.saveProfile(profile)).rejects.toThrow(/already exists/i);
  });

  test('completeOnboarding returns the saved profile and refreshes app state', async () => {
    const pendingProfile: PendingOnboardingProfile = {
      id: '55'.repeat(32),
      keysetName: 'Onboarded Chrome signer',
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
        device: {
          name: 'Onboarded Chrome signer',
          shareSecret: '88'.repeat(32),
          manualPeerPolicyOverrides: [],
          remotePeerPolicyObservations: [],
          relays: ['ws://relay.example']
        },
        group: {
          keysetName: 'Onboarded Chrome signer',
          groupPublicKey: '66'.repeat(32),
          threshold: 2,
          totalCount: 3,
          members: []
        }
      }
    };
    const completedProfile: StoredExtensionProfile = {
      id: '55'.repeat(32),
      keysetName: 'Onboarded Chrome signer',
      relays: ['ws://relay.example'],
      sharePublicKey: '44'.repeat(32),
    };

    mockClient.fetchExtensionAppState
      .mockResolvedValueOnce(makeState())
      .mockResolvedValueOnce(
        makeState({
          configured: true,
          profile: completedProfile,
          profiles: [completedProfile],
          activeProfileId: completedProfile.id,
        }),
      );

    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.isHydratingProfile).toBe(false);
    });

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

  test('activateProfile refreshes app state after activation', async () => {
    const activatedProfile: StoredExtensionProfile = {
      id: '66'.repeat(32),
      keysetName: 'Recovered profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '55'.repeat(32),
    };

    mockClient.fetchExtensionAppState
      .mockResolvedValueOnce(makeState())
      .mockResolvedValueOnce(
        makeState({
          configured: true,
          profile: activatedProfile,
          profiles: [activatedProfile],
          activeProfileId: activatedProfile.id,
        }),
      );
    mockClient.activateExtensionProfile.mockResolvedValueOnce(activatedProfile);

    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.isHydratingProfile).toBe(false);
    });

    await act(async () => {
      await latestStore?.activateProfile(activatedProfile.id);
    });

    expect(mockClient.activateExtensionProfile).toHaveBeenCalledWith(activatedProfile.id);
    await waitFor(() => {
      expect(latestStore?.route).toBe('signer');
      expect(latestStore?.profile?.id).toBe(activatedProfile.id);
    });
  });

  test('unlockProfile refreshes app state after a successful unlock', async () => {
    const unlockedProfile: StoredExtensionProfile = {
      id: '88'.repeat(32),
      keysetName: 'Unlocked profile',
      relays: ['ws://relay.example'],
      sharePublicKey: '44'.repeat(32),
    };

    mockClient.fetchExtensionAppState
      .mockResolvedValueOnce(
        makeState({
          profiles: [makeProfileSummary({ id: unlockedProfile.id, label: 'Unlocked profile', unlocked: false })],
          activeProfileId: unlockedProfile.id
        })
      )
      .mockResolvedValueOnce(
        makeState({
          configured: true,
          profile: unlockedProfile,
          profiles: [makeProfileSummary({ id: unlockedProfile.id, label: 'Unlocked profile', unlocked: true })],
          activeProfileId: unlockedProfile.id
        })
      );
    mockClient.unlockExtensionProfile.mockResolvedValueOnce(unlockedProfile);

    let latestStore: ReturnType<typeof useStore> | undefined;
    const onReady = (value: ReturnType<typeof useStore>) => {
      latestStore = value;
    };

    render(
      <StoreProvider>
        <Harness onReady={onReady} />
      </StoreProvider>
    );

    await waitFor(() => {
      expect(latestStore?.isHydratingProfile).toBe(false);
    });

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
