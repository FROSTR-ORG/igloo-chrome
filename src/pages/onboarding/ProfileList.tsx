import * as React from 'react';
import {
  Alert,
  WelcomeEntryHero,
  WelcomeReturningHero,
} from 'igloo-ui';

import { shortProfileId } from '@/lib/igloo';
import type { ExtensionStateSnapshot, StoredProfileSummary } from '@/extension/protocol';
import { deriveChromeReturningProfile } from './profile-model';
import { errorMessage } from './types';

export default function ProfileList({
  appState,
  profiles,
  activateProfile,
  deleteProfile,
  onUnlock,
  onDeleted,
  onShowOnboard,
  onShowImport,
}: {
  appState: ExtensionStateSnapshot | null;
  profiles: StoredProfileSummary[];
  activateProfile: (profileId: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  onUnlock: (profileId: string) => void;
  onDeleted: (profileId: string) => void;
  onShowOnboard: () => void;
  onShowImport: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);

  async function onActivateExisting(profileId: string) {
    setError(null);
    try {
      await activateProfile(profileId);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onLoadStoredProfile(profileId: string) {
    const profile = profiles.find((entry) => entry.id === profileId);
    if (!profile) return;
    if (appState?.configured && appState.activeProfileId === profileId) return;
    if (profile.unlocked) {
      await onActivateExisting(profileId);
      return;
    }
    onUnlock(profileId);
  }

  async function onDeleteStoredProfile(profileId: string) {
    const profile = profiles.find((entry) => entry.id === profileId);
    const confirmed = window.confirm(
      `Delete stored profile ${profile?.label || 'Unnamed device'} (${shortProfileId(profileId)})?`,
    );
    if (!confirmed) return;
    setError(null);
    try {
      await deleteProfile(profileId);
      onDeleted(profileId);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      {profiles.length === 0 ? (
        <WelcomeEntryHero
          productLabel="Igloo"
          tagline="Threshold signing for your browser."
          primaryAction={{
            heading: 'Onboard New Device',
            description: 'Use a password-protected bfonboard package to set up this browser as a signing device.',
            buttonLabel: 'Onboard Device',
            onAction: onShowOnboard,
            showInfo: false,
          }}
          secondaryActions={[
            { id: 'import', label: 'Import Existing Device', onAction: onShowImport },
          ]}
        />
      ) : (
        <WelcomeReturningHero
          productLabel="Igloo"
          layout={profiles.length === 1 ? 'single' : profiles.length <= 3 ? 'multi' : 'many'}
          profiles={profiles.map(deriveChromeReturningProfile)}
          onUnlock={(profileId) => void onLoadStoredProfile(profileId)}
          onRotate={() => {}}
          onDelete={(profileId) => void onDeleteStoredProfile(profileId)}
          secondaryActions={[
            { id: 'onboard', label: 'Onboard New Device', onAction: onShowOnboard },
            { id: 'import', label: 'Import Existing Device', onAction: onShowImport },
          ]}
        />
      )}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
