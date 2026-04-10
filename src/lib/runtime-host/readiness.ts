import { getRuntimeSnapshot, type NodeWithEvents } from '@/lib/igloo';

const NONCE_SNAPSHOT_WAIT_TIMEOUT_MS = 5_000;
const NONCE_SNAPSHOT_POLL_INTERVAL_MS = 100;

export function snapshotHasUsableNonces(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const state = (snapshot as { state?: unknown }).state;
  if (!state || typeof state !== 'object') return false;
  const noncePool = (state as { nonce_pool?: unknown }).nonce_pool;
  if (!noncePool || typeof noncePool !== 'object') return false;
  const peers = (noncePool as { peers?: unknown }).peers;
  if (!Array.isArray(peers)) return false;
  return peers.some((peer) => {
    if (!peer || typeof peer !== 'object') return false;
    const incoming = (peer as { incoming_available?: unknown }).incoming_available;
    const outgoing = (peer as { outgoing_available?: unknown }).outgoing_available;
    return (
      (typeof incoming === 'number' && incoming > 0) ||
      (typeof outgoing === 'number' && outgoing > 0)
    );
  });
}

export async function waitForNonceSnapshot(node: NodeWithEvents) {
  const startedAt = Date.now();
  let lastSnapshot: unknown = null;
  while (Date.now() - startedAt < NONCE_SNAPSHOT_WAIT_TIMEOUT_MS) {
    lastSnapshot = getRuntimeSnapshot(node);
    if (snapshotHasUsableNonces(lastSnapshot)) {
      return lastSnapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, NONCE_SNAPSHOT_POLL_INTERVAL_MS));
  }
  return lastSnapshot ?? getRuntimeSnapshot(node);
}
