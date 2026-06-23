import * as React from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Alert, Button, ContentCard, Label, PasswordField, Textarea } from 'igloo-ui';

import { errorMessage } from './types';

function packageLooksLike(value: string, prefix: 'bfprofile1' | 'bfshare1') {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return { isValid: false, error: 'Package is required.' };
  if (!normalized.startsWith(prefix)) {
    return { isValid: false, error: `Expected ${prefix}...` };
  }
  return { isValid: true, error: null };
}

export default function ImportProfile({
  visible,
  forceVisible,
  importProfile,
  onCancel,
}: {
  visible: boolean;
  forceVisible: boolean;
  importProfile: (packageText: string, password: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [bfprofilePackage, setBfprofilePackage] = React.useState('');
  const [bfprofilePassword, setBfprofilePassword] = React.useState('');
  const [importingProfile, setImportingProfile] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const bfprofileValidation = React.useMemo(
    () => packageLooksLike(bfprofilePackage, 'bfprofile1'),
    [bfprofilePackage],
  );
  const canImport = bfprofileValidation.isValid && bfprofilePassword.trim().length >= 8;

  async function onImport(e: FormEvent) {
    e.preventDefault();
    setImportingProfile(true);
    setError(null);
    try {
      await importProfile(bfprofilePackage.trim(), bfprofilePassword);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setImportingProfile(false);
    }
  }

  if (!visible && !forceVisible) return null;

  return (
    <ContentCard
      title="Load bfprofile"
      description="Import a full encrypted device profile package and load it into the extension."
    >
      <form onSubmit={onImport} className="space-y-4">
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
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex justify-end gap-2 pt-2">
          {!forceVisible ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setBfprofilePackage('');
                setBfprofilePassword('');
                setError(null);
                onCancel();
              }}
            >
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={!canImport || importingProfile}>
            {importingProfile ? 'Importing…' : 'Import Profile'}
          </Button>
        </div>
      </form>
    </ContentCard>
  );
}
