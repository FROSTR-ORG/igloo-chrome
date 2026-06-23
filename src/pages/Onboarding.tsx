import * as React from 'react';
import {
  Alert,
  AppHeader,
  PageLayout,
} from 'igloo-ui';

import { useStore } from '@/lib/store';
import ImportProfile from './onboarding/ImportProfile';
import OnboardConnect from './onboarding/OnboardConnect';
import ProfileList from './onboarding/ProfileList';
import SaveOnboardedDevice from './onboarding/SaveOnboardedDevice';
import UnlockProfileModal from './onboarding/UnlockProfileModal';
import type { PendingConnect } from './onboarding/types';

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
    clearOnboardingFailure,
  } = useStore();

  const profiles = appState?.profiles ?? [];
  const [pendingConnect, setPendingConnect] = React.useState<PendingConnect | null>(null);
  const [showOnboard, setShowOnboard] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [unlockProfileId, setUnlockProfileId] = React.useState<string | null>(null);
  const [initialOnboardPackage, setInitialOnboardPackage] = React.useState('');
  const [initialOnboardPassword, setInitialOnboardPassword] = React.useState('');

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const onboard = params.get('onboard');
    const password = params.get('password');
    if (onboard) {
      setInitialOnboardPackage(onboard.trim());
      setShowOnboard(true);
    }
    if (password) {
      setInitialOnboardPassword(password);
    }
  }, []);

  React.useEffect(() => {
    setUnlockProfileId((current) =>
      current && profiles.some((profile) => profile.id === current) ? current : null,
    );
  }, [profiles]);

  const unlockProfile_ = profiles.find((profile) => profile.id === unlockProfileId) ?? null;

  return (
    <PageLayout header={<AppHeader mode="task" taskLabel="browser signing device" />}>
      <UnlockProfileModal
        profile={unlockProfile_}
        unlockProfile={unlockProfile}
        onUnlocked={() => setUnlockProfileId(null)}
        onClose={() => setUnlockProfileId(null)}
      />

      {pendingConnect ? (
        <SaveOnboardedDevice
          pendingConnect={pendingConnect}
          completeOnboarding={completeOnboarding}
          clearOnboardingFailure={clearOnboardingFailure}
          onBack={() => setPendingConnect(null)}
        />
      ) : (
        <div className="space-y-6">
          <ProfileList
            appState={appState}
            profiles={profiles}
            activateProfile={activateProfile}
            deleteProfile={deleteProfile}
            onUnlock={setUnlockProfileId}
            onDeleted={(profileId) => {
              if (unlockProfileId === profileId) {
                setUnlockProfileId(null);
              }
            }}
            onShowOnboard={() => setShowOnboard(true)}
            onShowImport={() => setShowImport(true)}
          />

          <OnboardConnect
            visible={showOnboard}
            forceVisible={profiles.length === 0}
            initialPackage={initialOnboardPackage}
            initialPassword={initialOnboardPassword}
            connectOnboarding={connectOnboarding}
            clearOnboardingFailure={clearOnboardingFailure}
            onConnected={(profile, packageText, packagePassword) => {
              setInitialOnboardPackage(packageText);
              setInitialOnboardPassword(packagePassword);
              setPendingConnect({ kind: 'bfonboard', profile, packagePassword });
            }}
            onCancel={() => {
              setShowOnboard(false);
              setInitialOnboardPackage('');
              setInitialOnboardPassword('');
            }}
          />

          <ImportProfile
            visible={showImport}
            forceVisible={profiles.length === 0}
            importProfile={importProfile}
            onCancel={() => setShowImport(false)}
          />

          {lastOnboardingFailure ? (
            <Alert title="Last onboarding failure" tone="warning">{lastOnboardingFailure.message}</Alert>
          ) : null}
        </div>
      )}
    </PageLayout>
  );
}
