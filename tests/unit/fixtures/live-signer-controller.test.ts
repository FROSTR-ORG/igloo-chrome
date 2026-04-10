import { beforeEach, describe, expect, test, vi } from 'vitest';

import { __testing } from '../../../../../test/igloo-chrome/fixtures/live-signer';

describe('stable live signer controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('currentForTest restores a clean responder baseline before reuse', async () => {
    const controller = Object.create(__testing.SharedLiveSignerController.prototype) as any;
    const baseProfile = {
      groupName: 'Playwright Live',
      relays: ['ws://127.0.0.1:19111'],
      publicKey: 'group-pubkey',
      peerPubkey: 'peer-pubkey',
    };

    controller.baseProfile = baseProfile;
    controller.currentProfile = {
      ...baseProfile,
      groupName: 'Mutated Profile',
      relays: ['ws://127.0.0.1:29999'],
    };
    controller.demoDir = '/tmp/demo-2of3';
    controller.relay = {
      url: () => 'ws://127.0.0.1:19111',
    };
    controller.ensureRelay = vi.fn().mockResolvedValue(undefined);
    controller.stopResponderProcess = vi.fn().mockResolvedValue(undefined);
    controller.restoreResponderSnapshot = vi.fn().mockResolvedValue(undefined);
    controller.ensureResponder = vi.fn().mockResolvedValue(undefined);
    controller.primeOnboardNoncePool = vi.fn().mockResolvedValue(100);

    const fixture = await controller.currentForTest();

    expect(controller.ensureRelay).toHaveBeenCalledOnce();
    expect(controller.stopResponderProcess).toHaveBeenCalledOnce();
    expect(controller.restoreResponderSnapshot).toHaveBeenCalledOnce();
    expect(controller.ensureResponder).toHaveBeenCalledOnce();
    expect(controller.primeOnboardNoncePool).toHaveBeenCalledOnce();
    expect(controller.currentProfile).toEqual(baseProfile);
    expect(controller.currentProfile).not.toBe(baseProfile);
    expect(fixture.profile).toEqual(baseProfile);
    expect(fixture.profile).not.toBe(baseProfile);
  });

  test('resetForTest restarts relay state and returns a clean cloned profile', async () => {
    const controller = Object.create(__testing.SharedLiveSignerController.prototype) as any;
    const baseProfile = {
      groupName: 'Playwright Live',
      relays: ['ws://127.0.0.1:19112'],
      publicKey: 'group-pubkey',
      peerPubkey: 'peer-pubkey',
    };
    const relayStop = vi.fn().mockResolvedValue(undefined);

    controller.baseProfile = baseProfile;
    controller.currentProfile = {
      ...baseProfile,
      groupName: 'Dirty Profile',
    };
    controller.relay = {
      url: () => 'ws://127.0.0.1:19112',
      stop: relayStop,
    };
    controller.ensureRelay = vi.fn().mockResolvedValue(undefined);
    controller.stopResponderProcess = vi.fn().mockResolvedValue(undefined);
    controller.restoreResponderSnapshot = vi.fn().mockResolvedValue(undefined);
    controller.ensureResponder = vi.fn().mockResolvedValue(undefined);
    controller.primeOnboardNoncePool = vi.fn().mockResolvedValue(100);

    const fixture = await controller.resetForTest();

    expect(relayStop).toHaveBeenCalledOnce();
    expect(controller.ensureRelay).toHaveBeenCalledOnce();
    expect(controller.stopResponderProcess).toHaveBeenCalledOnce();
    expect(controller.restoreResponderSnapshot).toHaveBeenCalledOnce();
    expect(controller.ensureResponder).toHaveBeenCalledOnce();
    expect(controller.primeOnboardNoncePool).toHaveBeenCalledOnce();
    expect(controller.currentProfile).toEqual(baseProfile);
    expect(controller.currentProfile).not.toBe(baseProfile);
    expect(fixture.profile).toEqual(baseProfile);
  });
});
