import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ContentCard } from '@/components/ui/content-card';
import {
  clearPermissionPolicies,
  loadExtensionPeerPolicies,
  loadPermissionPolicies,
  removePermissionPolicy
} from '@/extension/storage';
import type { StoredPermissionPolicy } from '@/extension/protocol';
import type { StoredPeerPolicy } from '@/extension/protocol';

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatMethod(value: string) {
  return value.replace(/^nostr\./, '');
}

export function PermissionsPanel() {
  const [policies, setPolicies] = React.useState<StoredPermissionPolicy[]>([]);
  const [peerPolicies, setPeerPolicies] = React.useState<StoredPeerPolicy[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [loadedPolicies, loadedPeers] = await Promise.all([
        loadPermissionPolicies(),
        loadExtensionPeerPolicies()
      ]);
      setPolicies(loadedPolicies);
      setPeerPolicies(loadedPeers);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRevoke = React.useCallback(
    async (policy: StoredPermissionPolicy) => {
      await removePermissionPolicy(policy);
      await refresh();
    },
    [refresh]
  );

  const handleClearAll = React.useCallback(async () => {
    await clearPermissionPolicies();
    await refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <ContentCard
        title="Site Policies"
        description="Permissions granted to websites through the NIP-07 style bridge."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleClearAll()} disabled={!policies.length}>
              Clear All
            </Button>
          </div>
        }
      >
        {policies.length === 0 ? (
          <div className="rounded border border-dashed border-blue-900/30 px-4 py-6 text-sm text-gray-400">
            No website permissions have been granted yet.
          </div>
        ) : (
          <div className="space-y-3">
            {policies.map((policy) => (
              <div
                key={`${policy.host}-${policy.type}-${policy.createdAt}-${policy.kind ?? 'any'}`}
                className="rounded-lg border border-blue-900/20 bg-gray-950/30 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-blue-200">{policy.host}</div>
                    <div className="text-xs text-gray-400">
                      Method: {formatMethod(policy.type)}
                      {typeof policy.kind === 'number' ? ` • kind ${policy.kind}` : ' • all kinds'}
                    </div>
                    <div className="text-xs text-gray-500">Saved: {formatTimestamp(policy.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        policy.allow
                          ? 'bg-green-500/20 text-green-300 ring-1 ring-green-500/30'
                          : 'bg-red-500/20 text-red-300 ring-1 ring-red-500/30'
                      }`}
                    >
                      {policy.allow ? 'allow' : 'deny'}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => void handleRevoke(policy)}>
                      Revoke
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ContentCard>

      <ContentCard
        title="Peer Policies"
        description="Stored inbound and outbound peer rules mirrored from the signer tab."
      >
        {peerPolicies.length === 0 ? (
          <div className="rounded border border-dashed border-blue-900/30 px-4 py-6 text-sm text-gray-400">
            No peer policy state has been saved yet.
          </div>
        ) : (
          <div className="space-y-3">
            {peerPolicies.map((policy) => (
              <div
                key={policy.pubkey}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-900/20 bg-gray-950/30 p-4"
              >
                <div className="font-mono text-sm text-blue-200">{policy.pubkey}</div>
                <div className="flex gap-2 text-xs">
                  <span className="rounded-full bg-blue-500/20 px-2.5 py-1 text-blue-200">
                    send: {policy.send ? 'allow' : 'deny'}
                  </span>
                  <span className="rounded-full bg-blue-500/20 px-2.5 py-1 text-blue-200">
                    receive: {policy.receive ? 'allow' : 'deny'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ContentCard>
    </div>
  );
}
