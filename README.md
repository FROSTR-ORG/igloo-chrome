# igloo-chrome

Chrome MV3 signing-device extension for FROSTR.

## Status

- Beta.

This project is extension-first:
- `background.js` is the control plane.
- `offscreen.html` hosts the signer runtime boundary.
- `options.html` is the operator dashboard.
- `popup.html` exposes quick status and entry into the dashboard.
- `content-script.js` and `nostr-provider.js` expose the website bridge.

The runtime target is the shared Rust signer runtime compiled to browser WASM. The extension architecture is purpose-built for MV3.

The extension is a thin host over the signer runtime:
- signer truth comes from `bifrost-rs`
- background caches and distributes signer state
- offscreen owns the live WASM runtime session
- UI renders signer-owned status and controls
- shared presentational components come from the sibling `igloo-ui` package

## Status
- MV3 extension package builds into `dist/`
- `getPublicKey()` is served from configured profile metadata, while `signEvent` and `nip44.encrypt/decrypt` still require the live WASM runtime
- onboarding persists profile data for background and offscreen runtime recovery
- runtime snapshots survive offscreen teardown and browser-context relaunch
- signer-owned `runtime_status()` is the canonical status model
- signer-owned `drain_runtime_events()` is the normal incremental update path
- Playwright coverage exercises smoke, provider, live signer, and lifecycle paths

## Prerequisites
- Node.js and npm
- `wasm-pack`
- `clang`
- access to the shared Rust signer runtime source used to build the WASM bridge, or `BIFROST_RS_DIR` set explicitly

## Build
1. `npm install`
2. `npm run build:bridge-wasm`
3. `npm run build`

Build-time observability controls:
- `VITE_IGLOO_VERBOSE=1 npm run build`
- `VITE_IGLOO_DEBUG=1 npm run build`

Load `dist/` as an unpacked extension in Chrome.

## Test
1. `bunx tsc --noEmit`
2. `npm run build:bridge-wasm`
3. `npm run build`
4. `npm run test:e2e`

`npm run test:e2e` proxies to the workspace-owned Playwright suite for this extension.

The Playwright global setup:
- builds the extension once
- prebuilds the required shared runtime test binaries
- runs the chrome suite with `2` workers

The E2E harness writes Playwright artifacts into the workspace test-results area. Failed runs also attach `observability-bundle.json` with structured runtime diagnostics and fixture event logs.

Manual demo environment:
- use the workspace demo harness entrypoints for manual onboarding/signing runs
- direct Docker Compose demo control is also supported for advanced/manual runs
- manual demo onboarding packages and passwords are written by the harness into its generated artifact directory
- browser-facing local demo relays should use `ws://localhost:<port>`
- Playwright fixtures do not use the shared manual-harness path; they provision an isolated compose project plus a temporary artifact directory per test worker

## Release candidate
1. `npm run release:candidate`
2. Load the unpacked candidate under `artifacts/` in Chrome via `chrome://extensions`

## WASM artifacts
The extension expects these files in `public/wasm`:
- `bifrost_bridge_wasm.js`
- `bifrost_bridge_wasm_bg.wasm`

Refresh them with:
- `npm run build:bridge-wasm`

Override the bridge source checkout with:
- `BIFROST_RS_DIR=/absolute/path/to/runtime-source npm run build:bridge-wasm`

The build step syncs the shared browser bridge artifacts into the extension `public/wasm` directory.

## Build system
The extension is packaged without Vite.

`scripts/build.mjs` does four things:
1. copies `public/` into `dist/`
2. builds Tailwind output into `dist/index.css`
3. bundles each extension entry independently with `esbuild`
4. writes the final extension HTML shells into `dist/`

Independent entry bundling is deliberate because Chrome content scripts and injected provider scripts need deterministic single-file outputs.

## Shared UI
Reusable presentational UI comes from the local `igloo-ui` package.
Extension-specific runtime, provider, and control-plane logic remains in `igloo-chrome`.

## Project docs
- [CHANGELOG.md](./CHANGELOG.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [TESTING.md](./TESTING.md)
- [RELEASE.md](./RELEASE.md)
