import {
  loadStoredProfileRecord,
  loadStoredProfileRecords,
  replaceStoredProfileRecord,
  saveStoredProfileRecord,
  saveUnlockedProfileKey,
  setActiveProfileId,
} from '@/extension/storage';
import {
  encryptLocalProfileBlobPayload,
  reencryptLocalProfileBlobWithSessionKey,
  type LocalProfileBlobPayload,
  type LocalProfileBlobRecord,
} from '@/lib/profile-blob';
import {
  createStoredProfileRecordPayload,
  toRuntimeProfile,
} from './projection';
import type { StoredProfileCreateResult } from './types';

export async function rejectDuplicateProfileId(profileId: string) {
  const existing = await loadStoredProfileRecords();
  if (existing.some((entry) => entry.id === profileId)) {
    throw new Error('Device profile already exists.');
  }
}

export async function createStoredProfileRecord(
  payload: LocalProfileBlobPayload,
  password: string,
): Promise<StoredProfileCreateResult> {
  const normalizedPayload: LocalProfileBlobPayload =
    createStoredProfileRecordPayload(payload);
  const { blob, sessionKeyB64 } = await encryptLocalProfileBlobPayload(
    normalizedPayload,
    password,
  );
  const now = Date.now();
  return {
    record: {
      id: normalizedPayload.profile.profileId,
      label: normalizedPayload.profile.device.name,
      blob,
      createdAt: now,
      updatedAt: now,
    } satisfies LocalProfileBlobRecord,
    sessionKeyB64,
    runtimeProfile: toRuntimeProfile(normalizedPayload),
    payload: normalizedPayload,
  };
}

export async function storeProfileBlobAndUnlock(
  payload: LocalProfileBlobPayload,
  password: string,
) {
  await rejectDuplicateProfileId(payload.profile.profileId);
  const created = await createStoredProfileRecord(payload, password);
  await saveStoredProfileRecord(created.record);
  await saveUnlockedProfileKey(created.record.id, created.sessionKeyB64);
  await setActiveProfileId(created.record.id);
  return created;
}

export async function updateStoredProfileBlob(
  profileId: string,
  payload: LocalProfileBlobPayload,
  sessionKeyB64: string,
) {
  const existing = await loadStoredProfileRecord(profileId);
  if (!existing) {
    throw new Error('Selected profile was not found.');
  }
  const blob = await reencryptLocalProfileBlobWithSessionKey(
    payload,
    sessionKeyB64,
    existing.blob,
  );
  const nextRecord: LocalProfileBlobRecord = {
    ...existing,
    label: payload.profile.device.name,
    blob,
    updatedAt: Date.now(),
  };
  await saveStoredProfileRecord(nextRecord);
  return nextRecord;
}

export async function replaceStoredProfileBlob(input: {
  targetProfileId: string;
  nextPayload: LocalProfileBlobPayload;
  sessionKeyB64: string;
  existingRecord: LocalProfileBlobRecord;
}) {
  await rejectDuplicateProfileId(input.nextPayload.profile.profileId);
  const blob = await reencryptLocalProfileBlobWithSessionKey(
    input.nextPayload,
    input.sessionKeyB64,
    input.existingRecord.blob,
  );
  const nextRecord: LocalProfileBlobRecord = {
    id: input.nextPayload.profile.profileId,
    label: input.nextPayload.profile.device.name,
    blob,
    createdAt: input.existingRecord.createdAt,
    updatedAt: Date.now(),
  };
  await replaceStoredProfileRecord(input.targetProfileId, nextRecord);
  await saveUnlockedProfileKey(nextRecord.id, input.sessionKeyB64);
  await setActiveProfileId(nextRecord.id);
  return toRuntimeProfile(input.nextPayload);
}
