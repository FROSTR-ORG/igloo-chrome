import { configureWasmBridgeLoader, configureWasmProfileLoader } from 'igloo-shared';
import { getChromeApi } from '@/extension/chrome';
import loadBridgeWasm, * as bridgeWasmModule from '../../public/wasm/bifrost_bridge_wasm_loader.mjs';
import loadProfileWasm, * as profileWasmModule from '../../public/wasm/bifrost_profile_wasm_loader.mjs';

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
    preloadedModule: {
      ...bridgeWasmModule,
      default: loadBridgeWasm,
    },
  });
  configureWasmProfileLoader({
    loaderImportUrl: runtime.getURL('wasm/bifrost_profile_wasm.js'),
    wasmBinaryUrl: runtime.getURL('wasm/bifrost_profile_wasm_bg.wasm'),
    preloadedModule: {
      ...profileWasmModule,
      default: loadProfileWasm,
    },
  });
  configured = true;
}
