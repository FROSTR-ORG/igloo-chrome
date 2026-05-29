export const COMMAND_TYPE = {
  STATE_GET: 'ext.state.get',
  DIAGNOSTICS_GET: 'ext.diagnostics.get',
  PROFILES_SAVE: 'ext.profiles.save',
  PROFILES_ACTIVATE: 'ext.profiles.activate',
  PROFILES_UNLOCK: 'ext.profiles.unlock',
  PROFILES_DELETE: 'ext.profiles.delete',
  PROFILES_LOGOUT: 'ext.profiles.logout',
  PROFILES_IMPORT: 'ext.profiles.import',
  PROFILES_EXPORT_PACKAGE: 'ext.profiles.exportPackage',
  ONBOARDING_START: 'ext.onboarding.start',
  ONBOARDING_COMPLETE: 'ext.onboarding.complete',
  ROTATION_COMPLETE: 'ext.rotation.complete',
  RUNTIME_START: 'ext.runtime.start',
  RUNTIME_STOP: 'ext.runtime.stop',
  RUNTIME_RELOAD: 'ext.runtime.reload',
  RUNTIME_PREPARE: 'ext.runtime.prepare',
  RUNTIME_REFRESH_PEERS: 'ext.runtime.refreshPeers',
  RUNTIME_CONFIG_GET: 'ext.runtime.config.get',
  RUNTIME_CONFIG_UPDATE: 'ext.runtime.config.update',
  RUNTIME_PEER_POLICY_UPDATE: 'ext.runtime.peerPolicy.update',
  RUNTIME_PEER_POLICY_CLEAR_OVERRIDES: 'ext.runtime.peerPolicy.clearOverrides',
  PROVIDER_REQUEST: 'ext.provider.request',
  PROMPTS_RESPOND: 'ext.prompts.respond',
  UI_OPEN_DASHBOARD: 'ext.ui.openDashboard',
  PERMISSIONS_CLEAR_ALL: 'ext.permissions.clearAll',
  PERMISSIONS_REVOKE: 'ext.permissions.revoke',
} as const;

export const EVENT_TYPE = {
  STATE_CHANGED: 'ext.state.changed',
} as const;

export const DEBUG_COMMAND_TYPE = {
  RELOAD: 'ext.debug.reload',
} as const;

export type RuntimePrepareOperation = 'sign' | 'ecdh';

export type PromptDecisionScope = 'once' | 'forever' | 'kind';

export type PromptResponseMessage = {
  type: typeof COMMAND_TYPE.PROMPTS_RESPOND;
  id: string;
  allow: boolean;
  scope: PromptDecisionScope;
  kind?: number;
};

import type { SignerSettings } from '@/lib/signer-settings';
import type { LifecycleStatusSnapshot, LifecycleTransitionRecord } from '@/extension/lifecycle';
import type { ProviderRequestEnvelope, StoredPermissionPolicy } from '@/extension/provider-types';
import type {
  PolicyOverrideValue,
  RuntimeLifecycleStatus,
  RuntimePhase,
  StoredPeerPolicy,
  RuntimeSnapshotDetails,
  RuntimeStatusSummary,
} from '@/extension/runtime-types';
import type {
  ExtensionStateSnapshot,
  PendingOnboardingProfile,
  StoredExtensionProfile,
} from '@/extension/state-types';
import type { ObservabilityEvent } from '@/lib/observability';

export type StateGetMessage = {
  type: typeof COMMAND_TYPE.STATE_GET;
};

export type DiagnosticsGetMessage = {
  type: typeof COMMAND_TYPE.DIAGNOSTICS_GET;
};

export type ProfilesSaveMessage = {
  type: typeof COMMAND_TYPE.PROFILES_SAVE;
  profile: StoredExtensionProfile;
};

export type ProfilesActivateMessage = {
  type: typeof COMMAND_TYPE.PROFILES_ACTIVATE;
  profileId: string;
};

export type ProfilesUnlockMessage = {
  type: typeof COMMAND_TYPE.PROFILES_UNLOCK;
  profileId: string;
  password: string;
};

export type ProfilesDeleteMessage = {
  type: typeof COMMAND_TYPE.PROFILES_DELETE;
  profileId: string;
};

export type ProfilesLogoutMessage = {
  type: typeof COMMAND_TYPE.PROFILES_LOGOUT;
};

export type ProfilesImportMessage = {
  type: typeof COMMAND_TYPE.PROFILES_IMPORT;
  packageText: string;
  password: string;
};

export type ProfilesExportPackageMessage = {
  type: typeof COMMAND_TYPE.PROFILES_EXPORT_PACKAGE;
  format: 'bfprofile' | 'bfshare';
  password: string;
};

export type OnboardingStartMessage = {
  type: typeof COMMAND_TYPE.ONBOARDING_START;
  input: {
    onboardPackage: string;
    onboardPassword: string;
    groupName?: string;
  };
};

export type OnboardingCompleteMessage = {
  type: typeof COMMAND_TYPE.ONBOARDING_COMPLETE;
  pendingProfile: PendingOnboardingProfile;
  label: string;
  password: string;
};

export type RotationCompleteMessage = {
  type: typeof COMMAND_TYPE.ROTATION_COMPLETE;
  targetProfileId: string;
  pendingProfile: PendingOnboardingProfile;
};

export type RuntimeStartMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_START;
};

export type RuntimeStopMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_STOP;
};

export type RuntimeReloadMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_RELOAD;
};

export type RuntimePrepareMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_PREPARE;
  operation: RuntimePrepareOperation;
};

export type RuntimeRefreshPeersMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_REFRESH_PEERS;
};

export type RuntimeConfigGetMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_CONFIG_GET;
};

export type RuntimeConfigUpdateMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_CONFIG_UPDATE;
  settings: Partial<SignerSettings>;
};

export type RuntimePeerPolicyUpdateMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_PEER_POLICY_UPDATE;
  pubkey: string;
  patch: {
    direction: 'request' | 'respond';
    method: 'ping' | 'onboard' | 'sign' | 'ecdh';
    value: PolicyOverrideValue;
  };
};

export type RuntimePeerPolicyClearOverridesMessage = {
  type: typeof COMMAND_TYPE.RUNTIME_PEER_POLICY_CLEAR_OVERRIDES;
};

export type ProviderRequestMessage = {
  type: typeof COMMAND_TYPE.PROVIDER_REQUEST;
  request: ProviderRequestEnvelope;
};

export type UiOpenDashboardMessage = {
  type: typeof COMMAND_TYPE.UI_OPEN_DASHBOARD;
};

export type PermissionsClearAllMessage = {
  type: typeof COMMAND_TYPE.PERMISSIONS_CLEAR_ALL;
};

export type PermissionsRevokeMessage = {
  type: typeof COMMAND_TYPE.PERMISSIONS_REVOKE;
  policy: StoredPermissionPolicy;
};

export type DebugReloadMessage = {
  type: typeof DEBUG_COMMAND_TYPE.RELOAD;
};

export type ExtensionCommand =
  | StateGetMessage
  | DiagnosticsGetMessage
  | ProfilesSaveMessage
  | ProfilesActivateMessage
  | ProfilesUnlockMessage
  | ProfilesDeleteMessage
  | ProfilesLogoutMessage
  | ProfilesImportMessage
  | ProfilesExportPackageMessage
  | OnboardingStartMessage
  | OnboardingCompleteMessage
  | RotationCompleteMessage
  | RuntimeStartMessage
  | RuntimeStopMessage
  | RuntimeReloadMessage
  | RuntimePrepareMessage
  | RuntimeRefreshPeersMessage
  | RuntimeConfigGetMessage
  | RuntimeConfigUpdateMessage
  | RuntimePeerPolicyUpdateMessage
  | RuntimePeerPolicyClearOverridesMessage
  | ProviderRequestMessage
  | PromptResponseMessage
  | UiOpenDashboardMessage
  | PermissionsClearAllMessage
  | PermissionsRevokeMessage
  | DebugReloadMessage;

export type ExtensionCommandByType = {
  [K in ExtensionCommand['type']]: Extract<ExtensionCommand, { type: K }>;
};

export type RuntimeStatusSnapshot = {
  runtime: RuntimePhase;
  status: RuntimeStatusSummary | null;
};

export type RuntimeSnapshotInspection = RuntimeStatusSnapshot & {
  snapshot: RuntimeSnapshotDetails | null;
  snapshotError: string | null;
  runtimeLifecycle?: RuntimeLifecycleStatus | null;
};

export type RuntimeDiagnosticsCore = {
  runtime: RuntimePhase;
  diagnostics: ObservabilityEvent[];
  dropped: number;
  runtimeStatus?: RuntimeStatusSummary | null;
  runtimeSnapshot?: RuntimeSnapshotDetails | null;
  runtimeSnapshotError?: string | null;
  runtimeLifecycle?: RuntimeLifecycleStatus | null;
};

export type RuntimeDiagnosticsSnapshot = RuntimeDiagnosticsCore & {
  lifecycle: LifecycleStatusSnapshot;
  lifecycleHistory: LifecycleTransitionRecord[];
};

export type StateChangedEvent = {
  type: typeof EVENT_TYPE.STATE_CHANGED;
  state: ExtensionStateSnapshot;
};

export type RuntimePrepareResult = {
  runtime: RuntimePhase;
  readiness: unknown;
};

export type ExtensionCommandResultByType = {
  [COMMAND_TYPE.STATE_GET]: ExtensionStateSnapshot;
  [COMMAND_TYPE.DIAGNOSTICS_GET]: RuntimeDiagnosticsSnapshot;
  [COMMAND_TYPE.PROFILES_SAVE]: StoredExtensionProfile;
  [COMMAND_TYPE.PROFILES_ACTIVATE]: StoredExtensionProfile;
  [COMMAND_TYPE.PROFILES_UNLOCK]: StoredExtensionProfile;
  [COMMAND_TYPE.PROFILES_DELETE]: boolean;
  [COMMAND_TYPE.PROFILES_LOGOUT]: boolean;
  [COMMAND_TYPE.PROFILES_IMPORT]: StoredExtensionProfile;
  [COMMAND_TYPE.PROFILES_EXPORT_PACKAGE]: { packageText: string };
  [COMMAND_TYPE.ONBOARDING_START]: PendingOnboardingProfile;
  [COMMAND_TYPE.ONBOARDING_COMPLETE]: StoredExtensionProfile;
  [COMMAND_TYPE.ROTATION_COMPLETE]: StoredExtensionProfile;
  [COMMAND_TYPE.RUNTIME_START]: boolean;
  [COMMAND_TYPE.RUNTIME_STOP]: boolean;
  [COMMAND_TYPE.RUNTIME_RELOAD]: boolean;
  [COMMAND_TYPE.RUNTIME_PREPARE]: RuntimePrepareResult;
  [COMMAND_TYPE.RUNTIME_REFRESH_PEERS]: boolean;
  [COMMAND_TYPE.RUNTIME_CONFIG_GET]: SignerSettings;
  [COMMAND_TYPE.RUNTIME_CONFIG_UPDATE]: SignerSettings;
  [COMMAND_TYPE.RUNTIME_PEER_POLICY_UPDATE]: StoredPeerPolicy[];
  [COMMAND_TYPE.RUNTIME_PEER_POLICY_CLEAR_OVERRIDES]: StoredPeerPolicy[];
  [COMMAND_TYPE.PROVIDER_REQUEST]: unknown;
  [COMMAND_TYPE.PROMPTS_RESPOND]: boolean;
  [COMMAND_TYPE.UI_OPEN_DASHBOARD]: boolean;
  [COMMAND_TYPE.PERMISSIONS_CLEAR_ALL]: boolean;
  [COMMAND_TYPE.PERMISSIONS_REVOKE]: boolean;
  [DEBUG_COMMAND_TYPE.RELOAD]: boolean;
};

export type ExtensionCommandResult<K extends ExtensionCommand['type']> = ExtensionCommandResultByType[K];

export type ExtensionMessageResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };
