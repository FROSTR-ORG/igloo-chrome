import * as React from 'react';
import {
  OperatorPermissionsPanel,
  type OperatorMethodPermissionOverride,
  type OperatorPolicyOverrideValue,
} from 'igloo-ui';
import type { StoredPermissionPolicy } from '@/extension/protocol';
import {
  normalizeStoredPeerPolicies,
  peerAllowsAllRequests,
  peerAllowsAllResponses,
} from '@/lib/peer-policy';
import { useStore } from '@/lib/store';

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatMethod(value: string) {
  return value.replace(/^nostr\./, '');
}

export function PermissionsPanel() {
  const {
    appState,
    clearPeerPolicyOverrides,
    clearSitePermissions,
    refreshRuntimePeers,
    revokeSitePermission,
    updatePeerPolicy,
  } = useStore();
  const [sitePolicies, setSitePolicies] = React.useState<StoredPermissionPolicy[]>(appState?.permissionPolicies ?? []);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setSitePolicies(appState?.permissionPolicies ?? []);
  }, [appState?.permissionPolicies]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      await refreshRuntimePeers();
    } finally {
      setLoading(false);
    }
  }, [refreshRuntimePeers]);

  const handleRevoke = React.useCallback(async (policy: StoredPermissionPolicy) => {
    setLoading(true);
    try {
      await revokeSitePermission(policy);
      setSitePolicies((current) =>
        current.filter(
          (entry) =>
            !(
              entry.host === policy.host &&
              entry.type === policy.type &&
              entry.allow === policy.allow &&
              entry.kind === policy.kind &&
              entry.createdAt === policy.createdAt
            )
        )
      );
    } finally {
      setLoading(false);
    }
  }, [revokeSitePermission]);

  const handleClearAll = React.useCallback(async () => {
    setLoading(true);
    try {
      await clearSitePermissions();
      setSitePolicies([]);
    } finally {
      setLoading(false);
    }
  }, [clearSitePermissions]);

  const handlePeerPolicyChange = React.useCallback(
    async (
      pubkey: string,
      direction: 'request' | 'respond',
      method: 'ping' | 'onboard' | 'sign' | 'ecdh',
      value: 'unset' | 'allow' | 'deny'
    ) => {
      setLoading(true);
      try {
        await updatePeerPolicy(pubkey, {
          direction,
          method,
          value
        });
      } finally {
        setLoading(false);
      }
    },
    [updatePeerPolicy]
  );

  const handleClearPeerOverrides = React.useCallback(async () => {
    setLoading(true);
    try {
      await clearPeerPolicyOverrides();
    } finally {
      setLoading(false);
    }
  }, [clearPeerPolicyOverrides]);

  const peerPolicies = React.useMemo(
    () => normalizeStoredPeerPolicies(appState?.runtime.summary?.peer_permission_states),
    [appState?.runtime.summary?.peer_permission_states]
  );
  const runtimeActive = appState?.runtime.phase === 'ready' || appState?.runtime.phase === 'degraded';

  return (
    <OperatorPermissionsPanel
      sitePermissions={sitePolicies.map((policy) => ({
        id: `${policy.host}-${policy.type}-${policy.createdAt}-${policy.kind ?? 'any'}`,
        host: policy.host,
        methodLabel: formatMethod(policy.type),
        scopeLabel: typeof policy.kind === 'number' ? `kind ${policy.kind}` : 'all kinds',
        createdAtLabel: formatTimestamp(policy.createdAt),
        allow: policy.allow,
      }))}
      peerPermissions={runtimeActive ? peerPolicies.map((policy) => ({
        pubkey: policy.pubkey,
        send: peerAllowsAllRequests(policy),
        receive: peerAllowsAllResponses(policy),
      })) : []}
      peerPermissionStates={runtimeActive ? peerPolicies.map((policy) => ({
        pubkey: policy.pubkey,
        manualOverride: policy.manualOverride,
        remoteObservation: policy.remoteObservation,
        effectivePolicy: policy.effectivePolicy
      })) : []}
      loading={loading}
      onRefresh={() => void refresh()}
      onClearAllSitePermissions={() => void handleClearAll()}
      onRevokeSitePermission={(permissionId: string) => {
        const target = sitePolicies.find(
          (policy) => `${policy.host}-${policy.type}-${policy.createdAt}-${policy.kind ?? 'any'}` === permissionId,
        );
        if (target) void handleRevoke(target);
      }}
      onClearAllPeerPermissions={runtimeActive ? () => void handleClearPeerOverrides() : undefined}
      onPeerPermissionOverrideChange={
        runtimeActive
          ? (
              pubkey: string,
              direction: 'request' | 'respond',
              method: keyof OperatorMethodPermissionOverride,
              value: OperatorPolicyOverrideValue
            ) =>
              void handlePeerPolicyChange(pubkey, direction, method, value)
          : undefined
      }
      peerClearAllLabel="Remove Overrides"
      siteDescription="Permissions granted to websites through the NIP-07 style bridge."
      peerDescription="Live outbound and inbound peer policy state for the active signer runtime."
      peerEmptyText={
        runtimeActive
          ? 'No live peer policy state is currently available from the signer runtime.'
          : 'Start the signer to inspect and edit live peer policy state.'
      }
    />
  );
}
