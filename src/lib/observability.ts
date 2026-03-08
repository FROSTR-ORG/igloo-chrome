export type ObservabilityLevel = 'debug' | 'info' | 'warn' | 'error';

export type ObservabilityEvent = {
  ts: number;
  level: ObservabilityLevel;
  component: string;
  domain: string;
  event: string;
  message?: string;
  [key: string]: unknown;
};

type ObservabilityBuffer = {
  push: (event: ObservabilityEvent) => void;
  snapshot: () => ObservabilityEvent[];
  dropped: () => number;
};

const LOG_LEVEL_RANK: Record<ObservabilityLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const DEBUG_ENABLED = import.meta.env.VITE_IGLOO_DEBUG === '1';
const VERBOSE_ENABLED = DEBUG_ENABLED || import.meta.env.VITE_IGLOO_VERBOSE === '1';
const ACTIVE_LEVEL: ObservabilityLevel = DEBUG_ENABLED
  ? 'debug'
  : VERBOSE_ENABLED
    ? 'info'
    : 'warn';

function shouldEmit(level: ObservabilityLevel) {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[ACTIVE_LEVEL];
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactField(key, entry)
      ])
    );
  }
  return String(value);
}

function redactField(key: string, value: unknown): unknown {
  const normalized = key.toLowerCase();
  if (
    normalized.includes('password') ||
    normalized.includes('onboardpackage') ||
    normalized.includes('secret') ||
    normalized.includes('seckey') ||
    normalized.includes('nonce') ||
    normalized === 'snapshot' ||
    normalized === 'snapshotjson' ||
    normalized === 'runtimesnapshotjson' ||
    normalized === 'state_hex'
  ) {
    if (typeof value === 'string') {
      return `[redacted:${normalized}:len=${value.length}]`;
    }
    return `[redacted:${normalized}]`;
  }
  return sanitizeValue(value);
}

function sanitizeDetails(detail?: Record<string, unknown>) {
  if (!detail) return undefined;
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [key, redactField(key, value)])
  );
}

function emitConsole(event: ObservabilityEvent) {
  const serialized = JSON.stringify(event);
  switch (event.level) {
    case 'debug':
      console.debug(serialized);
      break;
    case 'info':
      console.info(serialized);
      break;
    case 'warn':
      console.warn(serialized);
      break;
    case 'error':
      console.error(serialized);
      break;
  }
}

export function createObservabilityBuffer(limit = 500): ObservabilityBuffer {
  const events: ObservabilityEvent[] = [];
  let dropped = 0;

  return {
    push(event) {
      events.push(event);
      if (events.length > limit) {
        dropped += events.length - limit;
        events.splice(0, events.length - limit);
      }
    },
    snapshot() {
      return events.slice();
    },
    dropped() {
      return dropped;
    }
  };
}

export function createObservabilityEvent(
  level: ObservabilityLevel,
  component: string,
  domain: string,
  event: string,
  detail?: Record<string, unknown>
): ObservabilityEvent {
  return {
    ts: Date.now(),
    level,
    component,
    domain,
    event,
    ...(sanitizeDetails(detail) ?? {})
  };
}

export function createLogger(component: string, sink?: ObservabilityBuffer) {
  const write = (
    level: ObservabilityLevel,
    domain: string,
    event: string,
    detail?: Record<string, unknown>
  ) => {
    if (!shouldEmit(level)) return null;
    const nextEvent = createObservabilityEvent(level, component, domain, event, detail);
    sink?.push(nextEvent);
    emitConsole(nextEvent);
    return nextEvent;
  };

  return {
    level: ACTIVE_LEVEL,
    isVerbose: VERBOSE_ENABLED,
    isDebug: DEBUG_ENABLED,
    debug(domain: string, event: string, detail?: Record<string, unknown>) {
      return write('debug', domain, event, detail);
    },
    info(domain: string, event: string, detail?: Record<string, unknown>) {
      return write('info', domain, event, detail);
    },
    warn(domain: string, event: string, detail?: Record<string, unknown>) {
      return write('warn', domain, event, detail);
    },
    error(domain: string, event: string, detail?: Record<string, unknown>) {
      return write('error', domain, event, detail);
    }
  };
}

export function summarizeRuntimeLifecycle(events: ObservabilityEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const entry = events[index];
    if (entry.domain !== 'runtime') continue;
    if (entry.event === 'restored') {
      return {
        bootMode: 'restored' as const,
        reason: null,
        updatedAt: entry.ts
      };
    }
    if (entry.event === 'restore_skipped') {
      return {
        bootMode: 'cold_boot' as const,
        reason: typeof entry.reason === 'string' ? entry.reason : null,
        updatedAt: entry.ts
      };
    }
    if (entry.event === 'bootstrap_complete') {
      return {
        bootMode: 'cold_boot' as const,
        reason: null,
        updatedAt: entry.ts
      };
    }
  }

  return {
    bootMode: 'unknown' as const,
    reason: null,
    updatedAt: null
  };
}
