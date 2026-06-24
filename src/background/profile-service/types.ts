import type {
  LocalProfileBlobPayload,
  LocalProfileBlobRecord,
} from '@/lib/profile-blob';
import type { StoredExtensionProfile } from '@/extension/protocol';

export type LoadedRuntimeProfile = {
  record: LocalProfileBlobRecord;
  payload: LocalProfileBlobPayload | null;
  runtimeProfile: StoredExtensionProfile | null;
  sessionKey: CryptoKey | null;
};

export type ActiveRuntimeProfile = LoadedRuntimeProfile & {
  activeProfileId: string;
};

export type StoredProfileCreateResult = {
  record: LocalProfileBlobRecord;
  sessionKey: CryptoKey;
  runtimeProfile: StoredExtensionProfile;
  payload: LocalProfileBlobPayload;
};
