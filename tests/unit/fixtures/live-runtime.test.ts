import { describe, expect, test } from 'vitest';

import {
  unwrapRuntimePrepareReadinessResult,
  waitForLiveEcdhReady,
} from '../../../../../test/igloo-chrome/support/live-runtime';

describe('live runtime helper', () => {
  test('unwraps nested runtime.prepare readiness payloads', () => {
    const readiness = {
      runtime: 'degraded' as const,
      readiness: {
        runtime: 'degraded' as const,
        readiness: {
          runtime_ready: false,
          restore_complete: false,
          sign_ready: true,
          ecdh_ready: true,
          threshold: 1,
          signing_peer_count: 1,
          ecdh_peer_count: 1,
          last_refresh_at: 1_775_251_033,
          degraded_reasons: ['pending_operations_recovered'],
        },
      },
    };

    expect(unwrapRuntimePrepareReadinessResult(readiness)).toEqual(readiness.readiness);
  });

  test('uses the nested runtime.prepare readiness payload for ecdh readiness', async () => {
    const prepareRuntimeReadiness = async () => ({
      runtime: 'degraded' as const,
      readiness: {
        runtime: 'degraded' as const,
        readiness: {
          runtime_ready: false,
          restore_complete: false,
          sign_ready: false,
          ecdh_ready: true,
          threshold: 1,
          signing_peer_count: 0,
          ecdh_peer_count: 1,
          last_refresh_at: 1_775_251_033,
          degraded_reasons: ['pending_operations_recovered', 'insufficient_signing_peers'],
        },
      },
    });

    await expect(
      waitForLiveEcdhReady(prepareRuntimeReadiness, 'nested prepare readiness')
    ).resolves.toBeUndefined();
  });
});
