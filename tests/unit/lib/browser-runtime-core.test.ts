import { getPublicKey } from 'nostr-tools';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

const mockState = vi.hoisted(() => ({
  bootstrapMode: 'seeded' as 'seeded' | 'empty' | 'publish_fail',
  shareSecret: '44'.repeat(32),
  localSharePubkey: '',
  bootstrapPeerPubkey: '22'.repeat(32),
  groupPublicKey: '33'.repeat(32),
  group: {
    group_name: 'Playwright Runtime',
    group_pk: '33'.repeat(32),
    threshold: 2,
    members: [
      { idx: 1, pubkey: '' },
      { idx: 2, pubkey: '22'.repeat(32) },
    ],
  },
  latestBootstrap: null as Record<string, unknown> | null,
  latestRuntimeStatus: null as Record<string, unknown> | null,
  handledCommands: [] as string[],
}));

vi.mock('../../../../igloo-shared/src/bridge-wasm-runtime', () => {
  class FakeRuntime {
    init_runtime(_runtimeConfigJson: string, bootstrapJson: string) {
      const bootstrap = JSON.parse(bootstrapJson) as {
        initial_peer_nonces?: Array<{ peer: string; nonces: string[] }>;
      };
      mockState.latestBootstrap = bootstrap as Record<string, unknown>;
      const nonceCount =
        Array.isArray(bootstrap.initial_peer_nonces) && bootstrap.initial_peer_nonces.length > 0
          ? bootstrap.initial_peer_nonces[0]?.nonces?.length ?? 0
          : 0;
      const signReady = nonceCount > 0;
      mockState.latestRuntimeStatus = {
        status: {
          device_id: 'device-1',
          pending_ops: 0,
          last_active: 0,
          known_peers: 1,
          request_seq: 0,
        },
        metadata: {
          device_id: 'device-1',
          member_idx: 1,
          share_public_key: mockState.localSharePubkey,
          group_public_key: mockState.groupPublicKey,
          peers: [mockState.bootstrapPeerPubkey],
        },
        readiness: {
          runtime_ready: true,
          restore_complete: true,
          sign_ready: signReady,
          ecdh_ready: true,
          threshold: 2,
          signing_peer_count: signReady ? 1 : 0,
          ecdh_peer_count: 1,
          last_refresh_at: 1,
          degraded_reasons: signReady ? [] : ['insufficient_signing_peers'],
        },
        peers: [
          {
            idx: 2,
            pubkey: mockState.bootstrapPeerPubkey,
            known: true,
            last_seen: null,
            online: true,
            incoming_available: nonceCount,
            outgoing_available: 50,
            outgoing_spent: 0,
            can_sign: signReady,
            should_send_nonces: true,
          },
        ],
        peer_permission_states: [],
        pending_operations: [],
      };
    }

    restore_runtime() {
      throw new Error('restore_runtime should not be called in profile bootstrap tests');
    }

    handle_command(commandJson: string) {
      mockState.handledCommands.push(commandJson);
      return undefined;
    }

    tick() {
      return undefined;
    }

    drain_outbound_events() {
      return '[]';
    }

    drain_completions() {
      return '[]';
    }

    drain_failures() {
      return '[]';
    }

    snapshot_state() {
      return JSON.stringify({
        state: {
          nonce_pool: {
            peers: (mockState.latestRuntimeStatus?.peers as unknown[]) ?? [],
          },
        },
      });
    }

    status() {
      return JSON.stringify(mockState.latestRuntimeStatus?.status ?? {});
    }

    peer_permission_states() {
      return '[]';
    }

    read_config() {
      return JSON.stringify({});
    }

    update_config() {
      return undefined;
    }

    peer_status() {
      return JSON.stringify(mockState.latestRuntimeStatus?.peers ?? []);
    }

    readiness() {
      return JSON.stringify(mockState.latestRuntimeStatus?.readiness ?? {});
    }

    runtime_status() {
      return JSON.stringify(mockState.latestRuntimeStatus ?? {});
    }

    runtime_diagnostics() {
      return '[]';
    }

    drain_runtime_events() {
      return '[]';
    }

    wipe_state() {
      return undefined;
    }

    runtime_metadata() {
      return JSON.stringify(mockState.latestRuntimeStatus?.metadata ?? {});
    }

    set_policy_override() {
      return undefined;
    }

    clear_policy_overrides() {
      return undefined;
    }
  }

  return {
    createWasmBridgeRuntime: async () => new FakeRuntime(),
    getWasmBridgeOnboardingApi: async () => ({
      create_onboarding_request_bundle: () =>
        JSON.stringify({
          request_id: 'request-1',
          local_pubkey32: mockState.localSharePubkey,
          request_nonces: ['request-nonce'],
          bootstrap_state_hex: 'aa',
          event_json: JSON.stringify({
            id: 'request-event',
            kind: 20000,
            pubkey: mockState.localSharePubkey,
            created_at: 1,
            tags: [['p', mockState.bootstrapPeerPubkey]],
            content: 'ciphertext',
            sig: 'sig',
          }),
        }),
      build_onboarding_runtime_snapshot: () =>
        JSON.stringify({
          bootstrap: {
            group: mockState.group,
            share: {
              idx: 1,
              seckey: mockState.shareSecret,
            },
          },
          state_hex: 'aa',
        }),
    }),
    getWasmProfilePackageApi: async () => ({
      decode_bfonboard_package: () =>
        JSON.stringify({
          shareSecret: mockState.shareSecret,
          relays: ['ws://127.0.0.1:4848'],
          peerPubkey: mockState.bootstrapPeerPubkey,
        }),
    }),
  };
});

async function loadBrowserRuntimeCore() {
  return await import('../../../../igloo-shared/src/browser-runtime-core');
}

function attachLogBuffer(node: { on: (event: string, handler: (...args: unknown[]) => void) => void }) {
  const logs: Array<Record<string, unknown>> = [];
  node.on('message', (entry) => {
    if (entry && typeof entry === 'object') {
      logs.push(entry as Record<string, unknown>);
    }
  });
  return logs;
}

async function buildProfileNode() {
  const { createSignerNode } = await loadBrowserRuntimeCore();
  const node = createSignerNode({
    mode: 'profile',
    relays: ['ws://127.0.0.1:4848'],
    bootstrapPeerPubkey32Hex: mockState.bootstrapPeerPubkey,
    groupPackageJson: JSON.stringify(mockState.group),
    sharePackageJson: JSON.stringify({
      idx: 1,
      seckey: mockState.shareSecret,
    }),
  }) as {
    connectActiveRelays: () => Promise<void>;
    requestOnboardResponse: () => Promise<{
      response: {
        group: typeof mockState.group;
        nonces: string[];
      };
      bundle: {
        request_id: string;
        local_pubkey32: string;
        request_nonces: string[];
        bootstrap_state_hex: string;
        event_json: string;
      };
    }>;
    connectedRelays: Set<string>;
    activeRelays: string[];
    subscribeRelayIngress: (sinceUnixSecs: number) => void;
  };

  node.connectActiveRelays = async function connectActiveRelays() {
    this.connectedRelays = new Set(this.activeRelays);
  };

  node.requestOnboardResponse = async function requestOnboardResponse() {
    if (mockState.bootstrapMode === 'publish_fail') {
      throw new Error('Failed to publish onboard request to relays (request_id=request-1)');
    }

    return {
      response: {
        group: mockState.group,
        nonces: mockState.bootstrapMode === 'seeded' ? ['nonce-a', 'nonce-b'] : [],
      },
      bundle: {
        request_id: 'request-1',
        local_pubkey32: mockState.localSharePubkey,
        request_nonces: ['request-nonce'],
        bootstrap_state_hex: 'aa',
        event_json: '{}',
      },
    };
  };

  node.subscribeRelayIngress = function subscribeRelayIngress() {
    return undefined;
  };

  return node;
}

describe('browser-runtime-core profile bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    mockState.bootstrapMode = 'seeded';
    mockState.localSharePubkey = getPublicKey(hexToBytes(mockState.shareSecret)).toLowerCase();
    mockState.group.members[0] = { idx: 1, pubkey: mockState.localSharePubkey };
    mockState.latestBootstrap = null;
    mockState.latestRuntimeStatus = null;
    mockState.handledCommands = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('seeds incoming peer nonces for profile bootstrap when a bootstrap peer is configured', async () => {
    const { connectSignerNode, getRuntimeReadiness } = await loadBrowserRuntimeCore();
    const node = await buildProfileNode();

    try {
      await connectSignerNode(node);

      expect(mockState.latestBootstrap?.initial_peer_nonces).toEqual([
        {
          peer: mockState.bootstrapPeerPubkey,
          nonces: ['nonce-a', 'nonce-b'],
        },
      ]);
      expect(mockState.handledCommands).toContain(JSON.stringify({ type: 'refresh_all_peers' }));
      expect(getRuntimeReadiness(node).sign_ready).toBe(true);
    } finally {
      await (node as { shutdown: () => Promise<void> }).shutdown();
    }
  });

  test('continues profile bootstrap when the bootstrap response contains no nonces', async () => {
    mockState.bootstrapMode = 'empty';
    const { connectSignerNode, getRuntimeReadiness } = await loadBrowserRuntimeCore();
    const node = await buildProfileNode();
    const logs = attachLogBuffer(node);

    try {
      await connectSignerNode(node);

      expect(mockState.latestBootstrap?.initial_peer_nonces).toEqual([]);
      expect(getRuntimeReadiness(node).sign_ready).toBe(false);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'profile_bootstrap_nonces_empty' }),
        ])
      );
    } finally {
      await (node as { shutdown: () => Promise<void> }).shutdown();
    }
  });

  test('continues profile bootstrap when bootstrap nonce fetch fails', async () => {
    mockState.bootstrapMode = 'publish_fail';
    const { connectSignerNode, getRuntimeReadiness } = await loadBrowserRuntimeCore();
    const node = await buildProfileNode();
    const logs = attachLogBuffer(node);

    try {
      await connectSignerNode(node);

      expect(mockState.latestBootstrap?.initial_peer_nonces).toEqual([]);
      expect(getRuntimeReadiness(node).sign_ready).toBe(false);
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'profile_bootstrap_nonces_failed' }),
        ])
      );
    } finally {
      await (node as { shutdown: () => Promise<void> }).shutdown();
    }
  });
});
