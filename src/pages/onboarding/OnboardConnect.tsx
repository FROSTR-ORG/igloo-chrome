import * as React from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Alert, Button, ContentCard, Label, PasswordField, Textarea } from 'igloo-ui';

import { validateOnboardCredential, validateOnboardingPassword } from '@/lib/igloo';
import type { PendingOnboardingProfile } from '@/extension/protocol';
import type { StartOnboardingInput } from '@/extension/client';
import { errorMessage } from './types';

export default function OnboardConnect({
  visible,
  forceVisible,
  initialPackage,
  initialPassword,
  connectOnboarding,
  clearOnboardingFailure,
  onConnected,
  onCancel,
}: {
  visible: boolean;
  forceVisible: boolean;
  initialPackage: string;
  initialPassword: string;
  connectOnboarding: (input: StartOnboardingInput) => Promise<PendingOnboardingProfile>;
  clearOnboardingFailure: () => void;
  onConnected: (profile: PendingOnboardingProfile, packageText: string, packagePassword: string) => void;
  onCancel: () => void;
}) {
  const [onboardPackage, setOnboardPackage] = React.useState(initialPackage);
  const [onboardPassword, setOnboardPassword] = React.useState(initialPassword);
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOnboardPackage(initialPackage);
    setOnboardPassword(initialPassword);
  }, [initialPackage, initialPassword]);

  const onboardValidation = React.useMemo(
    () => validateOnboardCredential(onboardPackage),
    [onboardPackage],
  );
  const onboardPasswordValidation = React.useMemo(
    () => validateOnboardingPassword(onboardPassword),
    [onboardPassword],
  );
  const canConnect = onboardValidation.isValid && onboardPasswordValidation.isValid;

  async function onConnect(e: FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    clearOnboardingFailure();
    try {
      const profile = await connectOnboarding({
        onboardPackage: onboardPackage.trim(),
        onboardPassword,
      });
      onConnected(profile, onboardPackage, onboardPassword);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  }

  if (!visible && !forceVisible) return null;

  return (
    <ContentCard
      title="Onboard Device"
      description="Connect with a password-protected onboarding package and complete the handshake."
    >
      <form onSubmit={onConnect} className="space-y-4">
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
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex justify-end gap-2 pt-2">
          {!forceVisible ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOnboardPackage('');
                setOnboardPassword('');
                setError(null);
                onCancel();
              }}
            >
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={!canConnect || connecting}>
            {connecting ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </form>
    </ContentCard>
  );
}
