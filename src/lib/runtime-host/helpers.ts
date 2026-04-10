import {
  getRuntimeStatus,
  stopSignerNode,
  type NodeWithEvents,
} from '@/lib/igloo';
import type { RuntimePhase, StoredExtensionProfile } from '@/extension/protocol';
import type { SignerSession } from '@/lib/runtime-host/types';

export function toErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}

export function profileKey(profile: StoredExtensionProfile) {
  return profile.id.trim().toLowerCase();
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export async function shutdownNode(node: NodeWithEvents) {
  const candidate = node as NodeWithEvents & { shutdown?: () => Promise<void> };
  if (typeof candidate.shutdown === 'function') {
    await candidate.shutdown();
    return;
  }
  stopSignerNode(node);
}

export function resolveRuntimePhase(session: Pick<SignerSession, 'node'>): RuntimePhase {
  const status = getRuntimeStatus(session.node);
  const readiness = status.readiness;
  if (!readiness.runtime_ready || !readiness.restore_complete) {
    if (readiness.sign_ready || readiness.ecdh_ready) {
      return 'degraded';
    }
    return 'restoring';
  }
  if (!readiness.sign_ready && !readiness.ecdh_ready && status.peers.length > 0) {
    return 'degraded';
  }
  return 'ready';
}
