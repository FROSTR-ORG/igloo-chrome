import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { StoreProvider, useStore } from '@/lib/store';
import { MESSAGE_TYPE, type ExtensionAppState, type StoredExtensionProfile } from '@/extension/protocol';

const runtimeListeners = new Set<(message: unknown) => void>();

const mockClient = vi.hoisted(() => ({
  fetchExtensionAppState: vi.fn(),
  saveExtensionProfile: vi.fn(),
  startOnboarding: vi.fn(),
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
    lifecycle: {
      onboarding: { stage: 'idle', lastError: null },
      activation: { stage: 'idle', lastError: null }
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
    mockClient.clearExtensionProfileState.mockResolvedValue(undefined);
    mockClient.sendRuntimeControl.mockResolvedValue(undefined);
  });

  test('hydrates from extension app state and switches route when configured', async () => {
    mockClient.fetchExtensionAppState.mockResolvedValue(
      makeState({
        configured: true,
        profile: {
          keysetName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey'
        }
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
          keysetName: 'Chrome signer',
          relays: ['ws://relay.example'],
          publicKey: 'pubkey'
        }
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
            keysetName: 'Chrome signer',
            relays: ['ws://relay.example'],
            publicKey: 'pubkey'
          }
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
});
