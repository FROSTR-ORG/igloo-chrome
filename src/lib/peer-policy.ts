import {
  isRecord,
  type PolicyOverrideValue,
  type RuntimeMethodPolicy,
  type RuntimeMethodPolicyOverride,
  type StoredPeerPolicy,
} from '@/extension/protocol';

const DEFAULT_METHOD_POLICY: RuntimeMethodPolicy = {
  ping: false,
  onboard: false,
  sign: false,
  ecdh: false,
};

const DEFAULT_METHOD_POLICY_OVERRIDE: RuntimeMethodPolicyOverride = {
  ping: 'unset',
  onboard: 'unset',
  sign: 'unset',
  ecdh: 'unset',
};

function normalizePolicyFlag(value: unknown) {
  return value === true;
}

function normalizeOverrideValue(value: unknown): PolicyOverrideValue {
  return value === 'allow' || value === 'deny' ? value : 'unset';
}

function normalizeMethodPolicy(value: unknown): RuntimeMethodPolicy {
  return {
    ping: normalizePolicyFlag(isRecord(value) ? value.ping : undefined),
    onboard: normalizePolicyFlag(isRecord(value) ? value.onboard : undefined),
    sign: normalizePolicyFlag(isRecord(value) ? value.sign : undefined),
    ecdh: normalizePolicyFlag(isRecord(value) ? value.ecdh : undefined),
  };
}

function normalizeMethodPolicyOverride(value: unknown): RuntimeMethodPolicyOverride {
  return {
    ping: normalizeOverrideValue(isRecord(value) ? value.ping : undefined),
    onboard: normalizeOverrideValue(isRecord(value) ? value.onboard : undefined),
    sign: normalizeOverrideValue(isRecord(value) ? value.sign : undefined),
    ecdh: normalizeOverrideValue(isRecord(value) ? value.ecdh : undefined),
  };
}

export function normalizeStoredPeerPolicy(value: unknown): StoredPeerPolicy | null {
  if (!isRecord(value) || typeof value.pubkey !== 'string' || !value.pubkey.trim()) {
    return null;
  }

  const manualOverride = isRecord(value.manualOverride) ? value.manualOverride : null;
  const remoteObservation = isRecord(value.remoteObservation) ? value.remoteObservation : null;
  const effectivePolicy = isRecord(value.effectivePolicy) ? value.effectivePolicy : null;

  return {
    pubkey: value.pubkey.trim().toLowerCase(),
    manualOverride: {
      request: normalizeMethodPolicyOverride(manualOverride?.request ?? DEFAULT_METHOD_POLICY_OVERRIDE),
      respond: normalizeMethodPolicyOverride(manualOverride?.respond ?? DEFAULT_METHOD_POLICY_OVERRIDE),
    },
    remoteObservation: remoteObservation
      ? {
          request: normalizeMethodPolicy(remoteObservation.request ?? DEFAULT_METHOD_POLICY),
          respond: normalizeMethodPolicy(remoteObservation.respond ?? DEFAULT_METHOD_POLICY),
          updated: typeof remoteObservation.updated === 'number' ? remoteObservation.updated : 0,
          revision: typeof remoteObservation.revision === 'number' ? remoteObservation.revision : 0,
        }
      : null,
    effectivePolicy: {
      request: normalizeMethodPolicy(effectivePolicy?.request ?? DEFAULT_METHOD_POLICY),
      respond: normalizeMethodPolicy(effectivePolicy?.respond ?? DEFAULT_METHOD_POLICY),
    },
  };
}

export function normalizeStoredPeerPolicies(values: unknown): StoredPeerPolicy[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.flatMap((value) => {
    const normalized = normalizeStoredPeerPolicy(value);
    return normalized ? [normalized] : [];
  });
}

export function peerAllowsAllRequests(policy: Pick<StoredPeerPolicy, 'effectivePolicy'>) {
  return (
    policy.effectivePolicy.request.ping &&
    policy.effectivePolicy.request.onboard &&
    policy.effectivePolicy.request.sign &&
    policy.effectivePolicy.request.ecdh
  );
}

export function peerAllowsAllResponses(policy: Pick<StoredPeerPolicy, 'effectivePolicy'>) {
  return (
    policy.effectivePolicy.respond.ping &&
    policy.effectivePolicy.respond.onboard &&
    policy.effectivePolicy.respond.sign &&
    policy.effectivePolicy.respond.ecdh
  );
}
