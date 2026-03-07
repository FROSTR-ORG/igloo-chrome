# igloo-ext
Chrome extension scaffold for the v2 FROSTR signing device.

This project is intentionally extension-first:
- `background.js` is the control plane.
- `offscreen.html` hosts the WASM runtime boundary and future long-lived relay sessions.
- `options.html` is the operator dashboard built from the current `igloo-web` UI.
- `content-script.js` and `nostr-provider.js` expose the website bridge.

The runtime target is `bifrost-rs` compiled to browser WASM. The visible dashboard borrows the current `igloo-web` onboarding/signer surface, but the extension architecture is not a direct copy of `igloo-web` or `frost2x`.

## Current status
- MV3 extension package builds into `dist/`
- popup, prompt, dashboard, background, content-script, and offscreen document are wired
- onboarding persists profile data into extension storage for background/offscreen use
- `window.nostr` bridge is present with permission prompts
- signing/encryption requests are still placeholders on the offscreen runtime side

## Build
1. `npm install`
2. `npm run build:bridge-wasm`
3. `npm run build`

Load `dist/` as an unpacked extension in Chrome.

## WASM artifacts
The extension expects these files in `public/wasm`:
- `bifrost_bridge_wasm.js`
- `bifrost_bridge_wasm_bg.wasm`

Refresh them with:
- `npm run build:bridge-wasm`

Default `bifrost-rs` path:
- `/home/cscott/Repos/frostr/bifrost-infra/repos/bifrost-rs`

Override with:
- `BIFROST_RS_DIR=/absolute/path/to/bifrost-rs npm run build:bridge-wasm`

## Build system
The extension no longer depends on Vite for packaging.

`scripts/build.mjs` does four things:
1. copies `public/` into `dist/`
2. builds Tailwind/PostCSS output into `dist/index.css`
3. bundles each extension entry independently with `esbuild`
4. writes the final extension HTML shells into `dist/`

Independent entry bundling is deliberate because Chrome content scripts and injected provider scripts need deterministic single-file outputs.

## Next implementation targets
1. move actual signer session ownership into the offscreen document
2. route `nostr.signEvent` and NIP-44 methods through the offscreen runtime
3. add dashboard permission management and runtime status inspection
4. add extension-focused e2e coverage for the provider bridge
