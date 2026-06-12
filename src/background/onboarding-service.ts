import { updateActivationLifecycle, updateOnboardingLifecycle } from '@/extension/storage';
import { isRecord, type PendingOnboardingProfile, type StoredExtensionProfile } from '@/extension/protocol';
import { captureOnboardingProfile } from '@/lib/extension-runtime-host';
import {
  createBrowserStoredProfilePayloadSource,
  groupPublicKeyFromPackage,
  saveConnectedBrowserProfileAndMaybeActivate,
  saveRotatedBrowserProfileAndMaybeActivate,
} from '@/lib/igloo';
import { activationFailure, serviceError, serviceOk, toErrorMessage, type ServiceResult } from '@/background/utils';
import type { createProfileService } from '@/background/profile-service';

type ProfileService = ReturnType<typeof createProfileService>;

export type OnboardingStartPayload = {
  pendingProfile: PendingOnboardingProfile;
};

export type OnboardingStartResult = ServiceResult<
  OnboardingStartPayload,
  OnboardingServiceError
>;

export type OnboardingCompletePayload = {
  profile: StoredExtensionProfile;
};

export type OnboardingCompleteResult = ServiceResult<
  OnboardingCompletePayload,
  OnboardingServiceError
>;

export type RotationCompletePayload = {
  profile: StoredExtensionProfile;
};

export type RotationCompleteResult = ServiceResult<
  RotationCompletePayload,
  OnboardingServiceError
>;

export type OnboardingServiceErrorCode =
  | 'invalid_input'
  | 'onboard_timeout'
  | 'onboard_rejected'
  | 'profile_persist_failed'
  | 'runtime_activation_failed'
  | 'rotation_target_locked'
  | 'rotation_group_mismatch'
  | 'rotation_same_profile';

export class OnboardingServiceError extends Error {
  readonly code: OnboardingServiceErrorCode;
  readonly cause?: unknown;

  constructor(code: OnboardingServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'OnboardingServiceError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export function createOnboardingService(input: {
  profileService: ProfileService;
  publishStateChanged: () => Promise<unknown>;
  ensureConfiguredRuntime: (reason: string) => Promise<void>;
  setRuntimeDesiredActive: (value: boolean) => Promise<void>;
  loadActiveProfileId: () => Promise<string | null>;
  stopRuntime?: (reason: string) => Promise<void>;
}) {
  const {
    profileService,
    publishStateChanged,
    ensureConfiguredRuntime,
    setRuntimeDesiredActive,
    loadActiveProfileId,
    stopRuntime,
  } = input;

  async function publishStateChangedQuietly() {
    await publishStateChanged().catch(() => undefined);
  }

  async function recordRuntimeUnavailableWarning(reason: string, profileId: string, warning: { message: string; detail?: string }) {
    await updateActivationLifecycle(
      'degraded',
      'background',
      'cold',
      {
        reason,
        profileId,
      },
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

  function createActivationCallbacks(args: {
    reason: 'complete_onboarding' | 'apply_rotation_update';
    profileId: string;
  }) {
    return {
      activate: async () => {
        await setRuntimeDesiredActive(true);
        await ensureConfiguredRuntime(args.reason);
        return true;
      },
      onRuntimeUnavailable: async (warning: { message: string; detail?: string }) => {
        await recordRuntimeUnavailableWarning(args.reason, args.profileId, warning);
      },
    };
  }

  async function startOnboarding(message: Record<string, unknown>): Promise<OnboardingStartResult> {
    const input = isRecord(message.input) ? message.input : null;
    const onboardPackage =
      input && typeof input.onboardPackage === 'string' ? input.onboardPackage.trim() : '';
    const onboardPassword =
      input && typeof input.onboardPassword === 'string' ? input.onboardPassword : '';
    const groupName =
      input && typeof input.groupName === 'string' && input.groupName.trim()
        ? input.groupName.trim()
        : undefined;
    if (!onboardPackage || !onboardPassword) {
      return serviceError(new OnboardingServiceError('invalid_input', 'Invalid onboarding input'));
    }

    try {
      const pendingProfile = await captureOnboardingProfile({
        packageText: onboardPackage,
        password: onboardPassword,
        groupName,
        onProgress: async (stage, detail) => {
          await updateOnboardingLifecycle(stage, 'background', detail).catch(() => undefined);
          await publishStateChangedQuietly();
        },
      });
      await profileService.rejectDuplicateProfileId(pendingProfile.profilePayload.profileId);
      await publishStateChangedQuietly();
      return serviceOk({ pendingProfile });
    } catch (error) {
      const messageText = toErrorMessage(error);
      const code: OnboardingServiceErrorCode = /timed out/i.test(messageText)
        ? 'onboard_timeout'
        : 'onboard_rejected';
      await updateOnboardingLifecycle(
        'failed',
        'background',
        {
          packageLength: onboardPackage.length,
        },
        activationFailure(code, messageText, 'background')
      ).catch(() => undefined);
      await publishStateChangedQuietly();
      return serviceError(new OnboardingServiceError(code, messageText, { cause: error }));
    }
  }

  async function completeOnboarding(
    pendingProfile: PendingOnboardingProfile,
    label: string,
    password: string
  ): Promise<OnboardingCompleteResult> {
    let saved;
    try {
      saved = await saveConnectedBrowserProfileAndMaybeActivate({
        profilePayload: pendingProfile.profilePayload,
        label,
        password,
        signerSettings: pendingProfile.signerSettings,
        runtimeSnapshotJson: pendingProfile.runtimeSnapshotJson ?? null,
        peerPubkey: pendingProfile.peerPubkey ?? null,
        autoStart: true,
        persistProfile: async ({ finalized, password: storedPassword }) => {
          const created = await profileService.storeProfileBlobAndUnlock(
            finalized.storedPayload,
            storedPassword,
          );
          await updateOnboardingLifecycle('profile_persisted', 'background', {
            profileId: created.runtimeProfile.id,
            peerPubkey: pendingProfile.peerPubkey,
            relayCount: pendingProfile.relays.length,
          }).catch(() => undefined);
          return created.runtimeProfile;
        },
        ...createActivationCallbacks({
          reason: 'complete_onboarding',
          profileId: pendingProfile.profilePayload.profileId,
        }),
      });
    } catch (error) {
      return serviceError(
        new OnboardingServiceError(
          'profile_persist_failed',
          toErrorMessage(error, 'Failed to store onboarded profile'),
          { cause: error }
        )
      );
    }
    await updateOnboardingLifecycle('idle', 'background', {
      profileId: saved.profile.id,
    }).catch(() => undefined);
    await publishStateChanged();
    return serviceOk({
      profile: saved.profile,
    });
  }

  async function completeRotation(
    pendingProfile: PendingOnboardingProfile,
    targetProfileId: string
  ): Promise<RotationCompleteResult> {
    const target = await profileService.loadProfileForReplacement(targetProfileId, null);
    if (!target.payload || !target.sessionKeyB64) {
      return serviceError(
        new OnboardingServiceError('rotation_target_locked', 'Selected profile is locked.')
      );
    }
    const sessionKeyB64 = target.sessionKeyB64;
    if (
      groupPublicKeyFromPackage(pendingProfile.profilePayload.groupPackage) !==
      groupPublicKeyFromPackage(target.payload.profile.groupPackage)
    ) {
      return serviceError(
        new OnboardingServiceError(
          'rotation_group_mismatch',
          'Rotation package does not match the selected profile group public key.'
        )
      );
    }
    if (pendingProfile.profilePayload.profileId === target.payload.profile.profileId) {
      return serviceError(
        new OnboardingServiceError(
          'rotation_same_profile',
          'Rotation package did not produce a new device profile id.'
        )
      );
    }
    const shouldActivate = (await loadActiveProfileId()) === targetProfileId;
    if (shouldActivate) {
      await stopRuntime?.('apply_rotation_update_prepare');
    }
    const targetProfile = createBrowserStoredProfilePayloadSource({
      payload: target.payload.profile,
      label: target.payload.profile.device.name,
      relays: target.payload.profile.device.relays,
      manualPeerPolicyOverrides: target.payload.profile.device.manualPeerPolicyOverrides,
    });
    const saved = await saveRotatedBrowserProfileAndMaybeActivate({
      targetProfile: {
        ...targetProfile,
        storedPassword: sessionKeyB64,
        runtimeSnapshotJson: target.payload.runtimeSnapshotJson ?? null,
        peerPubkey: target.payload.peerPubkey ?? null,
      },
      connectedProfilePayload: pendingProfile.profilePayload,
      password: sessionKeyB64,
      signerSettings: target.payload.signerSettings,
      runtimeSnapshotJson:
        pendingProfile.runtimeSnapshotJson ?? target.payload.runtimeSnapshotJson ?? null,
      peerPubkey: pendingProfile.peerPubkey ?? target.payload.peerPubkey ?? null,
      autoStart: shouldActivate,
      persistProfile: async ({ finalized }) =>
        await profileService.replaceStoredProfileBlob({
          targetProfileId,
          nextPayload: finalized.storedPayload,
          sessionKeyB64,
          existingRecord: target.record,
        }),
      ...createActivationCallbacks({
        reason: 'apply_rotation_update',
        profileId: pendingProfile.profilePayload.profileId,
      }),
    });
    await publishStateChanged();
    return serviceOk({
      profile: saved.profile,
    });
  }

  return {
    completeOnboarding,
    completeRotation,
    startOnboarding,
  };
}
