import React, { createContext, useContext, useMemo, useState } from 'react';
import { getChromeApi } from '@/extension/chrome';
import {
  activateExtensionProfile,
  clearPermissionPolicies,
  clearRuntimePeerPolicyOverrides,
  completeOnboarding as completeOnboardingClient,
  completeRotationOnboarding,
  deleteExtensionProfile,
  exportProfilePackage as exportExtensionProfilePackage,
  fetchExtensionState,
  fetchRuntimeDiagnostics,
  importBfprofile,
  prepareRuntime,
  refreshRuntimePeers,
  recoverBfshare,
  reloadRuntime,
  revokePermissionPolicy,
  saveExtensionProfile,
  logoutExtensionProfile,
  startOnboarding,
  startRuntime,
  stopRuntime,
  unlockExtensionProfile,
  updateRuntimeConfig,
  updateRuntimePeerPolicy,
  type StartOnboardingInput
} from '@/extension/client';
import {
  EVENT_TYPE,
  type ExtensionStateSnapshot,
  type PendingOnboardingProfile,
  type RuntimeDiagnosticsSnapshot,
  type StoredPermissionPolicy,
  type StoredPeerPolicy,
  type StoredExtensionProfile
} from '@/extension/protocol';
import { DEFAULT_RELAYS, normalizeRelays } from '@/lib/igloo';

export type AppRoute = 'onboarding' | 'signer';

export type OnboardingFailureDetail = {
  message: string;
};

type AppState = {
  route: AppRoute;
  isHydratingProfile: boolean;
  appState: ExtensionStateSnapshot | null;
  profile?: StoredExtensionProfile;
  lastOnboardingFailure: OnboardingFailureDetail | null;
  clearOnboardingFailure: () => void;
  saveProfile: (s: StoredExtensionProfile) => Promise<void>;
  connectOnboarding: (s: StartOnboardingInput) => Promise<PendingOnboardingProfile>;
  completeOnboarding: (
    pendingProfile: PendingOnboardingProfile,
    label: string,
    password: string
  ) => Promise<StoredExtensionProfile>;
  completeRotationUpdate: (
    targetProfileId: string,
    pendingProfile: PendingOnboardingProfile
  ) => Promise<StoredExtensionProfile>;
  importProfile: (packageText: string, password: string) => Promise<StoredExtensionProfile>;
  recoverProfile: (packageText: string, password: string) => Promise<StoredExtensionProfile>;
  activateProfile: (profileId: string) => Promise<void>;
  unlockProfile: (profileId: string, password: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  startRuntime: () => Promise<void>;
  stopRuntime: () => Promise<void>;
  reloadRuntime: () => Promise<void>;
  refreshRuntimePeers: () => Promise<void>;
  loadRuntimeDiagnostics: () => Promise<RuntimeDiagnosticsSnapshot>;
  prepareRuntime: <T = unknown>(operation: 'sign' | 'ecdh') => Promise<T>;
  updatePeerPolicy: (
    pubkey: string,
    patch: {
      direction: 'request' | 'respond';
      method: 'ping' | 'onboard' | 'sign' | 'ecdh';
      value: 'unset' | 'allow' | 'deny';
    }
  ) => Promise<StoredPeerPolicy[]>;
  clearPeerPolicyOverrides: () => Promise<StoredPeerPolicy[]>;
  revokeSitePermission: (policy: StoredPermissionPolicy) => Promise<void>;
  clearSitePermissions: () => Promise<void>;
  logout: () => Promise<void>;
  copyProfilePackage: (format: 'bfprofile' | 'bfshare', password: string) => Promise<string>;
};

const Store = createContext<AppState | null>(null);

function profileFailureFromState(state: ExtensionStateSnapshot | null): OnboardingFailureDetail | null {
  const message = state?.lifecycle.onboarding.lastError?.message;
  return message ? { message } : null;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<ExtensionStateSnapshot | null>(null);
  const [isHydratingProfile, setIsHydratingProfile] = useState(true);
  const [lastOnboardingFailure, setLastOnboardingFailure] = useState<OnboardingFailureDetail | null>(
    null
  );
  const stateVersionRef = React.useRef(0);

  const applyAppState = React.useCallback((next: ExtensionStateSnapshot) => {
    stateVersionRef.current += 1;
    setAppState(next);
    setLastOnboardingFailure(profileFailureFromState(next));
    setIsHydratingProfile(false);
  }, []);

  const refreshAppState = React.useCallback(async () => {
    const next = await fetchExtensionState();
    applyAppState(next);
    return next;
  }, [applyAppState]);

  const refreshAppStateQuietly = React.useCallback(async () => {
    const next = await fetchExtensionState().catch(() => null);
    if (next) {
      applyAppState(next);
    }
    return next;
  }, [applyAppState]);

  React.useEffect(() => {
    let cancelled = false;
    const bootstrapVersion = stateVersionRef.current;
    const chromeApi = getChromeApi();
    const listener = (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === EVENT_TYPE.STATE_CHANGED &&
        'state' in message
      ) {
        const next = message.state as ExtensionStateSnapshot;
        if (!cancelled) {
          applyAppState(next);
        }
      }
    };

    chromeApi?.runtime?.onMessage?.addListener?.(listener);
    void fetchExtensionState()
      .then((next) => {
        if (cancelled) return;
        if (stateVersionRef.current !== bootstrapVersion) {
          return;
        }
        applyAppState(next);
      })
      .catch(() => {
        if (!cancelled) {
          setIsHydratingProfile(false);
        }
      });

    return () => {
      cancelled = true;
      chromeApi?.runtime?.onMessage?.removeListener?.(listener);
    };
  }, [applyAppState]);

  const route: AppRoute = appState?.configured ? 'signer' : 'onboarding';
  const profile = appState?.profile ?? undefined;

  async function saveProfile(profileInput: StoredExtensionProfile) {
    const previousRelays = normalizeRelays(profile?.relays ?? DEFAULT_RELAYS).relays;
    const nextRelays = normalizeRelays(profileInput.relays?.length ? profileInput.relays : DEFAULT_RELAYS).relays;
    const relayChanged = JSON.stringify(previousRelays) !== JSON.stringify(nextRelays);
    await saveExtensionProfile(profileInput);
    if (appState?.runtime.phase === 'ready' || appState?.runtime.phase === 'degraded') {
      await updateRuntimeConfig(profileInput.signerSettings ?? {}).catch(() => undefined);
      if (relayChanged) {
        await reloadRuntime();
      }
    }
    await refreshAppStateQuietly();
  }

  async function connectOnboarding(input: StartOnboardingInput) {
    setLastOnboardingFailure(null);
    try {
      return await startOnboarding(input);
    } catch (error) {
      await refreshAppStateQuietly();
      throw error;
    }
  }

  async function finalizeOnboarding(
    pendingProfile: PendingOnboardingProfile,
    label: string,
    password: string
  ) {
    setLastOnboardingFailure(null);
    try {
      const profile = await completeOnboardingClient(pendingProfile, label, password);
      await refreshAppState();
      return profile;
    } catch (error) {
      await refreshAppStateQuietly();
      throw error;
    }
  }

  async function finalizeRotationUpdate(
    targetProfileId: string,
    pendingProfile: PendingOnboardingProfile
  ) {
    setLastOnboardingFailure(null);
    const profile = await completeRotationOnboarding({
      targetProfileId,
      pendingProfile
    });
    await refreshAppState();
    return profile;
  }

  async function importProfile(packageText: string, password: string) {
    setLastOnboardingFailure(null);
    const profile = await importBfprofile(packageText, password);
    await refreshAppState();
    return profile;
  }

  async function recoverProfile(packageText: string, password: string) {
    setLastOnboardingFailure(null);
    const profile = await recoverBfshare(packageText, password);
    await refreshAppState();
    return profile;
  }

  async function activateProfile(profileId: string) {
    await activateExtensionProfile(profileId);
    await refreshAppState();
  }

  async function unlockProfile(profileId: string, password: string) {
    await unlockExtensionProfile(profileId, password);
    await refreshAppState();
  }

  async function deleteProfile(profileId: string) {
    await deleteExtensionProfile(profileId);
    await refreshAppState();
  }

  async function logout() {
    await stopRuntime().catch(() => undefined);
    await logoutExtensionProfile().catch(() => undefined);
    stateVersionRef.current += 1;
    setAppState((current) =>
      current
        ? {
            ...current,
            configured: false,
            profile: null,
            activeProfileId: null
          }
        : current
    );
    setLastOnboardingFailure(null);
    setIsHydratingProfile(false);
  }

  async function startRuntimeAction() {
    await startRuntime();
    await refreshAppStateQuietly();
  }

  async function stopRuntimeAction() {
    await stopRuntime();
    await refreshAppStateQuietly();
  }

  async function reloadRuntimeAction() {
    await reloadRuntime();
    await refreshAppStateQuietly();
  }

  async function refreshRuntimePeersAction() {
    await refreshRuntimePeers();
    await refreshAppStateQuietly();
  }

  async function loadRuntimeDiagnosticsAction() {
    return await fetchRuntimeDiagnostics();
  }

  async function prepareRuntimeAction<T = unknown>(operation: 'sign' | 'ecdh') {
    return await prepareRuntime<T>(operation);
  }

  async function updatePeerPolicyAction(
    pubkey: string,
    patch: {
      direction: 'request' | 'respond';
      method: 'ping' | 'onboard' | 'sign' | 'ecdh';
      value: 'unset' | 'allow' | 'deny';
    }
  ) {
    const result = await updateRuntimePeerPolicy(pubkey, patch);
    await refreshAppStateQuietly();
    return result;
  }

  async function clearPeerPolicyOverridesAction() {
    const result = await clearRuntimePeerPolicyOverrides();
    await refreshAppStateQuietly();
    return result;
  }

  async function revokeSitePermissionAction(policy: StoredPermissionPolicy) {
    await revokePermissionPolicy(policy);
    await refreshAppStateQuietly();
  }

  async function clearSitePermissionsAction() {
    await clearPermissionPolicies();
    await refreshAppStateQuietly();
  }

  async function copyProfilePackageAction(format: 'bfprofile' | 'bfshare', password: string) {
    return await exportExtensionProfilePackage(format, password);
  }

  const value = useMemo<AppState>(
    () => ({
      route,
      isHydratingProfile,
      appState,
      profile,
      lastOnboardingFailure,
      clearOnboardingFailure: () => setLastOnboardingFailure(null),
      saveProfile,
      connectOnboarding,
      completeOnboarding: finalizeOnboarding,
      completeRotationUpdate: finalizeRotationUpdate,
      importProfile,
      recoverProfile,
      activateProfile,
      unlockProfile,
      deleteProfile,
      startRuntime: startRuntimeAction,
      stopRuntime: stopRuntimeAction,
      reloadRuntime: reloadRuntimeAction,
      refreshRuntimePeers: refreshRuntimePeersAction,
      loadRuntimeDiagnostics: loadRuntimeDiagnosticsAction,
      prepareRuntime: prepareRuntimeAction,
      updatePeerPolicy: updatePeerPolicyAction,
      clearPeerPolicyOverrides: clearPeerPolicyOverridesAction,
      revokeSitePermission: revokeSitePermissionAction,
      clearSitePermissions: clearSitePermissionsAction,
      logout,
      copyProfilePackage: copyProfilePackageAction
    }),
    [route, isHydratingProfile, appState, profile, lastOnboardingFailure]
  );

  return <Store.Provider value={value}>{children}</Store.Provider>;
}

export function useStore() {
  const ctx = useContext(Store);
  if (!ctx) throw new Error('StoreProvider missing');
  return ctx;
}
