import { describe, expect, test, vi, beforeEach } from 'vitest';

describe('observability', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('redacts sensitive fields when creating events', async () => {
    vi.stubEnv('VITE_IGLOO_DEBUG', '1');
    const { createObservabilityEvent } = await import('@/lib/observability');

    const event = createObservabilityEvent('info', 'test', 'runtime', 'created', {
      password: 'secret-password',
      runtimeSnapshotJson: '{"private":true}',
      relay: 'ws://relay.example'
    });

    expect(event.password).toBe('[redacted:password:len=15]');
    expect(event.runtimeSnapshotJson).toBe('[redacted:runtimesnapshotjson:len=16]');
    expect(event.relay).toBe('ws://relay.example');
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
