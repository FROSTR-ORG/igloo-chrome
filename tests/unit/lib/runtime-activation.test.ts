import { describe, expect, test } from 'vitest';

import { deriveRuntimePresentation } from '@/lib/runtime-activation';

describe('deriveRuntimePresentation', () => {
  test('formats failed activation with a retry-oriented message', () => {
    const presentation = deriveRuntimePresentation(
      'failed',
      'cold',
      'Offscreen document timed out after 10000ms',
    );

    expect(presentation.runtimeState).toBe('stopped');
    expect(presentation.runtimeControlLabel).toBe('Retry Runtime');
    expect(presentation.runtimeSummaryLabel).toBe('Runtime failed');
    expect(presentation.runtimeError).toContain('Signer activation failed before the extension runtime became ready.');
    expect(presentation.runtimeError).toContain('Offscreen document timed out after 10000ms');
  });

  test('treats offscreen startup stages as connecting', () => {
    const presentation = deriveRuntimePresentation('waiting_offscreen_ready', 'cold', null);

    expect(presentation.runtimeState).toBe('connecting');
    expect(presentation.runtimeControlLabel).toBe('Starting...');
    expect(presentation.runtimeSummaryLabel).toBe('Waiting for offscreen runtime');
    expect(presentation.runtimeError).toBeNull();
  });

  test('treats ready runtime as running', () => {
    const presentation = deriveRuntimePresentation('ready', 'ready', null);

    expect(presentation.runtimeState).toBe('running');
    expect(presentation.runtimeControlLabel).toBe('Stop Signer');
    expect(presentation.runtimeSummaryLabel).toBe('Signer Running');
  });
});
