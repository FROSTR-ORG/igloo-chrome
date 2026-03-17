import * as React from 'react';
import { OperatorSettingsPanel } from 'igloo-ui';
import {
  fetchExtensionStatus,
  fetchRuntimeConfig,
  sendRuntimeControl,
  updateRuntimeConfig
} from '@/extension/client';
import { DEFAULT_RELAYS, normalizeRelays } from '@/lib/igloo';
import { type StoredProfile } from '@/lib/storage';
import {
  normalizeSignerSettings,
  type SignerSettings
} from '@/lib/signer-settings';

type SettingsPanelProps = {
  profile?: StoredProfile;
  saveProfile: (profile: StoredProfile) => Promise<void>;
  wipeAllData: () => Promise<void>;
};

export function SettingsPanel({ profile, saveProfile, wipeAllData }: SettingsPanelProps) {
  const [message, setMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [signerName, setSignerName] = React.useState(profile?.keysetName ?? '');
  const [relays, setRelays] = React.useState<string[]>(profile?.relays?.length ? profile.relays : DEFAULT_RELAYS);
  const [newRelayUrl, setNewRelayUrl] = React.useState('');
  const [settings, setSettings] = React.useState<SignerSettings>(
    normalizeSignerSettings(profile?.signerSettings)
  );

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

      const nextProfile: StoredProfile = {
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
          label: 'Wipe All Data',
          variant: 'destructive',
          disabled: !profile,
          onClick: () => void runAction(() => wipeAllData(), 'All signer data wiped'),
        },
      ]}
    />
  );
}
