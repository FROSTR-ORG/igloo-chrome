import type { WelcomeReturningProfileModel } from 'igloo-ui';

import { shortProfileId } from '@/lib/igloo';
import type { StoredProfileSummary } from '@/extension/protocol';

export function deriveChromeReturningProfile(profile: StoredProfileSummary): WelcomeReturningProfileModel {
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
