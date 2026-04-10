import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  clearRuntimePeerPolicyOverridesOnNode,
  connectSignerNode,
  createBrowserRuntimeNodeInit,
  createLogger,
  createObservabilityBuffer,
  createSignerNode,
  getRuntimeConfigFromNode,
  getRuntimeSnapshot,
  getRuntimeStatus,
  prepareEcdhOnNode,
  prepareSignOnNode,
  refreshAllPeersOnNode,
  signNostrEvent,
  stopSignerNode,
  summarizeRuntimeLifecycle,
  updateRuntimeConfigOnNode,
  updateRuntimePeerPolicyOverrideOnNode,
  wipeRuntimeStateOnNode,
  xOnlyFromCompressedPubkey,
  loadStoredProfileRecord,
  saveStoredProfileRecordIfPresent,
  decryptLocalProfileBlobWithSessionKey,
  reencryptLocalProfileBlobWithSessionKey,
} = vi.hoisted(() => ({
  clearRuntimePeerPolicyOverridesOnNode: vi.fn(),
  connectSignerNode: vi.fn(),
  createBrowserRuntimeNodeInit: vi.fn((profile: { relays: string[]; runtimeSnapshotJson?: string }) => ({
    config: {
      mode: profile.runtimeSnapshotJson ? 'persisted' : 'profile',
      relays: profile.relays,
      signerSettings: undefined,
    },
    restoreOptions: profile.runtimeSnapshotJson
      ? {
          runtimeSnapshotJson: profile.runtimeSnapshotJson,
        }
      : undefined,
  })),
  createLogger: vi.fn(() => ({
    debug: vi.fn(() => null),
    info: vi.fn(() => null),
    warn: vi.fn(() => null),
    error: vi.fn(() => null),
  })),
  createObservabilityBuffer: vi.fn(() => {
    const entries: unknown[] = [];
    return {
      push: vi.fn((entry: unknown) => {
        entries.push(entry);
      }),
      snapshot: vi.fn(() => [...entries]),
      dropped: vi.fn(() => 0),
    };
  }),
  createSignerNode: vi.fn(),
  getRuntimeConfigFromNode: vi.fn(() => ({ sign_timeout_secs: 30 })),
  getRuntimeSnapshot: vi.fn(() => ({ state: { nonce_pool: { peers: [] } } })),
  getRuntimeStatus: vi.fn(),
  prepareEcdhOnNode: vi.fn(),
  prepareSignOnNode: vi.fn(),
  refreshAllPeersOnNode: vi.fn(),
  signNostrEvent: vi.fn(),
  stopSignerNode: vi.fn(),
  summarizeRuntimeLifecycle: vi.fn(() => ({ bootMode: 'unknown', reason: null, updatedAt: null })),
  updateRuntimeConfigOnNode: vi.fn(),
  updateRuntimePeerPolicyOverrideOnNode: vi.fn(),
  wipeRuntimeStateOnNode: vi.fn(),
  xOnlyFromCompressedPubkey: vi.fn((value: string) => value.replace(/^(02|03)/, '').toLowerCase()),
  loadStoredProfileRecord: vi.fn(),
  saveStoredProfileRecordIfPresent: vi.fn(),
  decryptLocalProfileBlobWithSessionKey: vi.fn(),
  reencryptLocalProfileBlobWithSessionKey: vi.fn(),
}));

vi.mock('@/lib/igloo', () => ({
  clearRuntimePeerPolicyOverridesOnNode,
  connectSignerNode,
  createBrowserRuntimeNodeInit,
  createLogger,
  createObservabilityBuffer,
  createSignerNode,
  getRuntimeConfigFromNode,
  getRuntimeSnapshot,
  getRuntimeStatus,
  prepareEcdhOnNode,
  prepareSignOnNode,
  refreshAllPeersOnNode,
  signNostrEvent,
  stopSignerNode,
  summarizeRuntimeLifecycle,
  updateRuntimeConfigOnNode,
  updateRuntimePeerPolicyOverrideOnNode,
  wipeRuntimeStateOnNode,
  xOnlyFromCompressedPubkey,
}));

vi.mock('@/extension/storage', () => ({
  loadStoredProfileRecord,
  saveStoredProfileRecordIfPresent,
}));

vi.mock('@/lib/profile-blob', () => ({
  decryptLocalProfileBlobWithSessionKey,
  reencryptLocalProfileBlobWithSessionKey,
}));

import { createRuntimeHostController } from '@/lib/runtime-host/controller';

function createNode() {
  const node = new EventEmitter() as EventEmitter & { shutdown?: () => Promise<void> };
  node.shutdown = vi.fn().mockResolvedValue(undefined);
  return node;
}

function createReadyStatus() {
  return {
    status: { device_id: 'device', pending_ops: 0, last_active: 1, known_peers: 0, request_seq: 1 },
    metadata: {
      device_id: 'device',
      member_idx: 1,
      share_public_key: 'share',
      group_public_key: 'group',
      peers: [],
    },
    readiness: {
      runtime_ready: true,
      restore_complete: true,
      sign_ready: true,
      ecdh_ready: true,
      threshold: 1,
      signing_peer_count: 1,
      ecdh_peer_count: 1,
      last_refresh_at: 1,
      degraded_reasons: [],
    },
    peers: [],
    peer_permission_states: [],
    pending_operations: [],
  };
}

describe('runtime-host controller', () => {
  const profile = {
    id: 'profile-1',
    relays: ['ws://relay'],
    runtimeSnapshotJson: '{}',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createSignerNode.mockImplementation(() => createNode());
    connectSignerNode.mockResolvedValue(undefined);
    getRuntimeStatus.mockReturnValue(createReadyStatus());
    prepareSignOnNode.mockResolvedValue({ sign_ready: true });
    prepareEcdhOnNode.mockResolvedValue({ ecdh_ready: true });
    signNostrEvent.mockResolvedValue({ id: 'signed-1' });
    loadStoredProfileRecord.mockResolvedValue(null);
    saveStoredProfileRecordIfPresent.mockResolvedValue(true);
    decryptLocalProfileBlobWithSessionKey.mockResolvedValue({});
    reencryptLocalProfileBlobWithSessionKey.mockResolvedValue({ version: 1 });
  });

  test('cleans up failed session boot and publishes a cold status update', async () => {
    const node = createNode();
    createSignerNode.mockReturnValue(node);
    connectSignerNode.mockRejectedValue(new Error('connect failed'));
    const listener = vi.fn();
    const controller = createRuntimeHostController();
    controller.setRuntimeHostStatusListener(listener);

    await expect(controller.ensureRuntime(profile as never, undefined, 'session-key')).rejects.toThrow('connect failed');

    expect(node.shutdown).toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith({
      runtime: 'cold',
      status: null,
    });
  });

  test('returns sign readiness even when background persistence fails', async () => {
    const controller = createRuntimeHostController();

    await controller.ensureRuntime(profile as never, undefined, 'session-key');
    loadStoredProfileRecord.mockRejectedValue(new Error('persist failed'));

    await expect(controller.prepareSign()).resolves.toEqual({
      runtime: 'ready',
      readiness: { sign_ready: true },
    });
    expect(prepareSignOnNode).toHaveBeenCalled();
  });

  test('returns signed provider results even when snapshot persistence cannot be saved', async () => {
    const controller = createRuntimeHostController();

    loadStoredProfileRecord.mockRejectedValue(new Error('persist failed'));
    await controller.ensureRuntime(profile as never, undefined, 'session-key');

    await expect(
      controller.executeProviderMethod({
        profile: profile as never,
        sessionKeyB64: 'session-key',
        method: 'nostr.signEvent',
        params: {
          event: { kind: 1, content: 'hello' },
        },
      })
    ).resolves.toEqual({ id: 'signed-1' });
  });

  test('stops cleanly after a live session even when final persistence fails', async () => {
    const listener = vi.fn();
    const controller = createRuntimeHostController();
    controller.setRuntimeHostStatusListener(listener);

    await controller.ensureRuntime(profile as never, undefined, 'session-key');
    loadStoredProfileRecord.mockRejectedValue(new Error('persist failed'));

    await expect(controller.stopRuntime()).resolves.toEqual({ runtime: 'cold' });
    expect(listener).toHaveBeenLastCalledWith({
      runtime: 'cold',
      status: null,
    });
  });

  test('coalesces runtime-status persistence into a draining background queue', async () => {
    const node = createNode();
    createSignerNode.mockReturnValue(node);
    let releasePersist: (() => void) | null = null;
    let firstCall = true;
    loadStoredProfileRecord.mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return new Promise((resolve) => {
          releasePersist = () => resolve({
            id: 'profile-1',
            blob: { version: 1 },
            createdAt: 1,
            updatedAt: 1,
          });
        });
      }
      return Promise.resolve({
        id: 'profile-1',
        blob: { version: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const controller = createRuntimeHostController();

    await controller.ensureRuntime(profile as never, undefined, 'session-key');
    const session = await controller._private.requireSession();
    node.emit('runtime-status', createReadyStatus());
    node.emit('runtime-status', createReadyStatus());
    node.emit('runtime-status', createReadyStatus());

    expect(loadStoredProfileRecord).toHaveBeenCalledTimes(1);
    expect(session.persistInFlight).not.toBeNull();
    expect(session.persistQueued).toBe(true);
    releasePersist?.();
    await vi.waitFor(() => {
      expect(session.persistInFlight).toBeNull();
    });
  });

  test('replaces the runtime status listener without leaking the old callback', async () => {
    const listenerOne = vi.fn();
    const listenerTwo = vi.fn();
    const controller = createRuntimeHostController();

    controller.setRuntimeHostStatusListener(listenerOne);
    controller.setRuntimeHostStatusListener(listenerTwo);
    await controller.ensureRuntime(profile as never, undefined, 'session-key');

    expect(listenerOne).not.toHaveBeenCalled();
    expect(listenerTwo).toHaveBeenCalledWith({
      runtime: 'ready',
      status: createReadyStatus(),
    });
  });

  test('continues draining the background queue after a persistence failure', async () => {
    const node = createNode();
    createSignerNode.mockReturnValue(node);
    loadStoredProfileRecord
      .mockRejectedValueOnce(new Error('persist failed'))
      .mockResolvedValue({
        id: 'profile-1',
        blob: { version: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
    const controller = createRuntimeHostController();

    await controller.ensureRuntime(profile as never, undefined, 'session-key');
    const session = await controller._private.requireSession();
    node.emit('runtime-status', createReadyStatus());
    node.emit('runtime-status', createReadyStatus());

    await vi.waitFor(() => {
      expect(loadStoredProfileRecord.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(session.persistInFlight).toBeNull();
    });
  });
});
