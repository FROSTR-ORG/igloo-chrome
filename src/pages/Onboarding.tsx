import * as React from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  AppHeader,
  Button,
  ContentCard,
  Input,
  Label,
  PageLayout,
  ProfileConfirmationCard,
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
    recoverProfile,
    activateProfile,
    unlockProfile,
    lastOnboardingFailure,
    clearOnboardingFailure
  } = useStore();

  const [pendingConnect, setPendingConnect] = React.useState<PendingConnect | null>(null);

  const [onboardPackage, setOnboardPackage] = React.useState('');
  const [onboardPassword, setOnboardPassword] = React.useState('');
  const [signerName, setSignerName] = React.useState('');
  const [localProfilePassword, setLocalProfilePassword] = React.useState('');

  const [bfprofilePackage, setBfprofilePackage] = React.useState('');
  const [bfprofilePassword, setBfprofilePassword] = React.useState('');
  const [bfsharePackage, setBfsharePackage] = React.useState('');
  const [bfsharePassword, setBfsharePassword] = React.useState('');
  const [unlockProfileId, setUnlockProfileId] = React.useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = React.useState('');

  const [connecting, setConnecting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [importingProfile, setImportingProfile] = React.useState(false);
  const [recoveringShare, setRecoveringShare] = React.useState(false);
  const [activatingProfileId, setActivatingProfileId] = React.useState<string | null>(null);
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
  const bfshareValidation = React.useMemo(
    () => packageLooksLike(bfsharePackage, 'bfshare1'),
    [bfsharePackage]
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

  const canConnectOnboard = onboardValidation.isValid && onboardPasswordValidation.isValid;
  const canImportProfile = bfprofileValidation.isValid && bfprofilePassword.trim().length >= 8;
  const canRecoverProfile = bfshareValidation.isValid && bfsharePassword.trim().length >= 8;
  const canSaveOnboard =
    signerName.trim().length > 0 && localProfilePassword.trim().length >= 8 && !!pendingConnect;

  const previewName = pendingConnect
    ? pendingConnect.profile.keysetName ?? (signerName.trim() || 'Onboarded device')
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
      setSignerName(profile.keysetName ?? profile.profilePayload.device.name ?? '');
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

  async function onRecoverBfshare(e: FormEvent) {
    e.preventDefault();
    setRecoveringShare(true);
    setError(null);
    try {
      await recoverProfile(bfsharePackage.trim(), bfsharePassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecoveringShare(false);
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

  const profiles = appState?.profiles ?? [];
  const selectedLockedProfile =
    unlockProfileId ? profiles.find((profile) => profile.id === unlockProfileId) ?? null : null;

  return (
    <PageLayout header={<AppHeader title="igloo-chrome" subtitle="browser signing device" />}>
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
                <Input
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={localProfilePassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setLocalProfilePassword(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>

              {error && (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
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
            description="Load an existing profile or import a new one into this extension."
          >
            <div className="space-y-3">
              {profiles.length === 0 ? (
                <div className="rounded border border-blue-500/20 bg-blue-500/5 px-3 py-3 text-sm text-blue-200">
                  No device profiles are stored in this extension yet.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-blue-300">Stored Profiles</div>
                  <div className="rounded border border-blue-500/20 bg-blue-500/5 px-3 py-3 text-sm text-blue-200">
                    Stored profiles stay encrypted locally. Browser session resets and logout return them to the locked state.
                  </div>
                  {profiles.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center justify-between gap-4 rounded border border-cyan-900/30 bg-cyan-950/20 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-cyan-100">
                          {profile.label || 'Unnamed device'}
                        </div>
                        <div className="text-xs text-cyan-300">{shortProfileId(profile.id)}</div>
                      </div>
                      {profile.unlocked ? (
                        <Button
                          type="button"
                          disabled={activatingProfileId === profile.id}
                          onClick={() => void onActivateExisting(profile.id)}
                        >
                          {activatingProfileId === profile.id ? 'Loading…' : 'Load Profile'}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => {
                            setUnlockProfileId(profile.id);
                            setUnlockPassword('');
                            setError(null);
                          }}
                        >
                          Unlock
                        </Button>
                      )}
                    </div>
                  ))}
                  {selectedLockedProfile ? (
                    <div className="rounded border border-cyan-500/30 bg-cyan-950/25 p-4">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-cyan-100">
                          Unlock Stored Profile
                        </div>
                        <div className="text-sm text-cyan-200">
                          {selectedLockedProfile.label || 'Unnamed device'}
                        </div>
                        <div className="text-xs text-cyan-300">
                          {shortProfileId(selectedLockedProfile.id)}
                        </div>
                        <div className="text-xs text-cyan-400">
                          Enter the local profile password to unlock this device for the current browser session.
                        </div>
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-sm text-blue-300">Profile Password</Label>
                          <Input
                            type="password"
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
                    </div>
                  ) : null}
                </div>
              )}
            </div>
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
                  <Input
                    type="password"
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
              title="Recover bfshare"
              description="Recover a device profile from relay backup using a protected bfshare package."
            >
              <form onSubmit={onRecoverBfshare} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sm text-blue-300">bfshare</Label>
                  <Textarea
                    placeholder="bfshare1..."
                    value={bfsharePackage}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBfsharePackage(e.target.value)}
                    rows={3}
                    className="text-sm font-mono"
                    disabled={recoveringShare}
                    required
                  />
                  {!bfshareValidation.isValid && bfsharePackage && (
                    <p className="text-xs text-red-400">{bfshareValidation.error}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-blue-300">Package Password</Label>
                  <Input
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={bfsharePassword}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setBfsharePassword(e.target.value)}
                    disabled={recoveringShare}
                    required
                  />
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={!canRecoverProfile || recoveringShare}>
                    {recoveringShare ? 'Recovering…' : 'Recover Profile'}
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
                  <Input
                    type="password"
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
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {lastOnboardingFailure && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-1">
              <div>Last onboarding failure</div>
              <div>{lastOnboardingFailure.message}</div>
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
