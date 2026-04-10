export type LifecycleSource = 'options' | 'background';

export type LifecycleFailureCode =
  | 'decode_failed'
  | 'onboard_timeout'
  | 'onboard_rejected'
  | 'runtime_unavailable'
  | 'ui_transition_failed'
  | 'runtime_restore_failed'
  | 'status_sync_failed';

export type LifecycleFailure = {
  code: LifecycleFailureCode;
  message: string;
  source: LifecycleSource;
  updatedAt: number;
};

export type OnboardingStage =
  | 'idle'
  | 'decoding_package'
  | 'connecting_peer'
  | 'awaiting_onboard_response'
  | 'snapshot_captured'
  | 'profile_persisted'
  | 'failed';

export type ActivationStage =
  | 'idle'
  | 'restoring_runtime'
  | 'ready'
  | 'degraded'
  | 'failed';

export type OnboardingLifecycleState = {
  stage: OnboardingStage;
  updatedAt: number | null;
  lastError: LifecycleFailure | null;
};

export type ActivationLifecycleState = {
  stage: ActivationStage;
  updatedAt: number | null;
  lastError: LifecycleFailure | null;
  restoredFromSnapshot: boolean;
  runtime: 'cold' | 'restoring' | 'ready' | 'degraded';
};

export type LifecycleStatusSnapshot = {
  onboarding: OnboardingLifecycleState;
  activation: ActivationLifecycleState;
};

export type LifecycleTransitionRecord = {
  domain: 'onboarding' | 'activation';
  stage: OnboardingStage | ActivationStage;
  source: LifecycleSource;
  ts: number;
  detail?: Record<string, unknown>;
  failure?: LifecycleFailure | null;
};
