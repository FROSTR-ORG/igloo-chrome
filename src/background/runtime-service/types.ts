import type {
  RuntimeDiagnosticsCore,
  RuntimePhase,
  RuntimeStatusSummary,
  StoredExtensionProfile,
} from '@/extension/protocol';
import type { ActiveRuntimeProfile, createProfileService } from '@/background/profile-service';
import { serviceError, serviceOk, toErrorMessage, type ServiceResult } from '@/background/utils';
import type { SignerSettings } from '@/lib/signer-settings';

export type ProfileService = ReturnType<typeof createProfileService>;

export type RuntimeBuild = {
  profile: StoredExtensionProfile;
  runtimeProfile: StoredExtensionProfile;
  localPayload: NonNullable<ActiveRuntimeProfile['payload']>;
  sessionKey: CryptoKey;
  restored: boolean;
};

export type RuntimeStatusUpdate = {
  runtime: RuntimePhase;
  status: RuntimeDiagnosticsCore['runtimeStatus'];
};

export type RuntimeDiagnosticsResult = RuntimeDiagnosticsCore;

export type RuntimeEnsureResult = {
  ensured: true;
};

export type RuntimeStartResult = {
  started: true;
};

export type RuntimeStopResult = {
  stopped: true;
};

export type RuntimeReloadResult = {
  reloaded: true;
};

export type RuntimeRefreshPeersResult = {
  refreshed: true;
};

export type RuntimeConfigResult = {
  settings: SignerSettings;
};

export type RuntimePeerPolicyResult = {
  peerPermissionStates: NonNullable<RuntimeStatusSummary['peer_permission_states']>;
};

export type RuntimePrepareResult = {
  runtime: RuntimePhase;
  readiness: unknown;
};

export type RuntimeProviderExecutionResult = {
  result: unknown;
};

export type RuntimeDiagnosticsEnvelope = {
  diagnostics: RuntimeDiagnosticsCore;
};

export type RuntimeServiceState = {
  ensuringConfiguredRuntime: Promise<void> | null;
  ensuringProfileId: string | null;
};

export type RuntimeServiceDependencies = {
  profileService: ProfileService;
  publishStateChanged: () => Promise<unknown>;
};

export type RuntimeServiceErrorCode =
  | 'runtime_stopped'
  | 'runtime_unavailable'
  | 'profile_missing'
  | 'runtime_not_configured'
  | 'missing_public_key'
  | 'runtime_restore_failed'
  | 'runtime_config_failed'
  | 'runtime_refresh_failed'
  | 'runtime_prepare_failed'
  | 'runtime_update_failed'
  | 'runtime_peer_policy_failed'
  | 'runtime_resolve_approval_failed'
  | 'runtime_provider_failed';

export class RuntimeServiceError extends Error {
  readonly code: RuntimeServiceErrorCode;
  readonly cause?: unknown;

  constructor(code: RuntimeServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'RuntimeServiceError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export type RuntimeServiceResult<T> = ServiceResult<T, RuntimeServiceError>;

export function runtimeServiceOk<T>(value: T): RuntimeServiceResult<T> {
  return serviceOk(value);
}

export function runtimeServiceError<T>(
  code: RuntimeServiceErrorCode,
  message: string,
  options?: { cause?: unknown }
): RuntimeServiceResult<T> {
  return serviceError(new RuntimeServiceError(code, message, options));
}

export function asRuntimeServiceError(
  error: unknown,
  code: RuntimeServiceErrorCode,
  fallback: string
): RuntimeServiceError {
  if (error instanceof RuntimeServiceError) {
    return error;
  }
  return new RuntimeServiceError(code, toErrorMessage(error, fallback), { cause: error });
}
