import * as React from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  Alert,
  AppHeader,
  Button,
  ContentCard,
  CRITICAL_E2E_TEST_IDS,
  Input,
  Label,
  PageLayout,
  PasswordField,
  ProfileConfirmationCard,
  StoredProfilesLandingCard,
  Textarea
} from 'igloo-ui';
import { useStore } from '@/lib/store';
import { shortProfileId, validateOnboardCredential, validateOnboardingPassword } from '@/lib/igloo';
import type { PendingOnboardingProfile } from '@/extension/protocol';

type PendingConnect = {
  kind: 'bfonboard';
  profile: PendingOnboardingProfile;
};

function packageLooksLike(value: string, prefix: 'bfprofile1' | 'bfshare1') {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return { isValid: false, error: 'Package is required.' };
  if (!normalized.startsWith(prefix)) {
    return { isValid: false, error: `Expected ${prefix}...` };
  }
  return { isValid: true, error: null };
}

export default function OnboardingPage() {
  const {
    appState,
    connectOnboarding,
    completeOnboarding,
    importProfile,
    activateProfile,
    unlockProfile,
    deleteProfile,
    lastOnboardingFailure,
    clearOnboardingFailure
  } = useStore();

  const [pendingConnect, setPendingConnect] = React.useState<PendingConnect | null>(null);
  const profiles = appState?.profiles ?? [];

  const [onboardPackage, setOnboardPackage] = React.useState('');
  const [onboardPassword, setOnboardPassword] = React.useState('');
  const [signerName, setSignerName] = React.useState('');
  const [localProfilePassword, setLocalProfilePassword] = React.useState('');

  const [bfprofilePackage, setBfprofilePackage] = React.useState('');
  const [bfprofilePassword, setBfprofilePassword] = React.useState('');
  const [selectedProfileId, setSelectedProfileId] = React.useState('');
  const [unlockProfileId, setUnlockProfileId] = React.useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = React.useState('');

  const [connecting, setConnecting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [importingProfile, setImportingProfile] = React.useState(false);
  const [activatingProfileId, setActivatingProfileId] = React.useState<string | null>(null);
  const [deletingProfileId, setDeletingProfileId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onboardValidation = React.useMemo(
    () => validateOnboardCredential(onboardPackage),
    [onboardPackage]
  );
  const onboardPasswordValidation = React.useMemo(
    () => validateOnboardingPassword(onboardPassword),
    [onboardPassword]
  );
  const bfprofileValidation = React.useMemo(
    () => packageLooksLike(bfprofilePackage, 'bfprofile1'),
    [bfprofilePackage]
  );

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const onboard = params.get('onboard');
    const password = params.get('password');
    if (onboard) {
      setOnboardPackage(onboard.trim());
    }
    if (password) {
      setOnboardPassword(password);
    }
  }, []);

  React.useEffect(() => {
    setSelectedProfileId((current) =>
      current && profiles.some((profile) => profile.id === current) ? current : (profiles[0]?.id ?? '')
    );
    setUnlockProfileId((current) =>
      current && profiles.some((profile) => profile.id === current) ? current : null
    );
  }, [profiles]);

  const canConnectOnboard = onboardValidation.isValid && onboardPasswordValidation.isValid;
  const canImportProfile = bfprofileValidation.isValid && bfprofilePassword.trim().length >= 8;
  const canSaveOnboard =
    signerName.trim().length > 0 && localProfilePassword.trim().length >= 8 && !!pendingConnect;

  const previewName = pendingConnect
    ? pendingConnect.profile.groupName ?? (signerName.trim() || 'Onboarded device')
    : 'Onboarded device';

  async function onConnectOnboarding(e: FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    clearOnboardingFailure();
    try {
      const profile = await connectOnboarding({
        onboardPackage: onboardPackage.trim(),
        onboardPassword
      });
      setPendingConnect({ kind: 'bfonboard', profile });
      setSignerName(profile.groupName ?? profile.profilePayload.device.name ?? '');
      setLocalProfilePassword(onboardPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  async function onSaveOnboarding(e: FormEvent) {
    e.preventDefault();
    if (!pendingConnect) return;
    setSaving(true);
    setError(null);
    clearOnboardingFailure();
    try {
      await completeOnboarding(pendingConnect.profile, signerName.trim(), localProfilePassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onImportBfprofile(e: FormEvent) {
    e.preventDefault();
    setImportingProfile(true);
    setError(null);
    try {
      await importProfile(bfprofilePackage.trim(), bfprofilePassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingProfile(false);
    }
  }

  async function onActivateExisting(profileId: string) {
    setActivatingProfileId(profileId);
    setError(null);
    try {
      await activateProfile(profileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivatingProfileId(null);
    }
  }

  async function onUnlockExisting(profileId: string) {
    setActivatingProfileId(profileId);
    setError(null);
    try {
      await unlockProfile(profileId, unlockPassword);
      setUnlockProfileId(null);
      setUnlockPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivatingProfileId(null);
    }
  }

  async function onLoadStoredProfile(profileId: string) {
    const profile = profiles.find((entry) => entry.id === profileId);
    if (!profile) {
      return;
    }
    if (appState?.configured && appState.activeProfileId === profileId) {
      return;
    }
    if (profile.unlocked) {
      await onActivateExisting(profileId);
      return;
    }
    setSelectedProfileId(profileId);
    setUnlockProfileId(profileId);
    setUnlockPassword('');
    setError(null);
  }

  async function onDeleteStoredProfile(profileId: string) {
    const profile = profiles.find((entry) => entry.id === profileId);
    const confirmed = window.confirm(
      `Delete stored profile ${profile?.label || 'Unnamed device'} (${shortProfileId(profileId)})?`,
    );
    if (!confirmed) {
      return;
    }
    setDeletingProfileId(profileId);
    setError(null);
    try {
      await deleteProfile(profileId);
      if (unlockProfileId === profileId) {
        setUnlockProfileId(null);
        setUnlockPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingProfileId(null);
    }
  }

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const selectedLockedProfile =
    unlockProfileId ? profiles.find((profile) => profile.id === unlockProfileId) ?? null : null;

  return (
    <PageLayout header={<AppHeader mode="task" taskLabel="browser signing device" />}>
      {pendingConnect ? (
        <ContentCard
          title="Save Onboarded Device"
          description="The onboarding package has been resolved. Confirm the read-only profile details, then save this device locally."
          onBack={() => setPendingConnect(null)}
          backButtonTooltip="Back to device entry"
        >
          <div className="space-y-4">
            <ProfileConfirmationCard
              profileName={previewName}
              sharePublicKey={pendingConnect.profile.sharePublicKey ?? ''}
              groupPublicKey={pendingConnect.profile.groupPublicKey ?? pendingConnect.profile.publicKey ?? ''}
              relays={pendingConnect.profile.relays}
            />

            <form onSubmit={onSaveOnboarding} className="space-y-4">
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

              {error && (
                <Alert tone="danger">{error}</Alert>
              )}

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={!canSaveOnboard || saving}>
                  {saving ? 'Saving…' : 'Save Device'}
                </Button>
              </div>
            </form>
          </div>
        </ContentCard>
      ) : (
        <div className="space-y-6">
          <ContentCard
            title="Choose Device"
            description="Select a stored profile to load or delete it, or import new device material into this extension."
          >
            <StoredProfilesLandingCard
              profiles={profiles.map((profile) => {
                const isActive = Boolean(appState?.configured && appState.activeProfileId === profile.id);
                return {
                  id: profile.id,
                  label: profile.label || 'Unnamed device',
                  shortId: shortProfileId(profile.id),
                  state: isActive ? 'active' : profile.unlocked ? 'available' : 'locked',
                  primaryActionLabel:
                    activatingProfileId === profile.id
                      ? profile.unlocked
                        ? 'Loading…'
                        : 'Unlocking…'
                      : isActive
                        ? 'Open Dashboard'
                        : 'Load Profile',
                  destructiveActionLabel:
                    deletingProfileId === profile.id ? 'Deleting…' : 'Delete Profile',
                };
              })}
              selectedProfileId={selectedProfileId}
              description="Stored profiles stay encrypted locally. Select one first, then load it for this browser session or remove it from this extension."
              onSelect={(profileId) => {
                setSelectedProfileId(profileId);
                if (unlockProfileId && unlockProfileId !== profileId) {
                  setUnlockProfileId(null);
                  setUnlockPassword('');
                }
                setError(null);
              }}
              onLoad={(profileId) => void onLoadStoredProfile(profileId)}
              onDelete={(profileId) => void onDeleteStoredProfile(profileId)}
              loadDisabled={Boolean(activatingProfileId) || Boolean(deletingProfileId)}
              deleteDisabled={Boolean(activatingProfileId) || Boolean(deletingProfileId)}
              renderProfileDetail={(profile, isSelected) =>
                selectedLockedProfile &&
                selectedLockedProfile.id === profile.id &&
                isSelected ? (
                  <div className="mt-4 space-y-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-cyan-100">Unlock Stored Profile</div>
                      <div className="text-xs text-cyan-400">
                        Enter the local profile password to unlock this device for the current browser session.
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm text-blue-300">Profile Password</Label>
                      <PasswordField
                        placeholder="Enter profile password"
                        value={unlockPassword}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setUnlockPassword(e.target.value)}
                        disabled={activatingProfileId === selectedLockedProfile.id}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setUnlockProfileId(null);
                          setUnlockPassword('');
                        }}
                        disabled={activatingProfileId === selectedLockedProfile.id}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        data-testid={CRITICAL_E2E_TEST_IDS.storedProfileUnlockSubmit}
                        disabled={
                          activatingProfileId === selectedLockedProfile.id ||
                          unlockPassword.trim().length < 8
                        }
                        onClick={() => void onUnlockExisting(selectedLockedProfile.id)}
                      >
                        {activatingProfileId === selectedLockedProfile.id ? 'Unlocking…' : 'Unlock Profile'}
                      </Button>
                    </div>
                  </div>
                ) : null
              }
            />
          </ContentCard>

          <div className="grid gap-6 xl:grid-cols-3">
            <ContentCard
              title="Load bfprofile"
              description="Import a full encrypted device profile package and load it into the extension."
            >
              <form onSubmit={onImportBfprofile} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm text-blue-300">bfprofile</Label>
                  <Textarea
                    placeholder="bfprofile1..."
                    value={bfprofilePackage}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBfprofilePackage(e.target.value)}
                    rows={3}
                    className="text-sm font-mono"
                    disabled={importingProfile}
                    required
                  />
                  {!bfprofileValidation.isValid && bfprofilePackage && (
                    <p className="text-xs text-red-400">{bfprofileValidation.error}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-blue-300">Package Password</Label>
                  <PasswordField
                    placeholder="Minimum 8 characters"
                    value={bfprofilePassword}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setBfprofilePassword(e.target.value)}
                    disabled={importingProfile}
                    required
                  />
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={!canImportProfile || importingProfile}>
                    {importingProfile ? 'Importing…' : 'Import Profile'}
                  </Button>
                </div>
              </form>
            </ContentCard>

            <ContentCard
              title="Onboard Device"
              description="Connect with a password-protected onboarding package and complete the handshake."
            >
              <form onSubmit={onConnectOnboarding} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm text-blue-300">bfonboard</Label>
                  <Textarea
                    placeholder="bfonboard1..."
                    value={onboardPackage}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setOnboardPackage(e.target.value)}
                    rows={3}
                    className="text-sm font-mono"
                    disabled={connecting}
                    required
                  />
                  {!onboardValidation.isValid && onboardPackage && (
                    <p className="text-xs text-red-400">{onboardValidation.error}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-blue-300">Package Password</Label>
                  <PasswordField
                    placeholder="Minimum 8 characters"
                    value={onboardPassword}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setOnboardPassword(e.target.value)}
                    disabled={connecting}
                    required
                  />
                  {!onboardPasswordValidation.isValid && onboardPassword && (
                    <p className="text-xs text-red-400">{onboardPasswordValidation.error}</p>
                  )}
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={!canConnectOnboard || connecting}>
                    {connecting ? 'Connecting…' : 'Connect'}
                  </Button>
                </div>
              </form>
            </ContentCard>
          </div>

          {error && (
            <Alert tone="danger">{error}</Alert>
          )}

          {lastOnboardingFailure && (
            <Alert title="Last onboarding failure" tone="warning">{lastOnboardingFailure.message}</Alert>
          )}
        </div>
      )}
    </PageLayout>
  );
}
