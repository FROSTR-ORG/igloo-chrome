import type { PendingOnboardingProfile } from '@/extension/protocol';

export type PendingConnect = {
  kind: 'bfonboard';
  profile: PendingOnboardingProfile;
  packagePassword: string;
};

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
