import * as React from 'react';
import { ContentCard, Input, OperatorSettingsPanel, Textarea, Button } from 'igloo-ui';
import {
  completeRotationOnboarding,
  fetchExtensionStatus,
  fetchRuntimeConfig,
  startOnboarding,
  sendRuntimeControl,
  updateRuntimeConfig
} from '@/extension/client';
import type { PendingOnboardingProfile, StoredExtensionProfile } from '@/extension/protocol';
import { DEFAULT_RELAYS, normalizeRelays } from '@/lib/igloo';
import {
  normalizeSignerSettings,
  type SignerSettings
} from '@/lib/signer-settings';

type SettingsPanelProps = {
  profile?: StoredExtensionProfile;
  saveProfile: (profile: StoredExtensionProfile) => Promise<void>;
  logout: () => void;
  wipeAllData: () => Promise<void>;
};

export function SettingsPanel({ profile, saveProfile, logout, wipeAllData }: SettingsPanelProps) {
  const [message, setMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [signerName, setSignerName] = React.useState(profile?.keysetName ?? '');
  const [relays, setRelays] = React.useState<string[]>(profile?.relays?.length ? profile.relays : DEFAULT_RELAYS);
  const [newRelayUrl, setNewRelayUrl] = React.useState('');
  const [settings, setSettings] = React.useState<SignerSettings>(
    normalizeSignerSettings(profile?.signerSettings)
  );
  const [rotatePackage, setRotatePackage] = React.useState('');
  const [rotatePassword, setRotatePassword] = React.useState('');
  const [pendingRotation, setPendingRotation] = React.useState<PendingOnboardingProfile | null>(null);
  const [rotating, setRotating] = React.useState(false);

  const runAction = React.useCallback(async (action: () => Promise<void> | void, success: string) => {
    try {
      await action();
      setMessage(success);
      window.setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
    }
  }, []);

  React.useEffect(() => {
    setSignerName(profile?.keysetName ?? '');
    setRelays(profile?.relays?.length ? profile.relays : DEFAULT_RELAYS);
  }, [profile]);

  React.useEffect(() => {
    let cancelled = false;
    void fetchRuntimeConfig()
      .then((runtimeConfig) => {
        if (!cancelled) {
          setSettings(normalizeSignerSettings(runtimeConfig));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const handleAddRelay = () => {
    const normalized = newRelayUrl.trim();
    if (!normalized || relays.includes(normalized)) return;
    setRelays((current) => [...current, normalized]);
    setNewRelayUrl('');
  };

  const handleRemoveRelay = (target: string) => {
    setRelays((current) => current.filter((relay) => relay !== target));
  };

  const handleNumberField = (
    field: keyof Omit<SignerSettings, 'peer_selection_strategy'>,
    value: string
  ) => {
    const parsed = Number.parseInt(value, 10);
    setSettings((current) => ({
      ...current,
      [field]: Number.isFinite(parsed) && parsed > 0 ? parsed : current[field]
    }));
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    setMessage(null);
    try {
      const normalizedSettings = normalizeSignerSettings(settings);
      const { relays: normalizedRelayList, errors } = normalizeRelays(relays.length ? relays : DEFAULT_RELAYS);
      if (errors.length > 0) {
        throw new Error(errors[0]);
      }

      const nextProfile: StoredExtensionProfile = {
        ...profile,
        keysetName: signerName.trim() || undefined,
        relays: normalizedRelayList,
        signerSettings: normalizedSettings
      };

      delete nextProfile.peerPubkey;

      const previousRelays = normalizeRelays(profile.relays ?? DEFAULT_RELAYS).relays;
      const relayChanged = JSON.stringify(previousRelays) !== JSON.stringify(normalizedRelayList);

      await saveProfile(nextProfile);
      const status = await fetchExtensionStatus().catch(() => null);
      if (status?.runtime === 'ready') {
        await updateRuntimeConfig(normalizedSettings);
        if (relayChanged) {
          await sendRuntimeControl('reloadConfiguredRuntime');
        }
      }

      setRelays(normalizedRelayList);
      setSettings(normalizedSettings);
      setMessage(relayChanged ? 'Settings saved and signer reloaded' : 'Settings saved');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleConnectRotation = async () => {
    if (!profile) return;
    setRotating(true);
    setMessage(null);
    try {
      const pending = await startOnboarding({
        onboardPackage: rotatePackage.trim(),
        onboardPassword: rotatePassword,
      });
      if (pending.profilePayload.group.groupPublicKey !== profile.groupPublicKey) {
        throw new Error('Rotation package does not match the active profile group public key.');
      }
      if (pending.profilePayload.profileId === profile.id) {
        throw new Error('Rotation package did not produce a new device profile id.');
      }
      setPendingRotation(pending);
      setMessage('Rotation package connected. Review and confirm the replacement.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  };

  const handleConfirmRotation = async () => {
    if (!profile || !pendingRotation) return;
    setRotating(true);
    setMessage(null);
    try {
      await completeRotationOnboarding({
        targetProfileId: profile.id,
        pendingProfile: pendingRotation,
      });
      setPendingRotation(null);
      setRotatePackage('');
      setRotatePassword('');
      setMessage('Device key rotated and profile replaced');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  };

  return (
    <OperatorSettingsPanel
      hasProfile={Boolean(profile)}
      signerName={signerName}
      onSignerNameChange={setSignerName}
      relays={relays}
      newRelayUrl={newRelayUrl}
      onNewRelayUrlChange={setNewRelayUrl}
      onAddRelay={handleAddRelay}
      onRemoveRelay={handleRemoveRelay}
      signerSettings={settings}
      onSignerSettingNumberChange={handleNumberField}
      onPeerSelectionStrategyChange={(value: 'deterministic_sorted' | 'random') =>
        setSettings((current) => ({
          ...current,
          peer_selection_strategy: value,
        }))
      }
      onSave={() => void handleSave()}
      saving={saving}
      message={message}
      maintenanceActions={[
        {
          label: 'Log Out',
          variant: 'secondary',
          disabled: !profile,
          onClick: () => void runAction(() => logout(), 'Logged out of active profile'),
        },
        {
          label: 'Wipe All Data',
          variant: 'destructive',
          disabled: !profile,
          onClick: () => void runAction(() => wipeAllData(), 'All signer data wiped'),
        },
      ]}
      extraSections={
        profile ? (
          <ContentCard
            title="Rotate Key"
            description="Apply a rotated bfonboard package to replace this device share while preserving the same keyset."
          >
            <div className="space-y-4">
              {!pendingRotation ? (
                <>
                  <label className="block">
                    <div className="text-xs uppercase tracking-wide text-gray-500">bfonboard</div>
                    <Textarea
                      className="mt-2 min-h-[120px] text-sm font-mono"
                      placeholder="bfonboard1..."
                      value={rotatePackage}
                      onChange={(event) => setRotatePackage(event.target.value)}
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Package Password</div>
                    <Input
                      className="mt-2"
                      type="password"
                      value={rotatePassword}
                      onChange={(event) => setRotatePassword(event.target.value)}
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!rotatePackage.trim() || rotatePassword.trim().length < 8 || rotating}
                      onClick={() => void handleConnectRotation()}
                    >
                      {rotating ? 'Connecting…' : 'Connect Rotation Package'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded border border-cyan-900/30 bg-cyan-950/20 px-3 py-3 text-sm text-cyan-100">
                    Same keyset, fresh device share. Confirm to replace the active device profile with the rotated share.
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded border border-blue-900/20 bg-gray-950/30 p-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Profile Label</div>
                      <div className="mt-1 text-sm text-blue-100">{profile.keysetName ?? 'Device'}</div>
                    </div>
                    <div className="rounded border border-blue-900/20 bg-gray-950/30 p-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500">Group Public Key</div>
                      <div className="mt-1 truncate text-sm text-blue-100">{pendingRotation.profilePayload.group.groupPublicKey}</div>
                    </div>
                    <div className="rounded border border-blue-900/20 bg-gray-950/30 p-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500">New Profile Id</div>
                      <div className="mt-1 truncate text-sm text-blue-100">{pendingRotation.profilePayload.profileId}</div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPendingRotation(null)} disabled={rotating}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleConfirmRotation()} disabled={rotating}>
                      {rotating ? 'Replacing…' : 'Replace Active Device'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </ContentCard>
        ) : null
      }
    />
  );
}
