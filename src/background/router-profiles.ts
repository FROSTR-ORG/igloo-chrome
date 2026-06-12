import { COMMAND_TYPE, isRecord, type StoredExtensionProfile } from '@/extension/protocol';
import {
  clearUnlockedProfileKeys,
  saveUnlockedProfileKey,
  setActiveProfileId,
  setRuntimeDesiredActive,
  updateActivationLifecycle,
} from '@/extension/storage';
import {
  encodeBfProfilePackage,
  encodeBfSharePackage,
  saveImportedBrowserProfileAndMaybeActivate,
} from '@/lib/igloo';
import { decryptLocalProfileBlobWithPassword, type LocalProfileBlobPayload } from '@/lib/profile-blob';
import { normalizeSignerSettings } from '@/lib/signer-settings';
import type { BackgroundHandlerMap, BackgroundRouterDependencies } from '@/background/router-types';
import { activationFailure, responseError, responseOk } from '@/background/utils';

export function createProfilesRouter(
  input: Pick<BackgroundRouterDependencies, 'profileService' | 'runtimeService' | 'stateProjector'>
): BackgroundHandlerMap {
  const { profileService, runtimeService, stateProjector } = input;

  async function recordRuntimeUnavailableWarning(
    reason: string,
    warning: { message: string; detail?: string },
    profileId?: string | null,
  ) {
    await updateActivationLifecycle(
      'degraded',
      'background',
      'cold',
      profileId ? { reason, profileId } : { reason },
      {
        lastError: activationFailure(
          'runtime_unavailable',
          warning.detail ? `${warning.message} ${warning.detail}` : warning.message,
          'background',
        ),
        restoredFromSnapshot: false,
      },
    ).catch(() => undefined);
  }

  function createPersistAndActivateOptions(reason: 'import_bfprofile') {
    let persistedProfileId: string | null = null;
    return {
      signerSettings: normalizeSignerSettings(),
      autoStart: true,
      persistProfile: async ({
        finalized,
        password,
      }: {
        finalized: { storedPayload: LocalProfileBlobPayload };
        password: string;
      }) => {
        const created = await profileService.storeProfileBlobAndUnlock(
          finalized.storedPayload,
          password,
        );
        persistedProfileId = created.runtimeProfile.id;
        return created.runtimeProfile;
      },
      activate: async () => {
        await setRuntimeDesiredActive(true);
        const ensured = await runtimeService.ensureConfiguredRuntime(reason);
        if (!ensured.ok) {
          throw ensured.error;
        }
        return true;
      },
      onRuntimeUnavailable: async (warning: { message: string; detail?: string }) => {
        await recordRuntimeUnavailableWarning(reason, warning, persistedProfileId);
      },
    };
  }

  function respondAsync<T>(sendResponse: (value: unknown) => void, action: () => Promise<T>) {
    void action()
      .then((result) => sendResponse(responseOk(result)))
      .catch((error) => sendResponse(responseError(error)));
    return true;
  }

  function handlePackageSave<TMessage extends { packageText?: unknown; password?: unknown }>(args: {
    message: TMessage;
    sendResponse: (value: unknown) => void;
    invalidMessage: string;
    reason: 'import_bfprofile';
    save: (input: {
      packageText: string;
      password: string;
      options: ReturnType<typeof createPersistAndActivateOptions>;
    }) => Promise<StoredExtensionProfile>;
  }) {
    const packageText =
      typeof args.message.packageText === 'string' ? args.message.packageText.trim() : '';
    const password = typeof args.message.password === 'string' ? args.message.password : '';
    if (!packageText || !password) {
      args.sendResponse(responseError(new Error(args.invalidMessage)));
      return true;
    }

    return respondAsync(args.sendResponse, async () => {
      const saved = await args.save({
        packageText,
        password,
        options: createPersistAndActivateOptions(args.reason),
      });
      await stateProjector.publishStateChanged();
      return saved;
    });
  }

  return {
    [COMMAND_TYPE.PROFILES_IMPORT]: (message, sendResponse) =>
      handlePackageSave({
        message,
        sendResponse,
        invalidMessage: 'Invalid bfprofile import payload',
        reason: 'import_bfprofile',
        save: async ({ packageText, password, options }) =>
          (
            await saveImportedBrowserProfileAndMaybeActivate({
              packageText,
              password,
              ...options,
            })
          ).profile,
      }),
    [COMMAND_TYPE.PROFILES_EXPORT_PACKAGE]: (message, sendResponse) => {
      const format =
        message.format === 'bfprofile' || message.format === 'bfshare' ? message.format : null;
      const password = typeof message.password === 'string' ? message.password : '';
      if (!format || !password.trim()) {
        sendResponse(responseError(new Error('Invalid profile package export payload')));
        return true;
      }
      return respondAsync(sendResponse, async () => {
        const active = await profileService.loadActiveRuntimeProfile();
        if (!active?.payload) {
          throw new Error('Active profile is locked or unavailable.');
        }
        const payload = active.payload.profile;
        const packageText =
          format === 'bfprofile'
            ? await encodeBfProfilePackage(payload, password)
            : await encodeBfSharePackage(
                {
                  shareSecret: payload.device.shareSecret,
                  relays: payload.device.relays,
                },
                password,
              );
        return { packageText };
      });
    },
    [COMMAND_TYPE.PROFILES_SAVE]: (message, sendResponse) => {
      const profile = isRecord(message.profile) ? (message.profile as StoredExtensionProfile) : null;
      if (!profile) {
        sendResponse(responseError(new Error('Invalid profile payload')));
        return true;
      }
      return respondAsync(sendResponse, async () => {
        const normalized = await profileService.normalizeProfileInput(profile);
        const active = await profileService.loadUnlockedRuntimeProfile(normalized.id);
        if (!active.payload || !active.sessionKeyB64) {
          throw new Error('Profile is locked.');
        }
        const nextPayload: LocalProfileBlobPayload = {
          ...active.payload,
          profile: {
            ...active.payload.profile,
            device: {
              ...active.payload.profile.device,
              name: normalized.groupName?.trim() || active.payload.profile.device.name,
              relays: normalized.relays,
            },
          },
          signerSettings: normalizeSignerSettings(normalized.signerSettings),
          peerPubkey: normalized.peerPubkey ?? active.payload.peerPubkey ?? undefined,
          runtimeSnapshotJson: normalized.runtimeSnapshotJson ?? active.payload.runtimeSnapshotJson,
        };
        await profileService.updateStoredProfileBlob(normalized.id, nextPayload, active.sessionKeyB64);
        await stateProjector.publishStateChanged();
        return profileService.toRuntimeProfile(nextPayload);
      });
    },
    [COMMAND_TYPE.PROFILES_LOGOUT]: (_message, sendResponse) => {
      return respondAsync(sendResponse, async () => {
        await setRuntimeDesiredActive(false);
        const stopped = await runtimeService.stopRuntime('logout_profile');
        if (!stopped.ok) {
          throw stopped.error;
        }
        await clearUnlockedProfileKeys();
        await setActiveProfileId(null);
        await updateActivationLifecycle('idle', 'background', 'cold').catch(() => undefined);
        await stateProjector.publishStateChanged();
        return true;
      });
    },
    [COMMAND_TYPE.PROFILES_ACTIVATE]: (message, sendResponse) => {
      const profileId = typeof message.profileId === 'string' ? message.profileId.trim().toLowerCase() : '';
      if (!profileId) {
        sendResponse(responseError(new Error('Invalid profile id')));
        return true;
      }
      return respondAsync(sendResponse, async () => {
        const unlocked = await profileService.loadUnlockedRuntimeProfile(profileId);
        if (!unlocked.runtimeProfile) {
          throw new Error('Profile is locked.');
        }
        await setActiveProfileId(profileId);
        await setRuntimeDesiredActive(true);
        const ensured = await runtimeService.ensureConfiguredRuntime('activate_profile');
        if (!ensured.ok) {
          throw ensured.error;
        }
        await stateProjector.publishStateChanged();
        return unlocked.runtimeProfile;
      });
    },
    [COMMAND_TYPE.PROFILES_UNLOCK]: (message, sendResponse) => {
      const profileId = typeof message.profileId === 'string' ? message.profileId.trim().toLowerCase() : '';
      const password = typeof message.password === 'string' ? message.password : '';
      if (!profileId || !password) {
        sendResponse(responseError(new Error('Invalid profile unlock payload')));
        return true;
      }
      return respondAsync(sendResponse, async () => {
        const record = await profileService.loadStoredProfileRecord(profileId);
        if (!record) {
          throw new Error('Selected profile was not found.');
        }
        let unlocked: Awaited<ReturnType<typeof decryptLocalProfileBlobWithPassword>>;
        try {
          unlocked = await decryptLocalProfileBlobWithPassword(record.blob, password);
        } catch {
          throw new Error('Invalid profile password.');
        }
        await saveUnlockedProfileKey(profileId, unlocked.sessionKeyB64);
        await setActiveProfileId(profileId);
        await setRuntimeDesiredActive(true);
        const ensured = await runtimeService.ensureConfiguredRuntime('unlock_profile');
        if (!ensured.ok) {
          throw ensured.error;
        }
        await stateProjector.publishStateChanged();
        return profileService.toRuntimeProfile(unlocked.payload);
      });
    },
    [COMMAND_TYPE.PROFILES_DELETE]: (message, sendResponse) => {
      const profileId = typeof message.profileId === 'string' ? message.profileId.trim().toLowerCase() : '';
      if (!profileId) {
        sendResponse(responseError(new Error('Invalid profile id')));
        return true;
      }
      return respondAsync(sendResponse, async () => {
        const activeProfileId = await profileService.loadActiveProfileId();
        if (activeProfileId === profileId) {
          await setRuntimeDesiredActive(false);
          const stopped = await runtimeService.stopRuntime('delete_profile');
          if (!stopped.ok) {
            throw stopped.error;
          }
          await setActiveProfileId(null);
          await updateActivationLifecycle('idle', 'background', 'cold').catch(() => undefined);
        }
        await profileService.deleteStoredProfileRecord(profileId);
        await stateProjector.publishStateChanged();
        return true;
      });
    },
  };
}
