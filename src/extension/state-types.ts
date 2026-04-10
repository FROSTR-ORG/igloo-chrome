import type { BrowserProfilePackagePayload } from 'igloo-shared';
import type { SignerSettings } from '@/lib/signer-settings';
import type { LifecycleStatusSnapshot } from '@/extension/lifecycle';
import type {
  RuntimeLifecycleStatus,
  RuntimeMetadata,
  RuntimePeerStatus,
  RuntimePendingOperation,
  RuntimePhase,
  RuntimeReadiness,
  RuntimeSnapshotDetails,
  RuntimeStatusSummary,
} from '@/extension/runtime-types';
import type { StoredPermissionPolicy } from '@/extension/provider-types';

export type StoredExtensionProfile = {
  id: string;
  groupName?: string;
  relays: string[];
  groupPublicKey?: string;
  sharePublicKey?: string;
  publicKey?: string;
  peerPubkey?: string;
  signerSettings?: SignerSettings;
  runtimeSnapshotJson?: string;
};

export type StoredProfileSummary = {
  id: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  unlocked: boolean;
};

export type PendingOnboardingProfile = {
  id: string;
  groupName?: string;
  relays: string[];
  groupPublicKey?: string;
  sharePublicKey?: string;
  publicKey?: string;
  peerPubkey?: string;
  signerSettings?: SignerSettings;
  runtimeSnapshotJson?: string;
  profilePayload: BrowserProfilePackagePayload;
};

export type ExtensionStateSnapshot = {
  configured: boolean;
  profile: StoredExtensionProfile | null;
  profiles: StoredProfileSummary[];
  activeProfileId: string | null;
  lifecycle: LifecycleStatusSnapshot;
  runtime: {
    desiredActive: boolean;
    phase: RuntimePhase;
    summary: RuntimeStatusSummary | null;
    metadata: RuntimeMetadata | null;
    readiness: RuntimeReadiness | null;
    peerStatus: RuntimePeerStatus[];
    pendingOperations: RuntimePendingOperation[];
    snapshot: RuntimeSnapshotDetails | null;
    snapshotError: string | null;
    lifecycle: RuntimeLifecycleStatus;
    lastError: string | null;
  };
  permissionPolicies: StoredPermissionPolicy[];
  pendingPrompts: number;
};

export type ExtensionAppState = ExtensionStateSnapshot;
