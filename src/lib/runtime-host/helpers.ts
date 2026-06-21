import {
  getRuntimeStatus,
  stopSignerNode,
  type BrowserBridgeNode,
} from '@/lib/igloo';
import { toErrorMessage as sharedToErrorMessage } from 'igloo-shared';
import type { RuntimePhase, StoredExtensionProfile } from '@/extension/protocol';
import type { SignerSession } from '@/lib/runtime-host/types';

export function toErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return sharedToErrorMessage(error, fallback);
}

export function profileIdKey(profile: StoredExtensionProfile) {
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

export async function shutdownNode(node: BrowserBridgeNode) {
  const candidate = node as BrowserBridgeNode & { shutdown?: () => Promise<void> };
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
