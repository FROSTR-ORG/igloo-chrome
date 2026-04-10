type ChromeGlobal = typeof globalThis & {
  chrome?: {
    runtimePort?: never;
    runtime?: {
      connect?: (connectInfo?: { name?: string }) => {
        postMessage?: (message: unknown) => void;
        disconnect?: () => void;
        onMessage?: {
          addListener?: (listener: (message: unknown) => void) => void;
          removeListener?: (listener: (message: unknown) => void) => void;
        };
        onDisconnect?: {
          addListener?: (listener: () => void) => void;
          removeListener?: (listener: () => void) => void;
        };
      };
      id?: string;
      getURL?: (path: string) => string;
      openOptionsPage?: () => Promise<void>;
      reload?: () => void;
      sendMessage?: (message: unknown) => Promise<unknown>;
      onInstalled?: { addListener: (listener: (details: { reason: string }) => void) => void };
      onStartup?: { addListener: (listener: () => void) => void };
      onMessage?: {
        addListener: (
          listener: (
            message: unknown,
            sender: unknown,
            sendResponse: (response?: unknown) => void
          ) => boolean | void
        ) => void;
        removeListener?: (
          listener: (
            message: unknown,
            sender: unknown,
            sendResponse: (response?: unknown) => void
          ) => boolean | void
        ) => void;
      };
      onConnect?: {
        addListener?: (
          listener: (port: {
            name?: string;
            postMessage?: (message: unknown) => void;
            disconnect?: () => void;
            onMessage?: {
              addListener?: (listener: (message: unknown) => void) => void;
              removeListener?: (listener: (message: unknown) => void) => void;
            };
            onDisconnect?: {
              addListener?: (listener: () => void) => void;
              removeListener?: (listener: () => void) => void;
            };
          }) => void
        ) => void;
      };
    };
    storage?: {
      local?: {
        get?: (keys?: string | string[] | Record<string, unknown>) => Promise<Record<string, unknown>>;
        set?: (items: Record<string, unknown>) => Promise<void>;
        remove?: (keys: string | string[]) => Promise<void>;
      };
    };
    windows?: {
      create?: (options: Record<string, unknown>) => Promise<{ id?: number }>;
      remove?: (windowId: number) => Promise<void>;
      onRemoved?: { addListener: (listener: (windowId: number) => void) => void };
    };
  };
};

export function getChromeApi() {
  return (globalThis as ChromeGlobal).chrome ?? null;
}

export function isExtensionContext() {
  return !!getChromeApi()?.runtime?.id;
}
