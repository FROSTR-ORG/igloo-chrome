import React, { createContext, useContext, useMemo, useState } from 'react';
import { getChromeApi } from '@/extension/chrome';
import {
  clearExtensionProfileState,
  fetchExtensionAppState,
  saveExtensionProfile,
  sendRuntimeControl,
  startOnboarding,
  type StartOnboardingInput
} from '@/extension/client';
import {
  MESSAGE_TYPE,
  type ExtensionAppState,
  type StoredExtensionProfile
} from '@/extension/protocol';

export type AppRoute = 'onboarding' | 'signer';

export type OnboardingFailureDetail = {
  message: string;
};

type AppState = {
  route: AppRoute;
  isHydratingProfile: boolean;
  appState: ExtensionAppState | null;
  profile?: StoredExtensionProfile;
  setProfile: (s?: StoredExtensionProfile) => void;
  lastOnboardingFailure: OnboardingFailureDetail | null;
  clearOnboardingFailure: () => void;
  saveProfile: (s: StoredExtensionProfile) => Promise<void>;
  connectOnboarding: (s: StartOnboardingInput) => Promise<void>;
  logout: () => void;
  wipeAllData: () => Promise<void>;
};

const Store = createContext<AppState | null>(null);

function profileFailureFromState(state: ExtensionAppState | null): OnboardingFailureDetail | null {
  const message = state?.lifecycle.onboarding.lastError?.message;
  return message ? { message } : null;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<ExtensionAppState | null>(null);
  const [isHydratingProfile, setIsHydratingProfile] = useState(true);
  const [lastOnboardingFailure, setLastOnboardingFailure] = useState<OnboardingFailureDetail | null>(
    null
  );
  const stateVersionRef = React.useRef(0);

  const applyAppState = React.useCallback((next: ExtensionAppState) => {
    stateVersionRef.current += 1;
    setAppState(next);
    setLastOnboardingFailure(profileFailureFromState(next));
    setIsHydratingProfile(false);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const bootstrapVersion = stateVersionRef.current;
    const chromeApi = getChromeApi();
    const listener = (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === MESSAGE_TYPE.APP_STATE_UPDATED &&
        'state' in message
      ) {
        const next = message.state as ExtensionAppState;
        if (!cancelled) {
          applyAppState(next);
        }
      }
    };

    chromeApi?.runtime?.onMessage?.addListener?.(listener);
    void fetchExtensionAppState()
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

  React.useEffect(() => {
    if (appState?.configured) {
      return;
    }
    let cancelled = false;
    const handle = window.setInterval(() => {
      void fetchExtensionAppState()
        .then((next) => {
          if (cancelled) return;
          if (
            next.configured ||
            next.lifecycle.activation.stage !== 'idle' ||
            next.lifecycle.onboarding.stage !== 'idle'
          ) {
            applyAppState(next);
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [appState?.configured, applyAppState]);

  const route: AppRoute = appState?.configured ? 'signer' : 'onboarding';
  const profile = appState?.profile ?? undefined;

  async function saveProfile(profileInput: StoredExtensionProfile) {
    const saved = await saveExtensionProfile(profileInput);
    const next = await fetchExtensionAppState().catch(
      () =>
        ({
          ...appState,
          configured: true,
          profile: saved
        }) as ExtensionAppState
    );
    applyAppState(next);
  }

  async function connectOnboarding(input: StartOnboardingInput) {
    setLastOnboardingFailure(null);
    try {
      await startOnboarding(input);
      const next = await fetchExtensionAppState();
      applyAppState(next);
    } catch (error) {
      const next = await fetchExtensionAppState().catch(() => null);
      if (next) {
        applyAppState(next);
      }
      throw error;
    }
  }

  function logout() {
    void sendRuntimeControl('stopRuntime').catch(() => undefined);
    void clearExtensionProfileState().catch(() => undefined);
    setAppState((current) =>
      current
        ? {
            ...current,
            configured: false,
            profile: null
          }
        : current
    );
    setLastOnboardingFailure(null);
    setIsHydratingProfile(false);
  }

  async function wipeAllData() {
    await sendRuntimeControl('wipeRuntime').catch(() => undefined);
    await sendRuntimeControl('stopRuntime').catch(() => undefined);
    await clearExtensionProfileState();
    const next = await fetchExtensionAppState();
    applyAppState(next);
  }

  const value = useMemo<AppState>(
    () => ({
      route,
      isHydratingProfile,
      appState,
      profile,
      setProfile: (next) => {
        stateVersionRef.current += 1;
        setAppState((current) =>
          current
            ? {
                ...current,
                configured: !!next,
                profile: next ?? null
              }
            : current
        );
      },
      lastOnboardingFailure,
      clearOnboardingFailure: () => setLastOnboardingFailure(null),
      saveProfile,
      connectOnboarding,
      logout,
      wipeAllData
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
