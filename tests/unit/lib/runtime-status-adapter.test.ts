import { describe, expect, test } from 'vitest';

import {
  adaptRuntimeDiagnosticsSnapshot,
  adaptRuntimeSnapshotDetails,
  adaptRuntimeStatusSnapshot,
  adaptRuntimeStatusSummary,
  adaptRuntimeStatusUpdate,
} from '@/lib/runtime-status-adapter';

describe('runtime-status-adapter', () => {
  test('maps shared peer permission state into extension storage shape', () => {
    const status = adaptRuntimeStatusSummary({
      status: {
        device_id: 'device-1',
        pending_ops: 0,
        last_active: 10,
        known_peers: 1,
        request_seq: 2,
      },
      metadata: {
        device_id: 'device-1',
        member_idx: 0,
        share_public_key: 'share-1',
        group_public_key: 'group-1',
        peers: ['peer-1'],
      },
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: true,
        ecdh_ready: true,
        threshold: 2,
        signing_peer_count: 2,
        ecdh_peer_count: 2,
        last_refresh_at: 100,
        degraded_reasons: ['relay_slow'],
      },
      peers: [
        {
          idx: 1,
          pubkey: 'peer-1',
          known: true,
          last_seen: 100,
          online: true,
          incoming_available: 8,
          outgoing_available: 5,
          outgoing_spent: 0,
          can_sign: true,
          should_send_nonces: false,
        },
      ],
      peer_permission_states: [
        {
          pubkey: 'peer-1',
          manual_override: {
            request: { ping: 'allow', onboard: 'unset', sign: 'deny', ecdh: 'allow' },
            respond: { ping: 'unset', onboard: 'allow', sign: 'allow', ecdh: 'deny' },
          },
          remote_observation: {
            request: { ping: true, onboard: false, sign: true, ecdh: true },
            respond: { ping: true, onboard: true, sign: false, ecdh: true },
            updated: 15,
            revision: 2,
          },
          effective_policy: {
            request: { ping: true, onboard: false, sign: false, ecdh: true },
            respond: { ping: true, onboard: true, sign: true, ecdh: false },
          },
        },
      ],
      pending_operations: [],
    });

    expect(status).toMatchObject({
      peer_permission_states: [
        {
          pubkey: 'peer-1',
          manualOverride: {
            request: { ping: 'allow', onboard: 'unset', sign: 'deny', ecdh: 'allow' },
            respond: { ping: 'unset', onboard: 'allow', sign: 'allow', ecdh: 'deny' },
          },
          remoteObservation: {
            request: { ping: true, onboard: false, sign: true, ecdh: true },
            respond: { ping: true, onboard: true, sign: false, ecdh: true },
            updated: 15,
            revision: 2,
          },
          effectivePolicy: {
            request: { ping: true, onboard: false, sign: false, ecdh: true },
            respond: { ping: true, onboard: true, sign: true, ecdh: false },
          },
        },
      ],
      readiness: {
        degraded_reasons: ['relay_slow'],
      },
    });
  });

  test('normalizes missing peer permission states to an empty array', () => {
    const status = adaptRuntimeStatusSummary({
      status: {
        device_id: 'device-1',
        pending_ops: 0,
        last_active: 10,
        known_peers: 0,
        request_seq: 0,
      },
      metadata: {
        device_id: 'device-1',
        member_idx: 0,
        share_public_key: 'share-1',
        group_public_key: 'group-1',
        peers: [],
      },
      readiness: {
        runtime_ready: false,
        restore_complete: false,
        sign_ready: false,
        ecdh_ready: false,
        threshold: 2,
        signing_peer_count: 0,
        ecdh_peer_count: 0,
        last_refresh_at: null,
        degraded_reasons: [],
      },
      peers: [],
      peer_permission_states: undefined as never,
      pending_operations: [],
    });

    expect(status?.peer_permission_states).toEqual([]);
  });

  test('adapts snapshot, diagnostics, and status update wrappers consistently', () => {
    const sharedStatus = {
      status: {
        device_id: 'device-1',
        pending_ops: 1,
        last_active: 10,
        known_peers: 1,
        request_seq: 2,
      },
      metadata: {
        device_id: 'device-1',
        member_idx: 0,
        share_public_key: 'share-1',
        group_public_key: 'group-1',
        peers: ['peer-1'],
      },
      readiness: {
        runtime_ready: true,
        restore_complete: true,
        sign_ready: false,
        ecdh_ready: true,
        threshold: 2,
        signing_peer_count: 1,
        ecdh_peer_count: 2,
        last_refresh_at: 100,
        degraded_reasons: ['insufficient_signing_peers'],
      },
      peers: [],
      peer_permission_states: [],
      pending_operations: [],
    };

    expect(adaptRuntimeStatusSnapshot({ runtime: 'degraded', status: sharedStatus })).toEqual({
      runtime: 'degraded',
      status: adaptRuntimeStatusSummary(sharedStatus),
    });
    expect(
      adaptRuntimeSnapshotDetails({
        runtime: 'degraded',
        status: sharedStatus,
        snapshot: { state_hex: '00', bootstrap: null, status: sharedStatus.status, state: { version: 1, last_active: 1, request_seq: 1, replay_cache_size: 0, ecdh_cache_size: 0, sig_cache_size: 0, manual_policy_overrides: {}, remote_scoped_policies: {}, pending_operations: {}, nonce_pool: { peers: [] } } },
        snapshotError: null,
        lifecycle: {
          bootMode: 'restored',
          reason: 'test',
          updatedAt: 10,
        },
      })
    ).toMatchObject({
      runtime: 'degraded',
      status: adaptRuntimeStatusSummary(sharedStatus),
      snapshotError: null,
      runtimeLifecycle: {
        bootMode: 'restored',
        reason: 'test',
        updatedAt: 10,
      },
    });
    expect(
      adaptRuntimeDiagnosticsSnapshot(
        {
          runtime: 'degraded',
          diagnostics: [],
          dropped: 0,
          runtimeStatus: sharedStatus,
        },
        {
          runtime: 'degraded',
          status: adaptRuntimeStatusSummary(sharedStatus),
          snapshot: null,
          snapshotError: null,
          runtimeLifecycle: {
            bootMode: 'restored',
            reason: null,
            updatedAt: 11,
          },
        }
      )
    ).toMatchObject({
      runtimeStatus: adaptRuntimeStatusSummary(sharedStatus),
      runtimeSnapshot: null,
      runtimeSnapshotError: null,
      runtimeLifecycle: {
        bootMode: 'restored',
        reason: null,
        updatedAt: 11,
      },
    });
    expect(adaptRuntimeStatusUpdate({ runtime: 'degraded', status: sharedStatus })).toEqual({
      runtime: 'degraded',
      status: adaptRuntimeStatusSummary(sharedStatus),
    });
  });
});
