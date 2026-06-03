import { describe, expect, test, vi, beforeEach } from 'vitest';

describe('observability', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('keeps allow-listed fields and drops everything else (fail-closed)', async () => {
    vi.stubEnv('VITE_IGLOO_DEBUG', '1');
    const { createObservabilityEvent } = await import('@/lib/observability');

    // The shared redactor (Bucket D) is an allow-list, not a marker-based
    // deny-list: EVENT_SCHEMAS['relay']['probe_failed'] permits exactly
    // ['relay', 'error_message']; any other field — including secret-bearing
    // ones — is DROPPED (it never appears in the event), so it cannot leak.
    const event = createObservabilityEvent('warn', 'test', 'relay', 'probe_failed', {
      relay: 'ws://relay.example',
      error_message: 'connect timeout',
      password: 'secret-password',
      runtimeSnapshotJson: '{"private":true}'
    });

    expect(event.relay).toBe('ws://relay.example');
    expect(event.error_message).toBe('connect timeout');
    // Dropped — undefined, NOT a redaction marker.
    expect(event.password).toBeUndefined();
    expect(event.runtimeSnapshotJson).toBeUndefined();
  });

  test('drops every field for an unregistered (domain, action) pair', async () => {
    const { createObservabilityEvent } = await import('@/lib/observability');

    // 'runtime'/'created' is not a registered schema entry -> fail closed.
    const event = createObservabilityEvent('info', 'test', 'runtime', 'created', {
      password: 'secret-password',
      relay: 'ws://relay.example'
    });

    expect(event.password).toBeUndefined();
    expect(event.relay).toBeUndefined();
  });

  test('drops oldest events when the buffer limit is exceeded', async () => {
    const { createObservabilityBuffer } = await import('@/lib/observability');
    const buffer = createObservabilityBuffer(2);

    buffer.push({ ts: 1, level: 'warn', component: 'a', domain: 'runtime', event: 'one' });
    buffer.push({ ts: 2, level: 'warn', component: 'a', domain: 'runtime', event: 'two' });
    buffer.push({ ts: 3, level: 'warn', component: 'a', domain: 'runtime', event: 'three' });

    expect(buffer.snapshot().map((event) => event.event)).toEqual(['two', 'three']);
    expect(buffer.dropped()).toBe(1);
  });

  test('summarizes runtime lifecycle from the newest matching event', async () => {
    const { summarizeRuntimeLifecycle } = await import('@/lib/observability');

    expect(
      summarizeRuntimeLifecycle([
        { ts: 1, level: 'info', component: 'a', domain: 'runtime', event: 'bootstrap_complete' },
        { ts: 2, level: 'info', component: 'a', domain: 'runtime', event: 'restored' }
      ])
    ).toEqual({
      bootMode: 'restored',
      reason: null,
      updatedAt: 2
    });
  });
});
