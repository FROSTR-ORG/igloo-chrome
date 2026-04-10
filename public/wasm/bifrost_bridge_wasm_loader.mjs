import init, * as wasm from './bifrost_bridge_wasm.js';

const wasmUrl = new URL('./bifrost_bridge_wasm_bg.wasm', import.meta.url);

export default async function loadWasm(options = {}) {
  await init({ module_or_path: options.module_or_path ?? wasmUrl });
  return wasm;
}

export * from './bifrost_bridge_wasm.js';
