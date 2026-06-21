import * as React from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  Alert,
  AppHeader,
  Button,
  ContentCard,
  Input,
  Label,
  PageLayout,
  PasswordField,
  ProfileConfirmationCard,
  Textarea,
  WelcomeEntryHero,
  WelcomeReturningHero,
  WelcomeUnlockModal,
  type WelcomeReturningProfileModel,
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

function deriveChromeReturningProfile(profile: {
  id: string;
  label: string;
  unlocked: boolean;
}): WelcomeReturningProfileModel {
  return {
    id: profile.id,
    label: profile.label || 'Unnamed device',
    thresholdLabel: '',
    memberLabel: '',
    publicKeyLabel: shortProfileId(profile.id),
    canRotate: false,
    canRecover: false,
    canDelete: true,
  };
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

  const [showOnboard, setShowOnboard] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);

  const [onboardPackage, setOnboardPackage] = React.useState('');
  const [onboardPassword, setOnboardPassword] = React.useState('');
  const [signerName, setSignerName] = React.useState('');
  const [localProfilePassword, setLocalProfilePassword] = React.useState('');

  const [bfprofilePackage, setBfprofilePackage] = React.useState('');
  const [bfprofilePassword, setBfprofilePassword] = React.useState('');
  const [unlockProfileId, setUnlockProfileId] = React.useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = React.useState('');
  const [unlockError, setUnlockError] = React.useState<string | null>(null);
  const [unlockSubmitting, setUnlockSubmitting] = React.useState(false);

  const [connecting, setConnecting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [importingProfile, setImportingProfile] = React.useState(false);
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
      setShowOnboard(true);
    }
    if (password) {
      setOnboardPassword(password);
    }
  }, []);

  React.useEffect(() => {
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
    setError(null);
    try {
      await activateProfile(profileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    setUnlockProfileId(profileId);
    setUnlockPassword('');
    setUnlockError(null);
    setUnlockSubmitting(false);
  }

  async function onDeleteStoredProfile(profileId: string) {
    const profile = profiles.find((entry) => entry.id === profileId);
    const confirmed = window.confirm(
      `Delete stored profile ${profile?.label || 'Unnamed device'} (${shortProfileId(profileId)})?`,
    );
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await deleteProfile(profileId);
      if (unlockProfileId === profileId) {
        setUnlockProfileId(null);
        setUnlockPassword('');
        setUnlockError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const unlockProfile_ = profiles.find((p) => p.id === unlockProfileId) ?? null;
  const unlockProfileModel: WelcomeReturningProfileModel | null = unlockProfile_
    ? deriveChromeReturningProfile(unlockProfile_)
    : null;

  async function submitUnlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!unlockProfileId) return;
    setUnlockSubmitting(true);
    setUnlockError(null);
    try {
      await unlockProfile(unlockProfileId, unlockPassword);
      setUnlockProfileId(null);
      setUnlockPassword('');
      setUnlockError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUnlockError(
        /incorrect passphrase|invalid.*password|wrong.*password/i.test(message)
          ? 'Invalid profile password.'
          : message || 'Could not unlock this device.',
      );
    } finally {
      setUnlockSubmitting(false);
    }
  }

  function closeUnlock() {
    setUnlockProfileId(null);
    setUnlockPassword('');
    setUnlockError(null);
    setUnlockSubmitting(false);
  }

  function renderLanding() {
    if (profiles.length === 0) {
      return (
        <WelcomeEntryHero
          productLabel="Igloo"
          tagline="Threshold signing for your browser."
          primaryAction={{
            heading: 'Onboard New Device',
            description: 'Use a password-protected bfonboard package to set up this browser as a signing device.',
            buttonLabel: 'Onboard Device',
            onAction: () => setShowOnboard(true),
            showInfo: false,
          }}
          secondaryActions={[
            { id: 'import', label: 'Import Existing Device', onAction: () => setShowImport(true) },
          ]}
        />
      );
    }

    return (
      <WelcomeReturningHero
        productLabel="Igloo"
        layout={profiles.length === 1 ? 'single' : profiles.length <= 3 ? 'multi' : 'many'}
        profiles={profiles.map(deriveChromeReturningProfile)}
        onUnlock={(profileId) => void onLoadStoredProfile(profileId)}
        onRotate={() => {}}
        onDelete={(profileId) => void onDeleteStoredProfile(profileId)}
        secondaryActions={[
          { id: 'onboard', label: 'Onboard New Device', onAction: () => setShowOnboard(true) },
          { id: 'import', label: 'Import Existing Device', onAction: () => setShowImport(true) },
        ]}
      />
    );
  }

  return (
    <PageLayout header={<AppHeader mode="task" taskLabel="browser signing device" />}>
      <WelcomeUnlockModal
        open={Boolean(unlockProfileId)}
        profile={unlockProfileModel}
        password={unlockPassword}
        error={unlockError}
        submitting={unlockSubmitting}
        onPasswordChange={(value) => {
          setUnlockPassword(value);
          setUnlockError(null);
        }}
        onSubmit={(e) => void submitUnlock(e)}
        onClose={closeUnlock}
      />

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
          {renderLanding()}

          {(showOnboard || profiles.length === 0) && (
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
                <div className="flex justify-end gap-2 pt-2">
                  {profiles.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setShowOnboard(false);
                        setOnboardPackage('');
                        setOnboardPassword('');
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" disabled={!canConnectOnboard || connecting}>
                    {connecting ? 'Connecting…' : 'Connect'}
                  </Button>
                </div>
              </form>
            </ContentCard>
          )}

          {(showImport || profiles.length === 0) && (
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
                <div className="flex justify-end gap-2 pt-2">
                  {profiles.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setShowImport(false);
                        setBfprofilePackage('');
                        setBfprofilePassword('');
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" disabled={!canImportProfile || importingProfile}>
                    {importingProfile ? 'Importing…' : 'Import Profile'}
                  </Button>
                </div>
              </form>
            </ContentCard>
          )}

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
