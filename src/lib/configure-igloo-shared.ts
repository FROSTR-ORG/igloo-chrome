import { configureWasmBridgeLoader, configureWasmProfileLoader } from 'igloo-shared';
// Statically import the wasm-pack glue modules so the bundler links them into the
// background bundle. The MV3 service worker is a module worker, where *dynamic*
// `import()` is disallowed (ServiceWorkerGlobalScope) — but a static `import` is
// fine. We then hand each glue module to igloo-shared via `preloadedModule`, which
// bypasses the loader's dynamic-import path entirely. The glue still fetches its
// `_bg.wasm` from the explicit `wasmBinaryUrl` we pass below (fetch is allowed in a
// service worker), so no `.wasm` asset is inlined into the bundle.
import * as bridgeWasmModule from '../../public/wasm/bifrost_bridge_wasm.js';
import * as profileWasmModule from '../../public/wasm/bifrost_profile_wasm.js';
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
    preloadedModule: bridgeWasmModule as never,
    wasmBinaryUrl: runtime.getURL('wasm/bifrost_bridge_wasm_bg.wasm'),
  });
  configureWasmProfileLoader({
    preloadedModule: profileWasmModule as never,
    wasmBinaryUrl: runtime.getURL('wasm/bifrost_profile_wasm_bg.wasm'),
  });
  configured = true;
}
