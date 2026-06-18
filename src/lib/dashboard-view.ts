import { nip19 } from 'nostr-tools';

import type { DashboardKeyModel } from 'igloo-ui';

// Build a copyable key model (truncated npub display + full npub + hex) from a
// 32-byte x-only public key hex, for the signer dashboard's split-copy KeyRow.
// Returns undefined if the key is not encodable, so a malformed key never throws
// (the card falls back to the plain single-copy KeyField). Mirrors igloo-pwa's
// lib/dashboard-view.ts toDashboardKey.
export function toDashboardKey(hex: string): DashboardKeyModel | undefined {
  const normalized = (hex ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return undefined;
  try {
    const npub = nip19.npubEncode(normalized);
    const display = `${npub.slice(0, 8)}...${npub.slice(-4)}`;
    return { display, npub, hex: normalized };
  } catch {
    return undefined;
  }
}
