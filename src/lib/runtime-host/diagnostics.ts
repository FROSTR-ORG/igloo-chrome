import {
  createLogger,
  createObservabilityBuffer,
  type BrowserBridgeNode,
  type ObservabilityEvent,
} from '@/lib/igloo';
import { toErrorMessage } from '@/lib/runtime-host/helpers';

const logger = createLogger('igloo.runtime-worker');

export function createPendingBootDiagnostics() {
  let buffer = createObservabilityBuffer(200);

  return {
    reset() {
      buffer = createObservabilityBuffer(200);
    },
    push(
      level: 'debug' | 'info' | 'warn' | 'error',
      domain: string,
      event: string,
      detail?: Record<string, unknown>
    ) {
      const entry = logger[level](domain, event, detail);
      if (entry) {
        buffer.push(entry);
      }
    },
    snapshot() {
      return buffer.snapshot();
    },
    dropped() {
      return buffer.dropped();
    },
  };
}

export function attachDiagnostics(node: BrowserBridgeNode) {
  const diagnostics = createObservabilityBuffer(500);

  const messageHandler = (payload: unknown) => {
    if (
      payload &&
      typeof payload === 'object' &&
      typeof (payload as Record<string, unknown>).ts === 'number' &&
      typeof (payload as Record<string, unknown>).level === 'string' &&
      typeof (payload as Record<string, unknown>).component === 'string' &&
      typeof (payload as Record<string, unknown>).domain === 'string' &&
      typeof (payload as Record<string, unknown>).event === 'string'
    ) {
      diagnostics.push(payload as ObservabilityEvent);
      return;
    }

    const event = logger.warn('runtime', 'unstructured_message', {
      payload: payload && typeof payload === 'object' ? payload : { value: payload },
    });
    if (event) {
      diagnostics.push(event);
    }
  };

  const errorHandler = (payload: unknown) => {
    const event = logger.error('runtime', 'node_error', {
      error_message: toErrorMessage(payload),
    });
    if (event) {
      diagnostics.push(event);
    }
  };

  node.on('message', messageHandler);
  node.on('error', errorHandler);

  return {
    diagnostics: diagnostics.snapshot,
    dropped: diagnostics.dropped,
    detach: () => {
      if (typeof node.off === 'function') {
        node.off('message', messageHandler);
        node.off('error', errorHandler);
      } else if (typeof node.removeListener === 'function') {
        node.removeListener('message', messageHandler);
        node.removeListener('error', errorHandler);
      }
    },
  };
}

export function attachOnboardingLogBuffer(node: BrowserBridgeNode) {
  const lines: string[] = [];

  const onMessage = (payload: unknown) => {
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const domain = typeof record.domain === 'string' ? record.domain : 'runtime';
      const event = typeof record.event === 'string' ? record.event : 'message';
      const detail = typeof record.error_message === 'string' ? ` error=${record.error_message}` : '';
      lines.push(`[info] ${domain}.${event}${detail}`);
      return;
    }
    lines.push(`[info] ${String(payload)}`);
  };
  const onError = (payload: unknown) => {
    lines.push(`[error] ${toErrorMessage(payload)}`);
  };

  node.on('message', onMessage);
  node.on('error', onError);

  return {
    collect: () => [...lines],
    detach: () => {
      if (typeof node.off === 'function') {
        node.off('message', onMessage);
        node.off('error', onError);
      } else if (typeof node.removeListener === 'function') {
        node.removeListener('message', onMessage);
        node.removeListener('error', onError);
      }
    },
  };
}
