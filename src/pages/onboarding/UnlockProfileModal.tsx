import * as React from 'react';
import { WelcomeUnlockModal } from 'igloo-ui';

import type { StoredProfileSummary } from '@/extension/protocol';
import { deriveChromeReturningProfile } from './profile-model';

export default function UnlockProfileModal({
  profile,
  unlockProfile,
  onUnlocked,
  onClose,
}: {
  profile: StoredProfileSummary | null;
  unlockProfile: (profileId: string, password: string) => Promise<void>;
  onUnlocked: () => void;
  onClose: () => void;
}) {
  const [unlockPassword, setUnlockPassword] = React.useState('');
  const [unlockError, setUnlockError] = React.useState<string | null>(null);
  const [unlockSubmitting, setUnlockSubmitting] = React.useState(false);

  React.useEffect(() => {
    setUnlockPassword('');
    setUnlockError(null);
    setUnlockSubmitting(false);
  }, [profile?.id]);

  async function submitUnlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profile) return;
    setUnlockSubmitting(true);
    setUnlockError(null);
    try {
      await unlockProfile(profile.id, unlockPassword);
      setUnlockPassword('');
      setUnlockError(null);
      onUnlocked();
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
    setUnlockPassword('');
    setUnlockError(null);
    setUnlockSubmitting(false);
    onClose();
  }

  return (
    <WelcomeUnlockModal
      open={Boolean(profile)}
      profile={profile ? deriveChromeReturningProfile(profile) : null}
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
  );
}
