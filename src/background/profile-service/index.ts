import {
  clearUnlockedProfileKeys,
  deleteStoredProfileRecord,
  loadActiveProfileId,
  loadStoredProfileRecord,
  loadStoredProfileRecords,
  loadUnlockedProfileIds,
  saveUnlockedProfileKey,
  setActiveProfileId,
} from '@/extension/storage';
import {
  loadActiveRuntimeProfile,
  loadProfileForReplacement,
  loadUnlockedRuntimeProfile,
} from './loading';
import {
  createStoredProfilePayload,
  normalizeProfileInput,
  storedProfileSummaryFromRecord,
  toRuntimeProfile,
} from './projection';
import {
  rejectDuplicateProfileId,
  replaceStoredProfileBlob,
  storeProfileBlobAndUnlock,
  updateStoredProfileBlob,
} from './persistence';

export type * from './types';

export function createProfileService() {
  return {
    clearUnlockedProfileKeys,
    createStoredProfilePayload,
    deleteStoredProfileRecord,
    loadActiveProfileId,
    loadActiveRuntimeProfile,
    loadProfileForReplacement,
    loadStoredProfileRecord,
    loadStoredProfileRecords,
    loadUnlockedProfileIds,
    loadUnlockedRuntimeProfile,
    normalizeProfileInput,
    rejectDuplicateProfileId,
    replaceStoredProfileBlob,
    saveUnlockedProfileKey,
    setActiveProfileId,
    storedProfileSummaryFromRecord,
    storeProfileBlobAndUnlock,
    toRuntimeProfile,
    updateStoredProfileBlob,
  };
}
