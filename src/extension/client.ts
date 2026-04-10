import { getChromeApi } from '@/extension/chrome';
import {
  COMMAND_TYPE,
  type DiagnosticsGetMessage,
  type ExtensionCommand,
  type ExtensionCommandResult,
  type ExtensionMessageResponse,
  type ExtensionStateSnapshot,
  type OnboardingCompleteMessage,
  type OnboardingStartMessage,
  type PermissionsClearAllMessage,
  type PermissionsRevokeMessage,
  type PolicyOverrideValue,
  type ProfilesActivateMessage,
  type ProfilesDeleteMessage,
  type ProfilesExportPackageMessage,
  type ProfilesImportMessage,
  type ProfilesLogoutMessage,
  type ProfilesRecoverMessage,
  type ProfilesSaveMessage,
  type ProfilesUnlockMessage,
  type RotationCompleteMessage,
  type RuntimeConfigGetMessage,
  type RuntimeConfigUpdateMessage,
  type RuntimeDiagnosticsSnapshot,
  type RuntimePeerPolicyClearOverridesMessage,
  type RuntimePeerPolicyUpdateMessage,
  type RuntimePrepareMessage,
  type RuntimePrepareOperation,
  type RuntimeStartMessage,
  type RuntimeStopMessage,
  type RuntimeReloadMessage,
  type RuntimeRefreshPeersMessage,
  type StoredPeerPolicy,
  type StoredPermissionPolicy,
  type StateGetMessage,
  type StoredExtensionProfile,
  type PendingOnboardingProfile,
  type UiOpenDashboardMessage
} from '@/extension/protocol';
import type { SignerSettings } from '@/lib/signer-settings';

export type StartOnboardingInput = {
  onboardPackage: string;
  onboardPassword: string;
};

const LONG_TASK_PORT_TIMEOUT_MS = 20_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

async function sendMessage<T extends ExtensionCommand['type']>(
  payload: Extract<ExtensionCommand, { type: T }>,
  fallback: string
): Promise<ExtensionCommandResult<T>> {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error('Extension runtime messaging is unavailable');
  }

  const response = (await chromeApi.runtime.sendMessage(payload)) as
    | ExtensionMessageResponse<ExtensionCommandResult<T>>
    | undefined;

  if (!response?.ok) {
    throw new Error(response?.error || fallback);
  }

  return response.result;
}

export async function fetchExtensionState(): Promise<ExtensionStateSnapshot> {
  const payload: StateGetMessage = {
    type: COMMAND_TYPE.STATE_GET
  };
  return await sendMessage(payload, 'Failed to load extension state');
}

export async function fetchRuntimeDiagnostics(): Promise<RuntimeDiagnosticsSnapshot> {
  const payload: DiagnosticsGetMessage = {
    type: COMMAND_TYPE.DIAGNOSTICS_GET
  };
  return await sendMessage(payload, 'Failed to load runtime diagnostics');
}

export async function fetchRuntimeConfig(): Promise<SignerSettings> {
  const payload: RuntimeConfigGetMessage = {
    type: COMMAND_TYPE.RUNTIME_CONFIG_GET
  };
  return await sendMessage(payload, 'Failed to read runtime config');
}

export async function updateRuntimeConfig(
  settings: Partial<SignerSettings>
): Promise<SignerSettings> {
  const payload: RuntimeConfigUpdateMessage = {
    type: COMMAND_TYPE.RUNTIME_CONFIG_UPDATE,
    settings
  };
  return await sendMessage(payload, 'Failed to update runtime config');
}

export async function updateRuntimePeerPolicy(
  pubkey: string,
  patch: {
    direction: 'request' | 'respond';
    method: 'ping' | 'onboard' | 'sign' | 'ecdh';
    value: PolicyOverrideValue;
  }
): Promise<StoredPeerPolicy[]> {
  const payload: RuntimePeerPolicyUpdateMessage = {
    type: COMMAND_TYPE.RUNTIME_PEER_POLICY_UPDATE,
    pubkey,
    patch
  };
  return await sendMessage(payload, 'Failed to update runtime peer policy');
}

export async function clearRuntimePeerPolicyOverrides(): Promise<StoredPeerPolicy[]> {
  const payload: RuntimePeerPolicyClearOverridesMessage = {
    type: COMMAND_TYPE.RUNTIME_PEER_POLICY_CLEAR_OVERRIDES
  };
  return await sendMessage(payload, 'Failed to clear runtime peer policy overrides');
}

export async function startOnboarding(
  input: StartOnboardingInput
): Promise<PendingOnboardingProfile> {
  const payload: OnboardingStartMessage = {
    type: COMMAND_TYPE.ONBOARDING_START,
    input,
  };
  return await withTimeout(
    sendMessage(payload, 'Failed to start onboarding'),
    LONG_TASK_PORT_TIMEOUT_MS,
    `Failed to start onboarding timed out after ${LONG_TASK_PORT_TIMEOUT_MS}ms`
  );
}

export async function completeOnboarding(
  pendingProfile: PendingOnboardingProfile,
  label: string,
  password: string
): Promise<StoredExtensionProfile> {
  const payload: OnboardingCompleteMessage = {
    type: COMMAND_TYPE.ONBOARDING_COMPLETE,
    pendingProfile,
    label,
    password
  };
  return await sendMessage(payload, 'Failed to complete onboarding');
}

export async function completeRotationOnboarding(input: {
  targetProfileId: string;
  pendingProfile: PendingOnboardingProfile;
}): Promise<StoredExtensionProfile> {
  const payload: RotationCompleteMessage = {
    type: COMMAND_TYPE.ROTATION_COMPLETE,
    targetProfileId: input.targetProfileId,
    pendingProfile: input.pendingProfile
  };
  return await sendMessage(payload, 'Failed to rotate key');
}

export async function importBfprofile(
  packageText: string,
  password: string
): Promise<StoredExtensionProfile> {
  const payload: ProfilesImportMessage = {
    type: COMMAND_TYPE.PROFILES_IMPORT,
    packageText,
    password
  };
  return await sendMessage(payload, 'Failed to import bfprofile');
}

export async function recoverBfshare(
  packageText: string,
  password: string
): Promise<StoredExtensionProfile> {
  const payload: ProfilesRecoverMessage = {
    type: COMMAND_TYPE.PROFILES_RECOVER,
    packageText,
    password
  };
  return await sendMessage(payload, 'Failed to recover bfshare');
}

export async function exportProfilePackage(
  format: 'bfprofile' | 'bfshare',
  password: string
): Promise<string> {
  const payload: ProfilesExportPackageMessage = {
    type: COMMAND_TYPE.PROFILES_EXPORT_PACKAGE,
    format,
    password
  };
  const result = await sendMessage(payload, `Failed to export ${format}`);
  return result.packageText;
}

export async function saveExtensionProfile(
  profile: StoredExtensionProfile
): Promise<StoredExtensionProfile> {
  const payload: ProfilesSaveMessage = {
    type: COMMAND_TYPE.PROFILES_SAVE,
    profile
  };
  return await sendMessage(payload, 'Failed to save extension profile');
}

export async function activateExtensionProfile(
  profileId: string
): Promise<StoredExtensionProfile> {
  const payload: ProfilesActivateMessage = {
    type: COMMAND_TYPE.PROFILES_ACTIVATE,
    profileId
  };
  return await sendMessage(payload, 'Failed to activate extension profile');
}

export async function unlockExtensionProfile(
  profileId: string,
  password: string
): Promise<StoredExtensionProfile> {
  const payload: ProfilesUnlockMessage = {
    type: COMMAND_TYPE.PROFILES_UNLOCK,
    profileId,
    password
  };
  return await sendMessage(payload, 'Failed to unlock extension profile');
}

export async function deleteExtensionProfile(profileId: string): Promise<void> {
  const payload: ProfilesDeleteMessage = {
    type: COMMAND_TYPE.PROFILES_DELETE,
    profileId,
  };
  await sendMessage(payload, 'Failed to delete extension profile');
}

export async function logoutExtensionProfile(): Promise<void> {
  const payload: ProfilesLogoutMessage = {
    type: COMMAND_TYPE.PROFILES_LOGOUT
  };
  await sendMessage(payload, 'Failed to log out extension profile');
}

export async function startRuntime(): Promise<void> {
  const payload: RuntimeStartMessage = {
    type: COMMAND_TYPE.RUNTIME_START,
  };
  await sendMessage(payload, 'Failed to start signer runtime');
}

export async function stopRuntime(): Promise<void> {
  const payload: RuntimeStopMessage = {
    type: COMMAND_TYPE.RUNTIME_STOP,
  };
  await sendMessage(payload, 'Failed to stop signer runtime');
}

export async function reloadRuntime(): Promise<void> {
  const payload: RuntimeReloadMessage = {
    type: COMMAND_TYPE.RUNTIME_RELOAD,
  };
  await sendMessage(payload, 'Failed to reload signer runtime');
}

export async function refreshRuntimePeers(): Promise<void> {
  const payload: RuntimeRefreshPeersMessage = {
    type: COMMAND_TYPE.RUNTIME_REFRESH_PEERS,
  };
  await sendMessage(payload, 'Failed to refresh signer peers');
}

export async function prepareRuntime<T = RuntimePrepareMessage extends { type: infer K extends ExtensionCommand['type'] } ? ExtensionCommandResult<K> : never>(
  operation: RuntimePrepareOperation
) {
  const payload: RuntimePrepareMessage = {
    type: COMMAND_TYPE.RUNTIME_PREPARE,
    operation,
  };
  return await sendMessage(payload, `Failed to prepare runtime for ${operation}`) as T;
}

export async function openDashboard(): Promise<void> {
  const payload: UiOpenDashboardMessage = {
    type: COMMAND_TYPE.UI_OPEN_DASHBOARD,
  };
  await sendMessage(payload, 'Failed to open extension dashboard');
}

export async function clearPermissionPolicies(): Promise<void> {
  const payload: PermissionsClearAllMessage = {
    type: COMMAND_TYPE.PERMISSIONS_CLEAR_ALL,
  };
  await sendMessage(payload, 'Failed to clear site permissions');
}

export async function revokePermissionPolicy(policy: {
  host: StoredPermissionPolicy['host'];
  type: StoredPermissionPolicy['type'];
  allow: StoredPermissionPolicy['allow'];
  createdAt: StoredPermissionPolicy['createdAt'];
  kind?: StoredPermissionPolicy['kind'];
}): Promise<void> {
  const payload: PermissionsRevokeMessage = {
    type: COMMAND_TYPE.PERMISSIONS_REVOKE,
    policy,
  };
  await sendMessage(payload, 'Failed to revoke permission');
}
