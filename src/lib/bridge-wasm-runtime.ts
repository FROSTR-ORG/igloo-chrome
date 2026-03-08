import { getChromeApi } from '@/extension/chrome';

export type WasmBridgeRuntimeApi = {
  init_runtime: (configJson: string, bootstrapJson: string) => void;
  restore_runtime: (configJson: string, snapshotJson: string) => void;
  handle_command: (commandJson: string) => void;
  handle_inbound_event: (eventJson: string) => void;
  tick: (nowUnixMs: number) => void;
  drain_outbound_events_json: () => string;
  drain_completions_json: () => string;
  drain_failures_json: () => string;
  snapshot_state_json: () => string;
  status_json: () => string;
  policies_json: () => string;
  set_policy: (policyJson: string) => void;
  decode_onboarding_package_json_with_password: (value: string, password: string) => string;
};

type WasmBridgeModule = {
  WasmBridgeRuntime: new () => {
    init_runtime: (configJson: string, bootstrapJson: string) => void;
    restore_runtime: (configJson: string, snapshotJson: string) => void;
    handle_command: (commandJson: string) => void;
    handle_inbound_event: (eventJson: string) => void;
    tick: (nowUnixMs: bigint) => void;
    drain_outbound_events_json: () => string;
    drain_completions_json: () => string;
    drain_failures_json: () => string;
    snapshot_state_json: () => string;
    status_json: () => string;
    policies_json: () => string;
    set_policy: (policyJson: string) => void;
    decode_onboarding_package_json_with_password: (value: string, password: string) => string;
  };
};

type WasmBridgeLoaderModule = {
  default: (options?: { module_or_path?: string | URL }) => Promise<unknown>;
  WasmBridgeRuntime?: WasmBridgeModule['WasmBridgeRuntime'];
};

declare global {
  interface Window {
    BifrostBridgeWasm?: WasmBridgeModule;
  }
}

let cachedModule: WasmBridgeModule | null = null;
let loadingModulePromise: Promise<WasmBridgeModule> | null = null;

function getAssetUrl(path: string) {
  const chromeApi = getChromeApi();
  const fromRuntime = chromeApi?.runtime?.getURL?.(path);
  if (fromRuntime) return fromRuntime;
  return new URL(path, window.location.origin).toString();
}

export async function loadWasmBridgeModule(): Promise<WasmBridgeModule> {
  if (cachedModule) return cachedModule;
  if (loadingModulePromise) return await loadingModulePromise;

  const globalModule =
    typeof window !== 'undefined' ? window.BifrostBridgeWasm : undefined;
  if (globalModule?.WasmBridgeRuntime) {
    cachedModule = globalModule;
    return globalModule;
  }

  const modulePath = '/wasm/bifrost_bridge_wasm_loader.mjs';
  if (typeof window === 'undefined') {
    throw new Error('WASM bridge module can only load in browser environments');
  }

  loadingModulePromise = (async () => {
    try {
      const imported = (await import(
        /* @vite-ignore */
        getAssetUrl('wasm/bifrost_bridge_wasm.js')
      )) as WasmBridgeLoaderModule;
      await imported.default({
        module_or_path: getAssetUrl('wasm/bifrost_bridge_wasm_bg.wasm')
      });

      const runtimeCtor = imported.WasmBridgeRuntime;
      if (!runtimeCtor) {
        throw new Error(
          'WASM bridge module loaded but WasmBridgeRuntime export is missing'
        );
      }

      cachedModule = { WasmBridgeRuntime: runtimeCtor };
      window.BifrostBridgeWasm = cachedModule;
      return cachedModule;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown dynamic import error';
      throw new Error(
        `Failed to load ${modulePath}. Run "npm run build:bridge-wasm" first. (${message})`
      );
    } finally {
      loadingModulePromise = null;
    }
  })();

  return await loadingModulePromise;
}

export async function createWasmBridgeRuntime(): Promise<WasmBridgeRuntimeApi> {
  const module = await loadWasmBridgeModule();
  const raw = new module.WasmBridgeRuntime();
  return {
    init_runtime: raw.init_runtime.bind(raw),
    restore_runtime: raw.restore_runtime.bind(raw),
    handle_command: raw.handle_command.bind(raw),
    handle_inbound_event: raw.handle_inbound_event.bind(raw),
    tick: (nowUnixMs: number) => raw.tick(BigInt(nowUnixMs)),
    drain_outbound_events_json: raw.drain_outbound_events_json.bind(raw),
    drain_completions_json: raw.drain_completions_json.bind(raw),
    drain_failures_json: raw.drain_failures_json.bind(raw),
    snapshot_state_json: raw.snapshot_state_json.bind(raw),
    status_json: raw.status_json.bind(raw),
    policies_json: raw.policies_json.bind(raw),
    set_policy: raw.set_policy.bind(raw),
    decode_onboarding_package_json_with_password:
      raw.decode_onboarding_package_json_with_password.bind(raw)
  };
}
