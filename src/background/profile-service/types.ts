import type {
  LocalProfileBlobPayload,
  LocalProfileBlobRecord,
} from '@/lib/profile-blob';
import type { StoredExtensionProfile } from '@/extension/protocol';

export type LoadedRuntimeProfile = {
  record: LocalProfileBlobRecord;
  payload: LocalProfileBlobPayload | null;
  runtimeProfile: StoredExtensionProfile | null;
  sessionKeyB64: string | null;
};

export type ActiveRuntimeProfile = LoadedRuntimeProfile & {
  activeProfileId: string;
};

export type StoredProfileCreateResult = {
  record: LocalProfileBlobRecord;
  sessionKeyB64: string;
  runtimeProfile: StoredExtensionProfile;
  payload: LocalProfileBlobPayload;
};
