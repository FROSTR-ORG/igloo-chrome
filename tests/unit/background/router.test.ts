import { describe, expect, test, vi } from 'vitest';

import { COMMAND_TYPE, DEBUG_COMMAND_TYPE, PROVIDER_METHOD } from '@/extension/protocol';
import { createBackgroundRouter } from '@/background/router';

describe('background router', () => {
  test('routes state and runtime commands to the correct domain handlers', async () => {
    const buildAppState = vi.fn().mockResolvedValue({ configured: false });
    const startRuntime = vi.fn().mockResolvedValue({ ok: true, value: { started: true } });
    const sendResponse = vi.fn();
    const router = createBackgroundRouter({
      onboardingService: {
        startOnboarding: vi.fn().mockResolvedValue({
          ok: true,
          value: { pendingProfile: { id: 'pending-1' } },
        }),
        completeOnboarding: vi.fn().mockResolvedValue({
          ok: true,
          value: { profile: { id: 'profile-1' } },
        }),
        completeRotation: vi.fn().mockResolvedValue({
          ok: true,
          value: { profile: { id: 'profile-2' } },
        }),
      } as never,
      permissionService: {
        handleProviderRequest: vi.fn().mockResolvedValue({
          ok: false,
          error: new Error('User denied the request'),
        }),
        handlePromptResponse: vi.fn().mockResolvedValue({
          ok: true,
          value: { handled: true },
        }),
        clearAllPermissions: vi.fn().mockResolvedValue({
          ok: true,
          value: { cleared: true },
        }),
        revokePermission: vi.fn().mockResolvedValue({
          ok: true,
          value: { revoked: true },
        }),
      } as never,
      profileService: {
        normalizeProfileInput: vi.fn(),
      } as never,
      runtimeService: {
        getDiagnostics: vi.fn().mockResolvedValue({
          diagnostics: { runtime: 'cold', runtimeStatus: null, dropped: 0, diagnostics: [] },
        }),
        readConfiguredRuntimeConfig: vi.fn().mockResolvedValue({
          ok: true,
          value: { settings: { sign_timeout_secs: 60 } },
        }),
        updatePeerPolicy: vi.fn().mockResolvedValue({
          ok: true,
          value: { peerPermissionStates: [] },
        }),
        clearPeerPolicyOverrides: vi.fn().mockResolvedValue({
          ok: true,
          value: { peerPermissionStates: [] },
        }),
        startRuntime,
        stopRuntime: vi.fn().mockResolvedValue({ ok: true, value: { stopped: true } }),
        wipeRuntime: vi.fn().mockResolvedValue({ ok: true, value: { wiped: true } }),
        reloadConfiguredRuntime: vi.fn().mockResolvedValue({ ok: true, value: { reloaded: true } }),
        refreshPeers: vi.fn().mockResolvedValue({ ok: true, value: { refreshed: true } }),
        prepareRuntime: vi.fn().mockResolvedValue({
          ok: true,
          value: { runtime: 'ready', readiness: { sign_ready: true } },
        }),
        updateRuntimeConfig: vi.fn().mockResolvedValue({
          ok: true,
          value: { settings: { sign_timeout_secs: 30 } },
        }),
        ensureConfiguredRuntime: vi.fn().mockResolvedValue({ ok: true, value: { ensured: true } }),
      } as never,
      stateProjector: {
        buildAppState,
        publishStateChanged: vi.fn(),
      } as never,
    });

    expect(router({ type: COMMAND_TYPE.STATE_GET }, {} as never, sendResponse)).toBe(true);
    expect(router({ type: COMMAND_TYPE.RUNTIME_START }, {} as never, sendResponse)).toBe(true);
    expect(router({ type: DEBUG_COMMAND_TYPE.RELOAD }, {} as never, sendResponse)).toBe(true);
    expect(router({ type: 'ext.unknown' }, {} as never, sendResponse)).toBeUndefined();

    expect(buildAppState).toHaveBeenCalledOnce();
    expect(startRuntime).toHaveBeenCalledWith('runtime_start');
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { configured: false } });
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: true });
    });
  });

  test('preserves wire response shape for service success and failure envelopes', async () => {
    const sendResponse = vi.fn();
    const router = createBackgroundRouter({
      onboardingService: {
        startOnboarding: vi.fn().mockResolvedValue({
          ok: true,
          value: { pendingProfile: { id: 'pending-1', groupName: 'Pending' } },
        }),
        completeOnboarding: vi.fn().mockResolvedValue({
          ok: true,
          value: { profile: { id: 'profile-1' } },
        }),
        completeRotation: vi.fn().mockResolvedValue({
          ok: true,
          value: { profile: { id: 'profile-2' } },
        }),
      } as never,
      permissionService: {
        handleProviderRequest: vi.fn().mockResolvedValue({
          ok: false,
          error: new Error('provider denied'),
        }),
        handlePromptResponse: vi.fn().mockResolvedValue({
          ok: true,
          value: { handled: true },
        }),
        clearAllPermissions: vi.fn().mockResolvedValue({
          ok: true,
          value: { cleared: true },
        }),
        revokePermission: vi.fn().mockResolvedValue({
          ok: true,
          value: { revoked: true },
        }),
      } as never,
      profileService: {
        normalizeProfileInput: vi.fn(),
      } as never,
      runtimeService: {
        getDiagnostics: vi.fn().mockResolvedValue({
          diagnostics: { runtime: 'cold', runtimeStatus: null, dropped: 0, diagnostics: [] },
        }),
        readConfiguredRuntimeConfig: vi.fn().mockResolvedValue({
          ok: true,
          value: { settings: { sign_timeout_secs: 60 } },
        }),
        updatePeerPolicy: vi.fn().mockResolvedValue({
          ok: true,
          value: { peerPermissionStates: [] },
        }),
        clearPeerPolicyOverrides: vi.fn().mockResolvedValue({
          ok: true,
          value: { peerPermissionStates: [] },
        }),
        startRuntime: vi.fn().mockResolvedValue({
          ok: false,
          error: new Error('runtime exploded'),
        }),
        stopRuntime: vi.fn().mockResolvedValue({ ok: true, value: { stopped: true } }),
        wipeRuntime: vi.fn().mockResolvedValue({ ok: true, value: { wiped: true } }),
        reloadConfiguredRuntime: vi.fn().mockResolvedValue({ ok: true, value: { reloaded: true } }),
        refreshPeers: vi.fn().mockResolvedValue({ ok: true, value: { refreshed: true } }),
        prepareRuntime: vi.fn().mockResolvedValue({
          ok: true,
          value: { runtime: 'ready', readiness: { sign_ready: true } },
        }),
        updateRuntimeConfig: vi.fn().mockResolvedValue({
          ok: true,
          value: { settings: { sign_timeout_secs: 30 } },
        }),
        ensureConfiguredRuntime: vi.fn().mockResolvedValue({ ok: true, value: { ensured: true } }),
      } as never,
      stateProjector: {
        buildAppState: vi.fn().mockResolvedValue({ configured: false }),
        publishStateChanged: vi.fn(),
      } as never,
    });

    router(
      {
        type: COMMAND_TYPE.PROVIDER_REQUEST,
        request: { id: 'req-1', host: 'example.com', type: PROVIDER_METHOD.SIGN_EVENT, params: {} },
      } as never,
      {} as never,
      sendResponse
    );
    router({ type: COMMAND_TYPE.RUNTIME_START } as never, {} as never, sendResponse);
    router(
      {
        type: COMMAND_TYPE.ONBOARDING_START,
        input: { onboardPackage: 'pkg', onboardPassword: 'password-1' },
      } as never,
      {} as never,
      sendResponse
    );
    router(
      {
        type: COMMAND_TYPE.PROMPTS_RESPOND,
        id: 'req-1',
        allow: true,
        scope: 'once',
      } as never,
      {} as never,
      sendResponse
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'provider denied' });
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'runtime exploded' });
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: { id: 'pending-1', groupName: 'Pending' },
      });
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: true });
    });
  });
});
