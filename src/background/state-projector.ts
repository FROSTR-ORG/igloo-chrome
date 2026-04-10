import type { ExtensionStateSnapshot, RuntimePhase, RuntimeStatusSummary } from '@/extension/protocol';
import {
  loadActiveProfileId,
  loadLifecycleStatus,
  loadPermissionPolicies,
  loadRuntimeDesiredActive,
} from '@/extension/storage';
import { getChromeApi } from '@/extension/chrome';
import { EVENT_TYPE } from '@/extension/protocol';
import type { createPromptRegistry } from '@/background/prompt-registry';
import type { createProfileService } from '@/background/profile-service';
import { UNKNOWN_RUNTIME_LIFECYCLE } from '@/background/utils';

type PromptRegistry = ReturnType<typeof createPromptRegistry>;
type ProfileService = ReturnType<typeof createProfileService>;

export function createStateProjector(input: {
  profileService: ProfileService;
  promptRegistry: PromptRegistry;
  getRuntimeStatusSnapshot: () => Promise<{ runtime: RuntimePhase; status: RuntimeStatusSummary | null }>;
}) {
  const { profileService, promptRegistry, getRuntimeStatusSnapshot } = input;

  async function buildAppState(): Promise<ExtensionStateSnapshot> {
    const [activeProfile, records, activeProfileId, lifecycle, permissionPolicies, desiredActive, runtimeStatus] =
      await Promise.all([
        profileService.loadActiveRuntimeProfile(),
        profileService.loadStoredProfileRecords(),
        loadActiveProfileId(),
        loadLifecycleStatus(),
        loadPermissionPolicies(),
        loadRuntimeDesiredActive(),
        getRuntimeStatusSnapshot(),
      ]);
    const unlockedProfileIds = await profileService.loadUnlockedProfileIds();
    const profile = activeProfile?.runtimeProfile ?? null;

    return {
      configured: !!profile,
      profile,
      profiles: records.map((record) => profileService.storedProfileSummaryFromRecord(record, unlockedProfileIds)),
      activeProfileId,
      lifecycle,
      runtime: {
        desiredActive,
        phase: runtimeStatus.runtime,
        summary: runtimeStatus.status,
        metadata: runtimeStatus.status?.metadata ?? null,
        readiness: runtimeStatus.status?.readiness ?? null,
        peerStatus: runtimeStatus.status?.peers ?? [],
        pendingOperations: runtimeStatus.status?.pending_operations ?? [],
        snapshot: null,
        snapshotError: null,
        lifecycle: UNKNOWN_RUNTIME_LIFECYCLE,
        lastError: lifecycle.activation.lastError?.message ?? lifecycle.onboarding.lastError?.message ?? null,
      },
      permissionPolicies,
      pendingPrompts: promptRegistry.size(),
    };
  }

  async function publishStateChanged() {
    const next = await buildAppState();
    const chromeApi = getChromeApi();
    if (!chromeApi?.runtime?.sendMessage) {
      return next;
    }
    try {
      await chromeApi.runtime.sendMessage({
        type: EVENT_TYPE.STATE_CHANGED,
        state: next,
      });
    } catch {
      // Ignore listenerless broadcasts.
    }
    return next;
  }

  return {
    buildAppState,
    publishStateChanged,
  };
}
