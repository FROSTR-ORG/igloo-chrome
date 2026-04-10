import {
  loadStoredProfileRecord,
  saveStoredProfileRecordIfPresent,
} from '@/extension/storage';
import {
  decryptLocalProfileBlobWithSessionKey,
  reencryptLocalProfileBlobWithSessionKey,
} from '@/lib/profile-blob';
import { getRuntimeSnapshot } from '@/lib/igloo';
import { toErrorMessage } from '@/lib/runtime-host/helpers';
import type { SignerSession } from '@/lib/runtime-host/types';

export type PersistedRuntimeSnapshotResult = {
  snapshotJson: string;
};

export async function savePersistedRuntimeSnapshot(
  session: Pick<SignerSession, 'profileId' | 'sessionKeyB64'>,
  snapshotJson: string
) {
  const record = await loadStoredProfileRecord(session.profileId);
  if (!record) {
    throw new Error(`Stored profile ${session.profileId} was not found.`);
  }
  const payload = await decryptLocalProfileBlobWithSessionKey(record.blob, session.sessionKeyB64);
  const nextPayload = {
    ...payload,
    runtimeSnapshotJson: snapshotJson,
  };
  const nextBlob = await reencryptLocalProfileBlobWithSessionKey(
    nextPayload,
    session.sessionKeyB64,
    record.blob
  );
  const saved = await saveStoredProfileRecordIfPresent({
    ...record,
    blob: nextBlob,
    updatedAt: Date.now(),
  });
  if (!saved) {
    throw new Error(`Stored profile ${session.profileId} was replaced before snapshot persistence completed.`);
  }
}

export async function persistSessionSnapshot(
  session: Pick<SignerSession, 'profileId' | 'sessionKeyB64' | 'node'>
): Promise<PersistedRuntimeSnapshotResult> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const snapshot = getRuntimeSnapshot(session.node);
      const snapshotJson = JSON.stringify(snapshot);
      await savePersistedRuntimeSnapshot(session, snapshotJson);
      return {
        snapshotJson,
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw new Error(toErrorMessage(lastError, 'Failed to persist runtime snapshot'));
}

export function persistSessionSnapshotInBackground(
  session: Pick<SignerSession, 'profileId' | 'sessionKeyB64' | 'node' | 'persistInFlight' | 'persistQueued'>,
  runPersist: () => Promise<void>
) {
  if (session.persistInFlight) {
    session.persistQueued = true;
    return;
  }
  session.persistInFlight = (async () => {
    do {
      session.persistQueued = false;
      await runPersist();
    } while (session.persistQueued);
  })().finally(() => {
    session.persistInFlight = null;
  });
}
