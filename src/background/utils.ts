import type {
  LifecycleFailure,
  RuntimeLifecycleStatus,
  RuntimePhase,
  RuntimeStatusSummary,
} from '@/extension/protocol';
import { isRecord } from '@/extension/protocol';
import { publicKeyFromSecret } from '@/lib/igloo';

export const UNKNOWN_RUNTIME_LIFECYCLE: RuntimeLifecycleStatus = {
  bootMode: 'unknown',
  reason: null,
  updatedAt: null,
};

export function toErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return fallback;
}

export function activationFailure(
  code: LifecycleFailure['code'],
  message: string,
  source: LifecycleFailure['source'] = 'background'
): LifecycleFailure {
  return {
    code,
    message,
    source,
    updatedAt: Date.now(),
  };
}

export function profileKey(profile: {
  groupPublicKey?: string;
  publicKey?: string;
  relays: string[];
}) {
  const groupPublicKey =
    typeof profile.groupPublicKey === 'string' && profile.groupPublicKey.trim()
      ? profile.groupPublicKey
      : typeof profile.publicKey === 'string' && profile.publicKey.trim()
        ? profile.publicKey
        : undefined;
  return JSON.stringify({
    groupPublicKey: groupPublicKey?.trim().toLowerCase(),
    relays: profile.relays.map((relay) => relay.trim()),
  });
}

export function activationStageForRuntime(runtime: RuntimePhase) {
  switch (runtime) {
    case 'ready':
      return 'ready' as const;
    case 'degraded':
      return 'degraded' as const;
    case 'restoring':
      return 'restoring_runtime' as const;
    case 'cold':
    default:
      return 'idle' as const;
  }
}

export function responseOk(result: unknown) {
  return { ok: true, result };
}

export function responseError(error: unknown) {
  return { ok: false, error: toErrorMessage(error) };
}

export type ServiceSuccess<T> = {
  ok: true;
  value: T;
};

export type ServiceFailure<E extends Error> = {
  ok: false;
  error: E;
};

export type ServiceResult<T, E extends Error> = ServiceSuccess<T> | ServiceFailure<E>;

export function serviceOk<T>(value: T): ServiceSuccess<T> {
  return {
    ok: true,
    value,
  };
}

export function serviceError<E extends Error>(error: E): ServiceFailure<E> {
  return {
    ok: false,
    error,
  };
}

export function peerPermissionStatesFromStatus(status: RuntimeStatusSummary | null) {
  return status?.peer_permission_states ?? [];
}
