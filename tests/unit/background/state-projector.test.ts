import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  loadActiveProfileId,
  loadLifecycleStatus,
  loadPermissionPolicies,
  loadRuntimeDesiredActive,
  getChromeApi,
} = vi.hoisted(() => ({
  loadActiveProfileId: vi.fn(),
  loadLifecycleStatus: vi.fn(),
  loadPermissionPolicies: vi.fn(),
  loadRuntimeDesiredActive: vi.fn(),
  getChromeApi: vi.fn(),
}));

vi.mock('@/extension/storage', () => ({
  loadActiveProfileId,
  loadLifecycleStatus,
  loadPermissionPolicies,
  loadRuntimeDesiredActive,
}));

vi.mock('@/extension/chrome', () => ({
  getChromeApi,
}));

import { createPromptRegistry } from '@/background/prompt-registry';
import { createStateProjector } from '@/background/state-projector';

describe('state-projector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadActiveProfileId.mockResolvedValue('profile-1');
    loadLifecycleStatus.mockResolvedValue({
      onboarding: { stage: 'idle', updatedAt: null, lastError: null },
      activation: { stage: 'ready', updatedAt: 1, lastError: null, restoredFromSnapshot: true, runtime: 'ready' },
    });
    loadPermissionPolicies.mockResolvedValue([{ host: 'example.com', type: 'nostr.getPublicKey', allow: true }]);
    loadRuntimeDesiredActive.mockResolvedValue(true);
    getChromeApi.mockReturnValue({
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  test('projects runtime, lifecycle, profiles, and pending prompts into app state', async () => {
    const promptRegistry = createPromptRegistry();
    promptRegistry.set('request-1', {
      request: {
        id: 'request-1',
        host: 'example.com',
        origin: 'http://example.com',
        type: 'nostr.getPublicKey',
      },
      resolve: vi.fn(),
    });
    const profileService = {
      loadActiveRuntimeProfile: vi.fn().mockResolvedValue({
        runtimeProfile: {
          id: 'profile-1',
          groupName: 'Example',
          relays: ['ws://relay'],
          groupPublicKey: 'pubkey-1',
          signerSettings: { sign_timeout_secs: 30 },
        },
      }),
      loadStoredProfileRecords: vi.fn().mockResolvedValue([
        { id: 'profile-1', label: 'Example', createdAt: 1, updatedAt: 2 },
        { id: 'profile-2', label: 'Locked', createdAt: 3, updatedAt: 4 },
      ]),
      loadUnlockedProfileIds: vi.fn().mockResolvedValue(new Set(['profile-1'])),
      storedProfileSummaryFromRecord: vi.fn((record, unlocked) => ({
        ...record,
        unlocked: unlocked.has(record.id),
      })),
    };
    const projector = createStateProjector({
      profileService: profileService as never,
      promptRegistry,
      getRuntimeStatusSnapshot: vi.fn().mockResolvedValue({
        runtime: 'ready',
        status: {
          metadata: { group_public_key: 'pubkey-1' },
          readiness: { sign_ready: true, ecdh_ready: true },
          peers: [{ pubkey: 'peer-1' }],
          pending_operations: ['sign'],
        },
      }),
    });

    const state = await projector.buildAppState();

    expect(state.configured).toBe(true);
    expect(state.activeProfileId).toBe('profile-1');
    expect(state.pendingPrompts).toBe(1);
    expect(state.runtime.phase).toBe('ready');
    expect(state.runtime.peerStatus).toEqual([{ pubkey: 'peer-1' }]);
    expect(state.profiles).toEqual([
      { id: 'profile-1', label: 'Example', createdAt: 1, updatedAt: 2, unlocked: true },
      { id: 'profile-2', label: 'Locked', createdAt: 3, updatedAt: 4, unlocked: false },
    ]);
  });

  test('publishes state.changed through chrome runtime messaging', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    getChromeApi.mockReturnValue({
      runtime: {
        sendMessage,
      },
    });
    const projector = createStateProjector({
      profileService: {
        loadActiveRuntimeProfile: vi.fn().mockResolvedValue(null),
        loadStoredProfileRecords: vi.fn().mockResolvedValue([]),
        loadUnlockedProfileIds: vi.fn().mockResolvedValue(new Set()),
        storedProfileSummaryFromRecord: vi.fn(),
      } as never,
      promptRegistry: createPromptRegistry(),
      getRuntimeStatusSnapshot: vi.fn().mockResolvedValue({
        runtime: 'cold',
        status: null,
      }),
    });

    const state = await projector.publishStateChanged();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ext.state.changed',
      state,
    });
  });
});
