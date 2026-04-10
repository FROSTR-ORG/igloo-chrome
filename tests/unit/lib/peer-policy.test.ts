import { describe, expect, test } from 'vitest';

import {
  normalizeStoredPeerPolicies,
  peerAllowsAllRequests,
  peerAllowsAllResponses,
} from '@/lib/peer-policy';

describe('peer policy normalization', () => {
  test('fills missing nested policy fields with safe defaults', () => {
    const [policy] = normalizeStoredPeerPolicies([
      {
        pubkey: 'ABCD',
        effectivePolicy: {},
        manualOverride: {},
        remoteObservation: {
          updated: 'nope',
          revision: 'nope',
        },
      },
    ]);

    expect(policy).toEqual({
      pubkey: 'abcd',
      manualOverride: {
        request: {
          ping: 'unset',
          onboard: 'unset',
          sign: 'unset',
          ecdh: 'unset',
        },
        respond: {
          ping: 'unset',
          onboard: 'unset',
          sign: 'unset',
          ecdh: 'unset',
        },
      },
      remoteObservation: {
        request: {
          ping: false,
          onboard: false,
          sign: false,
          ecdh: false,
        },
        respond: {
          ping: false,
          onboard: false,
          sign: false,
          ecdh: false,
        },
        updated: 0,
        revision: 0,
      },
      effectivePolicy: {
        request: {
          ping: false,
          onboard: false,
          sign: false,
          ecdh: false,
        },
        respond: {
          ping: false,
          onboard: false,
          sign: false,
          ecdh: false,
        },
      },
    });
  });

  test('derives aggregate peer permissions from normalized policy state', () => {
    const [policy] = normalizeStoredPeerPolicies([
      {
        pubkey: 'peer-1',
        effectivePolicy: {
          request: {
            ping: true,
            onboard: true,
            sign: true,
            ecdh: true,
          },
          respond: {
            ping: true,
            onboard: false,
            sign: true,
            ecdh: true,
          },
        },
      },
    ]);

    expect(peerAllowsAllRequests(policy)).toBe(true);
    expect(peerAllowsAllResponses(policy)).toBe(false);
  });
});
