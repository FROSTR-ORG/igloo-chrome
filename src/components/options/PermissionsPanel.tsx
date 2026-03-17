import * as React from 'react';
import { OperatorPermissionsPanel } from 'igloo-ui';
import {
  clearRuntimePeerPolicyOverrides,
  sendRuntimeControl,
  updateRuntimePeerPolicy
} from '@/extension/client';
import { clearPermissionPolicies, removePermissionPolicy } from '@/extension/storage';
import type { StoredPermissionPolicy } from '@/extension/protocol';
import { useStore } from '@/lib/store';

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatMethod(value: string) {
  return value.replace(/^nostr\./, '');
}

export function PermissionsPanel() {
  const { appState } = useStore();
  const [sitePolicies, setSitePolicies] = React.useState<StoredPermissionPolicy[]>(appState?.permissionPolicies ?? []);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setSitePolicies(appState?.permissionPolicies ?? []);
  }, [appState?.permissionPolicies]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      await sendRuntimeControl('refreshAllPeers');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRevoke = React.useCallback(async (policy: StoredPermissionPolicy) => {
    setLoading(true);
    try {
      await removePermissionPolicy(policy);
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
  }, []);

  const handleClearAll = React.useCallback(async () => {
    setLoading(true);
    try {
      await clearPermissionPolicies();
      setSitePolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePeerPolicyChange = React.useCallback(
    async (
      pubkey: string,
      direction: 'request' | 'respond',
      method: 'ping' | 'onboard' | 'sign' | 'ecdh',
      value: 'unset' | 'allow' | 'deny'
    ) => {
      setLoading(true);
      try {
        await updateRuntimePeerPolicy(pubkey, {
          direction,
          method,
          value
        });
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleClearPeerOverrides = React.useCallback(async () => {
    setLoading(true);
    try {
      await clearRuntimePeerPolicyOverrides();
    } finally {
      setLoading(false);
    }
  }, []);

  const peerPolicies = appState?.runtime.summary?.peer_permission_states ?? [];
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
        send:
          policy.effectivePolicy.request.ping &&
          policy.effectivePolicy.request.onboard &&
          policy.effectivePolicy.request.sign &&
          policy.effectivePolicy.request.ecdh,
        receive:
          policy.effectivePolicy.respond.ping &&
          policy.effectivePolicy.respond.onboard &&
          policy.effectivePolicy.respond.sign &&
          policy.effectivePolicy.respond.ecdh,
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
          ? (pubkey, direction, method, value) =>
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
