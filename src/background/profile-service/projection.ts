import type {
  StoredExtensionProfile,
  StoredProfileSummary,
} from '@/extension/protocol';
import { normalizeSignerSettings } from '@/lib/signer-settings';
import {
  createBrowserStoredProfileProjection,
  createBrowserStoredRuntimeProfile,
  normalizeBrowserStoredProfilePayload,
  DEFAULT_RELAYS,
  normalizeRelays,
  type BrowserProfilePackagePayload,
  type BrowserProfileSource,
} from '@/lib/igloo';
import type {
  LocalProfileBlobPayload,
  LocalProfileBlobRecord,
} from '@/lib/profile-blob';

export function storedProfileSummaryFromRecord(
  record: LocalProfileBlobRecord,
  unlockedProfileIds: Set<string>,
): StoredProfileSummary {
  return {
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    unlocked: unlockedProfileIds.has(record.id),
  };
}

export function toRuntimeProfile(
  payload: LocalProfileBlobPayload,
): StoredExtensionProfile {
  const summary = createBrowserStoredRuntimeProfile(payload);
  return {
    id: summary.id,
    groupName: summary.groupName,
    relays: summary.relays,
    groupPublicKey: summary.groupPublicKey,
    publicKey: summary.publicKey,
    sharePublicKey: summary.sharePublicKey,
    peerPubkey: summary.peerPubkey,
    signerSettings: summary.signerSettings,
    runtimeSnapshotJson: summary.runtimeSnapshotJson,
  };
}

export function normalizeProfileInput(
  profile: StoredExtensionProfile,
): StoredExtensionProfile {
  const { relays } = normalizeRelays(
    profile.relays?.length ? profile.relays : DEFAULT_RELAYS,
  );
  const id = profile.id?.trim().toLowerCase();
  if (!id) {
    throw new Error('Profile is missing an id.');
  }
  return {
    ...profile,
    id,
    relays,
    groupName: profile.groupName?.trim() || undefined,
    groupPublicKey: profile.groupPublicKey?.trim().toLowerCase() || undefined,
    sharePublicKey: profile.sharePublicKey?.trim().toLowerCase() || undefined,
    publicKey: profile.publicKey?.trim().toLowerCase() || undefined,
    peerPubkey: profile.peerPubkey?.trim().toLowerCase() || undefined,
    signerSettings: normalizeSignerSettings(profile.signerSettings),
  };
}

export function createStoredProfileRecordPayload(
  payload: LocalProfileBlobPayload,
): LocalProfileBlobPayload {
  return normalizeBrowserStoredProfilePayload(payload);
}

export function createStoredProfilePayload(args: {
  payload: BrowserProfilePackagePayload;
  source: BrowserProfileSource;
  signerSettings?: StoredExtensionProfile['signerSettings'];
  peerPubkey?: string | null;
  runtimeSnapshotJson?: string | null;
}): LocalProfileBlobPayload {
  return createBrowserStoredProfileProjection({
    payload: args.payload,
    source: args.source,
    signerSettings: args.signerSettings,
    peerPubkey: args.peerPubkey ?? null,
    runtimeSnapshotJson: args.runtimeSnapshotJson ?? null,
  }).storedPayload;
}
