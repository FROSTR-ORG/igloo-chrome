import * as React from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  Alert,
  Button,
  ContentCard,
  Input,
  Label,
  PasswordField,
  ProfileConfirmationCard,
} from 'igloo-ui';

import type { PendingOnboardingProfile } from '@/extension/protocol';
import { errorMessage, type PendingConnect } from './types';

export default function SaveOnboardedDevice({
  pendingConnect,
  completeOnboarding,
  clearOnboardingFailure,
  onBack,
}: {
  pendingConnect: PendingConnect;
  completeOnboarding: (
    pendingProfile: PendingOnboardingProfile,
    label: string,
    password: string,
  ) => Promise<unknown>;
  clearOnboardingFailure: () => void;
  onBack: () => void;
}) {
  const [signerName, setSignerName] = React.useState('');
  const [localProfilePassword, setLocalProfilePassword] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSignerName(pendingConnect.profile.groupName ?? pendingConnect.profile.profilePayload.device.name ?? '');
    setLocalProfilePassword(pendingConnect.packagePassword);
    setError(null);
  }, [pendingConnect]);

  const canSave =
    signerName.trim().length > 0 && localProfilePassword.trim().length >= 8 && Boolean(pendingConnect);
  const previewName = pendingConnect.profile.groupName ?? (signerName.trim() || 'Onboarded device');

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    clearOnboardingFailure();
    try {
      await completeOnboarding(pendingConnect.profile, signerName.trim(), localProfilePassword);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ContentCard
      title="Save Onboarded Device"
      description="The onboarding package has been resolved. Confirm the read-only profile details, then save this device locally."
      onBack={onBack}
      backButtonTooltip="Back to device entry"
    >
      <div className="space-y-4">
        <ProfileConfirmationCard
          profileName={previewName}
          sharePublicKey={pendingConnect.profile.sharePublicKey ?? ''}
          groupPublicKey={pendingConnect.profile.groupPublicKey ?? pendingConnect.profile.publicKey ?? ''}
          relays={pendingConnect.profile.relays}
        />

        <form onSubmit={onSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm text-blue-300">Signer Name</Label>
            <Input
              type="text"
              placeholder="e.g. Laptop Signer, Browser Node A"
              value={signerName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSignerName(e.target.value)}
              disabled={saving}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-blue-300">Local Profile Password</Label>
            <PasswordField
              placeholder="Minimum 8 characters"
              value={localProfilePassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLocalProfilePassword(e.target.value)}
              disabled={saving}
              required
            />
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={!canSave || saving}>
              {saving ? 'Saving…' : 'Save Device'}
            </Button>
          </div>
        </form>
      </div>
    </ContentCard>
  );
}
