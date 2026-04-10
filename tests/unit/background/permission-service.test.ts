import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getChromeApi,
  clearPermissionPolicies,
  removePermissionPolicy,
  resolvePermissionDecision,
  savePermissionDecision,
} = vi.hoisted(() => ({
  getChromeApi: vi.fn(),
  clearPermissionPolicies: vi.fn(),
  removePermissionPolicy: vi.fn(),
  resolvePermissionDecision: vi.fn(),
  savePermissionDecision: vi.fn(),
}));

vi.mock('@/extension/chrome', () => ({
  getChromeApi,
}));

vi.mock('@/extension/storage', () => ({
  clearPermissionPolicies,
  removePermissionPolicy,
  resolvePermissionDecision,
  savePermissionDecision,
}));

import { createPermissionService, PermissionServiceError } from '@/background/permission-service';
import { createPromptRegistry } from '@/background/prompt-registry';
import { COMMAND_TYPE, PROVIDER_METHOD } from '@/extension/protocol';

describe('permission-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChromeApi.mockReturnValue({
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
      },
      windows: {
        create: vi.fn().mockResolvedValue({ id: 99 }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    });
    resolvePermissionDecision.mockResolvedValue(null);
    savePermissionDecision.mockResolvedValue(undefined);
    clearPermissionPolicies.mockResolvedValue(undefined);
    removePermissionPolicy.mockResolvedValue(undefined);
  });

  test('bypasses prompts when a stored decision already exists', async () => {
    resolvePermissionDecision.mockResolvedValue(true);
    const executeProviderMethod = vi.fn().mockResolvedValue('pubkey-1');
    const service = createPermissionService({
      promptRegistry: createPromptRegistry(),
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      executeProviderMethod,
    });

    const result = await service.handleProviderRequest({
      id: 'request-1',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    expect(result).toEqual({ ok: true, value: { result: 'pubkey-1' } });
    expect(executeProviderMethod).toHaveBeenCalledOnce();
    expect(getChromeApi().windows.create).not.toHaveBeenCalled();
  });

  test('rejects immediately when a stored deny decision already exists', async () => {
    resolvePermissionDecision.mockResolvedValue(false);
    const executeProviderMethod = vi.fn();
    const service = createPermissionService({
      promptRegistry: createPromptRegistry(),
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      executeProviderMethod,
    });

    const result = await service.handleProviderRequest({
      id: 'request-deny',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'request_denied',
        message: 'User denied the request',
      },
    });

    expect(executeProviderMethod).not.toHaveBeenCalled();
    expect(getChromeApi().windows.create).not.toHaveBeenCalled();
  });

  test('persists non-once approvals and resolves the prompt window', async () => {
    const promptRegistry = createPromptRegistry();
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    const service = createPermissionService({
      promptRegistry,
      publishStateChanged,
      executeProviderMethod: vi.fn().mockResolvedValue('ok'),
    });

    const requestPromise = service.handleProviderRequest({
      id: 'request-2',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    await vi.waitFor(() => {
      expect(promptRegistry.get('request-2')?.windowId).toBe(99);
    });

    await expect(
      service.handlePromptResponse({
      type: COMMAND_TYPE.PROMPTS_RESPOND,
      id: 'request-2',
      allow: true,
      scope: 'forever',
      })
    ).resolves.toEqual({ ok: true, value: { handled: true } });

    await expect(requestPromise).resolves.toEqual({ ok: true, value: { result: 'ok' } });
    expect(savePermissionDecision).toHaveBeenCalledWith(
      'example.com',
      PROVIDER_METHOD.GET_PUBLIC_KEY,
      true,
      undefined,
      'forever'
    );
    expect(getChromeApi().windows.remove).toHaveBeenCalledWith(99);
    expect(promptRegistry.size()).toBe(0);
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('does not call the runtime when the prompt is explicitly denied', async () => {
    const promptRegistry = createPromptRegistry();
    const executeProviderMethod = vi.fn();
    const service = createPermissionService({
      promptRegistry,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      executeProviderMethod,
    });

    const requestPromise = service.handleProviderRequest({
      id: 'request-denied',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    await vi.waitFor(() => {
      expect(promptRegistry.get('request-denied')?.windowId).toBe(99);
    });

    await expect(
      service.handlePromptResponse({
      type: COMMAND_TYPE.PROMPTS_RESPOND,
      id: 'request-denied',
      allow: false,
      scope: 'once',
      })
    ).resolves.toEqual({ ok: true, value: { handled: true } });

    await expect(requestPromise).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'request_denied',
        message: 'User denied the request',
      },
    });
    expect(executeProviderMethod).not.toHaveBeenCalled();
  });

  test('propagates runtime failure after an allowed prompt without swallowing the error', async () => {
    const promptRegistry = createPromptRegistry();
    const executeProviderMethod = vi.fn().mockRejectedValue(new Error('runtime exploded'));
    const service = createPermissionService({
      promptRegistry,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      executeProviderMethod,
    });

    const requestPromise = service.handleProviderRequest({
      id: 'request-runtime-fail',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    await vi.waitFor(() => {
      expect(promptRegistry.get('request-runtime-fail')?.windowId).toBe(99);
    });

    await expect(
      service.handlePromptResponse({
      type: COMMAND_TYPE.PROMPTS_RESPOND,
      id: 'request-runtime-fail',
      allow: true,
      scope: 'once',
      })
    ).resolves.toEqual({ ok: true, value: { handled: true } });

    await expect(requestPromise).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'runtime_execution_failed',
        message: 'runtime exploded',
      },
    });
    expect(executeProviderMethod).toHaveBeenCalledOnce();
  });

  test('clears prompt state when creating the prompt window fails', async () => {
    const promptRegistry = createPromptRegistry();
    const publishStateChanged = vi.fn().mockResolvedValue(undefined);
    getChromeApi().windows.create.mockRejectedValueOnce(new Error('window create failed'));
    const service = createPermissionService({
      promptRegistry,
      publishStateChanged,
      executeProviderMethod: vi.fn(),
    });

    const result = await service.handleProviderRequest({
      id: 'request-create-fail',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'prompt_create_failed',
        message: 'window create failed',
      },
    });

    expect(promptRegistry.size()).toBe(0);
    expect(publishStateChanged).toHaveBeenCalled();
  });

  test('denies a request when the prompt window is closed', async () => {
    const promptRegistry = createPromptRegistry();
    const service = createPermissionService({
      promptRegistry,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      executeProviderMethod: vi.fn(),
    });

    const requestPromise = service.handleProviderRequest({
      id: 'request-3',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    await vi.waitFor(() => {
      expect(promptRegistry.get('request-3')?.windowId).toBe(99);
    });
    await expect(service.handlePromptWindowRemoved(99)).resolves.toEqual({
      ok: true,
      value: { closed: true },
    });

    await expect(requestPromise).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'request_denied',
        message: 'User denied the request',
      },
    });
    expect(promptRegistry.size()).toBe(0);
  });

  test('ignores a late prompt response after the prompt window was already closed', async () => {
    const promptRegistry = createPromptRegistry();
    const executeProviderMethod = vi.fn();
    const service = createPermissionService({
      promptRegistry,
      publishStateChanged: vi.fn().mockResolvedValue(undefined),
      executeProviderMethod,
    });

    const requestPromise = service.handleProviderRequest({
      id: 'request-late-response',
      host: 'example.com',
      origin: 'http://example.com',
      type: PROVIDER_METHOD.GET_PUBLIC_KEY,
    });

    await vi.waitFor(() => {
      expect(promptRegistry.get('request-late-response')?.windowId).toBe(99);
    });
    await expect(service.handlePromptWindowRemoved(99)).resolves.toEqual({
      ok: true,
      value: { closed: true },
    });
    await expect(
      service.handlePromptResponse({
      type: COMMAND_TYPE.PROMPTS_RESPOND,
      id: 'request-late-response',
      allow: true,
      scope: 'forever',
      })
    ).resolves.toEqual({ ok: true, value: { handled: false } });

    await expect(requestPromise).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'request_denied',
        message: 'User denied the request',
      },
    });
    expect(executeProviderMethod).not.toHaveBeenCalled();
    expect(savePermissionDecision).not.toHaveBeenCalled();
  });
});
