import { configureWasmBridgeLoader, configureWasmProfileLoader } from 'igloo-shared';
import { getChromeApi } from '@/extension/chrome';

let configured = false;

export function ensureIglooSharedConfigured() {
  if (configured) {
    return;
  }

  const runtime = getChromeApi()?.runtime;
  if (!runtime?.getURL) {
    return;
  }

  configureWasmBridgeLoader({
    loaderImportUrl: runtime.getURL('wasm/bifrost_bridge_wasm.js'),
    wasmBinaryUrl: runtime.getURL('wasm/bifrost_bridge_wasm_bg.wasm'),
  });
  configureWasmProfileLoader({
    loaderImportUrl: runtime.getURL('wasm/bifrost_profile_wasm.js'),
    wasmBinaryUrl: runtime.getURL('wasm/bifrost_profile_wasm_bg.wasm'),
  });
  configured = true;
}
