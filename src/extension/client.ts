import { getChromeApi } from '@/extension/chrome';
import {
  MESSAGE_TYPE,
  type ExtensionAppState,
  type LifecycleStatusSnapshot,
  type LifecycleTransitionRecord,
  type PolicyOverrideValue,
  type RuntimeControlMessage,
  type RuntimeLifecycleStatus,
  type RuntimeMetadata,
  type RuntimePeerStatus,
  type StoredPeerPolicy,
  type RuntimePendingOperation,
  type RuntimePhase,
  type RuntimeReadiness,
  type RuntimeSnapshotDetails,
  type RuntimeStatusDetails,
  type RuntimeStatusSummary,
  type StoredExtensionProfile
} from '@/extension/protocol';
import type { ObservabilityEvent } from '@/lib/observability';
import type { SignerSettings } from '@/lib/signer-settings';

export type ExtensionStatusSnapshot = {
  configured: boolean;
  keysetName: string | null;
  publicKey: string | null;
  sharePublicKey: string | null;
  relays: string[];
  runtime: RuntimePhase;
  pendingPrompts: number;
  lifecycle: LifecycleStatusSnapshot;
  runtimeDetails: {
    status: RuntimeStatusDetails | null;
    summary: RuntimeStatusSummary | null;
    snapshot: RuntimeSnapshotDetails | null;
    snapshotError: string | null;
    peerStatus: RuntimePeerStatus[];
    metadata: RuntimeMetadata | null;
    readiness?: RuntimeReadiness | null;
    lifecycle: RuntimeLifecycleStatus;
  };
};

export type RuntimeDiagnosticsSnapshot = {
  runtime: RuntimePhase;
  diagnostics: ObservabilityEvent[];
  dropped: number;
  runtimeStatus?: RuntimeStatusSummary | null;
  lifecycle: LifecycleStatusSnapshot;
  lifecycleHistory: LifecycleTransitionRecord[];
};

export type StartOnboardingInput = {
  keysetName?: string;
  onboardPackage: string;
  onboardPassword: string;
};

async function sendMessage<T>(payload: Record<string, unknown>, fallback: string): Promise<T> {
  const chromeApi = getChromeApi();
  if (!chromeApi?.runtime?.sendMessage) {
    throw new Error('Extension runtime messaging is unavailable');
  }

  const response = (await chromeApi.runtime.sendMessage(payload)) as
    | { ok?: boolean; result?: T; error?: string }
    | undefined;

  if (!response?.ok || response.result === undefined) {
    throw new Error(response?.error || fallback);
  }

  return response.result;
}

export async function fetchExtensionAppState(): Promise<ExtensionAppState> {
  return await sendMessage<ExtensionAppState>({
    type: MESSAGE_TYPE.GET_APP_STATE
  }, 'Failed to load extension app state');
}

export async function fetchExtensionStatus(): Promise<ExtensionStatusSnapshot> {
  return await sendMessage<ExtensionStatusSnapshot>({
    type: MESSAGE_TYPE.GET_STATUS
  }, 'Failed to load extension status');
}

export async function fetchRuntimeDiagnostics(): Promise<RuntimeDiagnosticsSnapshot> {
  return await sendMessage<RuntimeDiagnosticsSnapshot>({
    type: MESSAGE_TYPE.GET_RUNTIME_DIAGNOSTICS
  }, 'Failed to load runtime diagnostics');
}

export async function fetchRuntimeConfig(): Promise<SignerSettings> {
  return await sendMessage<SignerSettings>({
    type: MESSAGE_TYPE.GET_RUNTIME_CONFIG
  }, 'Failed to read runtime config');
}

export async function updateRuntimeConfig(
  settings: Partial<SignerSettings>
): Promise<SignerSettings> {
  return await sendMessage<SignerSettings>({
    type: MESSAGE_TYPE.UPDATE_RUNTIME_CONFIG,
    settings
  }, 'Failed to update runtime config');
}

export async function updateRuntimePeerPolicy(
  pubkey: string,
  patch: {
    direction: 'request' | 'respond';
    method: 'ping' | 'onboard' | 'sign' | 'ecdh';
    value: PolicyOverrideValue;
  }
): Promise<StoredPeerPolicy[]> {
  return await sendMessage<StoredPeerPolicy[]>({
    type: MESSAGE_TYPE.UPDATE_RUNTIME_PEER_POLICY,
    pubkey,
    patch
  }, 'Failed to update runtime peer policy');
}

export async function clearRuntimePeerPolicyOverrides(): Promise<StoredPeerPolicy[]> {
  return await sendMessage<StoredPeerPolicy[]>({
    type: MESSAGE_TYPE.CLEAR_RUNTIME_PEER_POLICY_OVERRIDES
  }, 'Failed to clear runtime peer policy overrides');
}

export async function startOnboarding(
  input: StartOnboardingInput
): Promise<StoredExtensionProfile> {
  return await sendMessage<StoredExtensionProfile>({
    type: MESSAGE_TYPE.START_ONBOARDING,
    input
  }, 'Failed to start onboarding');
}

export async function saveExtensionProfile(
  profile: StoredExtensionProfile
): Promise<StoredExtensionProfile> {
  return await sendMessage<StoredExtensionProfile>({
    type: MESSAGE_TYPE.SAVE_PROFILE,
    profile
  }, 'Failed to save extension profile');
}

export async function clearExtensionProfileState(): Promise<void> {
  await sendMessage<boolean>({
    type: MESSAGE_TYPE.CLEAR_PROFILE
  }, 'Failed to clear extension profile');
}

export async function sendRuntimeControl(
  action: RuntimeControlMessage['action']
): Promise<void> {
  await sendMessage<boolean>({
    type: MESSAGE_TYPE.RUNTIME_CONTROL,
    action
  }, `Failed runtime control action: ${action}`);
}
