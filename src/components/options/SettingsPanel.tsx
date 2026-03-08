import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ContentCard } from '@/components/ui/content-card';
import { clearPeerPolicies, type StoredProfile } from '@/lib/storage';
import { clearPermissionPolicies } from '@/extension/storage';

type SettingsPanelProps = {
  profile?: StoredProfile;
  onResetProfile: () => void;
};

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

export function SettingsPanel({ profile, onResetProfile }: SettingsPanelProps) {
  const [message, setMessage] = React.useState<string | null>(null);

  const runAction = React.useCallback(async (action: () => Promise<void> | void, success: string) => {
    try {
      await action();
      setMessage(success);
      window.setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
    }
  }, []);

  return (
    <div className="space-y-6">
      <ContentCard title="Profile Settings" description="Current signer metadata and relay configuration.">
        {!profile ? (
          <div className="rounded border border-dashed border-blue-900/30 px-4 py-6 text-sm text-gray-400">
            No profile is configured yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SettingBlock label="Signer Name" value={profile.keysetName || 'unnamed signer'} />
              <SettingBlock
                label="Public Key"
                value={profile.groupPublicKey || 'available after successful connect'}
                mono
              />
              <SettingBlock label="Peer Key" value={profile.peerPubkey || 'not decoded'} mono />
              <SettingBlock label="Relay Count" value={String(profile.relays.length)} />
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Relays</div>
              {profile.relays.map((relay) => (
                <div
                  key={relay}
                  className="rounded border border-blue-900/20 bg-gray-950/30 px-3 py-2 font-mono text-xs text-blue-100"
                >
                  {relay}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {profile.groupPublicKey && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void runAction(() => copyText(profile.groupPublicKey!), 'Public key copied')
                  }
                >
                  Copy Public Key
                </Button>
              )}
            </div>
          </div>
        )}
      </ContentCard>

      <ContentCard title="Maintenance" description="Operator controls similar to the old frost2x settings surface.">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runAction(() => clearPermissionPolicies(), 'Website permissions cleared')}
          >
            Clear Website Policies
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runAction(() => Promise.resolve(clearPeerPolicies()), 'Peer policies cleared')}
          >
            Clear Peer Policies
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void runAction(() => onResetProfile(), 'Profile cleared')}
            disabled={!profile}
          >
            Clear Profile
          </Button>
        </div>

        {message && (
          <div className="mt-4 rounded border border-blue-900/20 bg-blue-950/20 px-3 py-2 text-sm text-blue-100">
            {message}
          </div>
        )}
      </ContentCard>
    </div>
  );
}

function SettingBlock({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-blue-900/20 bg-gray-950/30 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-2 text-sm text-blue-100 ${mono ? 'break-all font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}
