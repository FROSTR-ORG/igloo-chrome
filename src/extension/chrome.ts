type ChromeGlobal = typeof globalThis & {
  chrome?: {
    offscreen?: {
      createDocument?: (options: {
        url: string;
        reasons: string[];
        justification: string;
      }) => Promise<void>;
      closeDocument?: () => Promise<void>;
    };
    runtime?: {
      id?: string;
      getURL?: (path: string) => string;
      getContexts?: (filter: Record<string, unknown>) => Promise<unknown[]>;
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
