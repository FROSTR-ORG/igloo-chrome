import React, { createContext, useContext, useMemo, useState } from 'react';
import { saveRuntimeSnapshot as saveExtensionRuntimeSnapshot } from '@/extension/storage';
import {
  clearStoredProfile,
  hasStoredProfile,
  loadStoredProfile,
  saveRuntimeSnapshot as saveLocalRuntimeSnapshot,
  saveStoredProfile,
  type StoredProfile
} from './storage';
import {
  DEFAULT_RELAYS,
  createSignerNode,
  connectSignerNode,
  decodeOnboardingProfile,
  getPublicKeyFromNode,
  getRuntimeSnapshot,
  normalizeRelays,
  stopSignerNode,
  type DecodedOnboardingProfile,
  type NodeWithEvents
} from './igloo';
import { createLogger, type ObservabilityEvent } from './observability';

export type AppRoute = 'onboarding' | 'signer';

type OnboardingConnectInput = {
  keysetName?: string;
  onboardPackage: string;
  onboardPassword: string;
  relays: string[];
};

export type OnboardingFailureDetail = {
  message: string;
  decoded: DecodedOnboardingProfile;
  relays: string[];
  recentEvents: ObservabilityEvent[];
};

type AppState = {
  route: AppRoute;
  setRoute: (r: AppRoute) => void;
  profile?: StoredProfile;
  setProfile: (s?: StoredProfile) => void;
  activeNode: NodeWithEvents | null;
  setActiveNode: (node: NodeWithEvents | null) => void;
  lastOnboardingFailure: OnboardingFailureDetail | null;
  clearOnboardingFailure: () => void;
  saveProfile: (s: StoredProfile) => Promise<void>;
  connectOnboarding: (s: OnboardingConnectInput) => Promise<void>;
  logout: () => void;
};

const Store = createContext<AppState | null>(null);
const logger = createLogger('igloo.store');
const NONCE_SNAPSHOT_WAIT_TIMEOUT_MS = 5_000;
const NONCE_SNAPSHOT_POLL_INTERVAL_MS = 100;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Failed to connect onboarding';
}

function snapshotHasUsableNonces(snapshot: unknown) {
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
    return (typeof incoming === 'number' && incoming > 0) || (typeof outgoing === 'number' && outgoing > 0);
  });
}

async function waitForNonceSnapshot(node: NodeWithEvents) {
  const startedAt = Date.now();
  let lastSnapshot: unknown = null;
  while (Date.now() - startedAt < NONCE_SNAPSHOT_WAIT_TIMEOUT_MS) {
    lastSnapshot = getRuntimeSnapshot(node);
    if (snapshotHasUsableNonces(lastSnapshot)) {
      return {
        snapshot: lastSnapshot,
        ready: true,
        elapsedMs: Date.now() - startedAt
      };
    }
    await new Promise((resolve) => setTimeout(resolve, NONCE_SNAPSHOT_POLL_INTERVAL_MS));
  }
  return {
    snapshot: lastSnapshot ?? getRuntimeSnapshot(node),
    ready: false,
    elapsedMs: Date.now() - startedAt
  };
}

function formatRecentEvents(events: ObservabilityEvent[]) {
  if (events.length === 0) return 'none';
  return events
    .slice(-6)
    .map((event) => {
      const message = typeof event.message === 'string' && event.message.trim() ? ` ${event.message}` : '';
      return `${event.domain}/${event.event}${message}`;
    })
    .join(' | ');
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const initialRoute: AppRoute = hasStoredProfile() ? 'signer' : 'onboarding';
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [profile, setProfile] = useState<StoredProfile | undefined>(() => {
    try {
      if (!hasStoredProfile()) return undefined;
      return loadStoredProfile();
    } catch {
      return undefined;
    }
  });
  const [activeNode, setActiveNode] = useState<NodeWithEvents | null>(null);
  const [lastOnboardingFailure, setLastOnboardingFailure] = useState<OnboardingFailureDetail | null>(
    null
  );

  async function saveProfile(s: StoredProfile) {
    const { relays } = normalizeRelays(s.relays ?? DEFAULT_RELAYS);
    const peerPubkey = s.peerPubkey?.trim().toLowerCase();
    const payload = {
      ...s,
      relays,
      ...(typeof s.groupPublicKey === 'string' && s.groupPublicKey.trim()
        ? { groupPublicKey: s.groupPublicKey.trim().toLowerCase() }
        : {}),
      ...(typeof s.publicKey === 'string' && s.publicKey.trim()
        ? { publicKey: s.publicKey.trim().toLowerCase() }
        : {}),
      ...(peerPubkey ? { peerPubkey } : {})
    };
    saveStoredProfile(payload);
    setProfile(payload);
    setRoute('signer');
  }

  async function connectOnboarding(s: OnboardingConnectInput) {
    const { relays } = normalizeRelays(s.relays ?? DEFAULT_RELAYS);
    const decoded = await decodeOnboardingProfile(
      s.onboardPackage,
      s.onboardPassword
    );
    setLastOnboardingFailure(null);
    logger.info('onboarding', 'connect_begin', {
      keyset_name: s.keysetName?.trim() || null,
      relay_count: relays.length,
      peer_pubkey32: decoded.peerPubkey,
      share_pubkey32: decoded.publicKey
    });

    stopSignerNode(activeNode);
    setActiveNode(null);

    const node = createSignerNode({
      mode: 'onboarding',
      onboardPackage: s.onboardPackage,
      onboardPassword: s.onboardPassword,
      relays
    });
    const recentEvents: ObservabilityEvent[] = [];
    const pushRecentEvent = (...args: unknown[]) => {
      const [event] = args;
      if (!event || typeof event !== 'object') return;
      recentEvents.push(event as ObservabilityEvent);
      if (recentEvents.length > 24) {
        recentEvents.splice(0, recentEvents.length - 24);
      }
    };
    node.on('message', pushRecentEvent);

    try {
      await connectSignerNode(node);
      const nonceSnapshot = await waitForNonceSnapshot(node);
      node.off?.('message', pushRecentEvent);
      if (!nonceSnapshot.ready) {
        logger.warn('onboarding', 'nonce_snapshot_timeout', {
          keyset_name: s.keysetName?.trim() || null,
          peer_pubkey32: decoded.peerPubkey,
          elapsed_ms: nonceSnapshot.elapsedMs
        });
      } else {
        logger.info('onboarding', 'nonce_snapshot_ready', {
          keyset_name: s.keysetName?.trim() || null,
          peer_pubkey32: decoded.peerPubkey,
          elapsed_ms: nonceSnapshot.elapsedMs
        });
      }
      const runtimeSnapshotJson = JSON.stringify(nonceSnapshot.snapshot);
      saveLocalRuntimeSnapshot(runtimeSnapshotJson);
      await saveExtensionRuntimeSnapshot(
        JSON.stringify({
          groupPublicKey: getPublicKeyFromNode(node),
          peerPubkey: decoded.peerPubkey,
          relays
        }),
        runtimeSnapshotJson
      );
      const payload = {
        keysetName: s.keysetName?.trim(),
        relays,
        groupPublicKey: getPublicKeyFromNode(node),
        publicKey: getPublicKeyFromNode(node),
        peerPubkey: decoded.peerPubkey,
        runtimeSnapshotJson
      };
      saveStoredProfile(payload);
      setProfile(payload);
      setActiveNode(node);
      setRoute('signer');
      logger.info('onboarding', 'connect_complete', {
        keyset_name: s.keysetName?.trim() || null,
        peer_pubkey32: decoded.peerPubkey,
        relay_count: relays.length
      });
    } catch (error) {
      node.off?.('message', pushRecentEvent);
      stopSignerNode(node);
      const message = toErrorMessage(error);
      const failureDetail = {
        message,
        decoded,
        relays,
        recentEvents: recentEvents.slice()
      };
      setLastOnboardingFailure(failureDetail);
      logger.error('onboarding', 'connect_failed', {
        keyset_name: s.keysetName?.trim() || null,
        peer_pubkey32: decoded.peerPubkey,
        share_pubkey32: decoded.publicKey,
        relay_count: relays.length,
        recent_events: recentEvents.slice(-6).map((event) => `${event.domain}/${event.event}`),
        error_message: message
      });
      throw new Error(
        `${message} | recent_events=${formatRecentEvents(recentEvents)}`
      );
    }
  }

  function logout() {
    stopSignerNode(activeNode);
    setActiveNode(null);
    setProfile(undefined);
    clearStoredProfile();
    setRoute('onboarding');
  }

  const value = useMemo<AppState>(
    () => ({
      route,
      setRoute,
      profile,
      setProfile,
      activeNode,
      setActiveNode,
      lastOnboardingFailure,
      clearOnboardingFailure: () => setLastOnboardingFailure(null),
      saveProfile,
      connectOnboarding,
      logout
    }),
    [route, profile, activeNode, lastOnboardingFailure]
  );
  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export function useStore() {
  const ctx = useContext(Store);
  if (!ctx) throw new Error('StoreProvider missing');
  return ctx;
}
