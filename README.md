# igloo-ext

Chrome MV3 signing-device extension for FROSTR.

This project is extension-first:
- `background.js` is the control plane.
- `offscreen.html` hosts the signer runtime boundary.
- `options.html` is the operator dashboard.
- `popup.html` exposes quick status and entry into the dashboard.
- `content-script.js` and `nostr-provider.js` expose the website bridge.

The runtime target is `bifrost-rs` compiled to browser WASM. The extension UI borrows the newer `igloo-web` operator surface, but the extension architecture is purpose-built for MV3.

## Status
- MV3 extension package builds into `dist/`
- real `getPublicKey()`, `signEvent`, and `nip44.encrypt/decrypt` are wired through the WASM runtime
- onboarding persists profile data for background and offscreen runtime recovery
- runtime snapshots survive offscreen teardown and browser-context relaunch
- Playwright coverage exercises smoke, provider, live signer, and lifecycle paths

## Prerequisites
- Node.js and npm
- `wasm-pack`
- `clang`
- local `bifrost-rs` checkout at `/home/cscott/Repos/frostr/bifrost-infra/repos/bifrost-rs`, or `BIFROST_RS_DIR` set explicitly

## Build
1. `npm install`
2. `npm run build:bridge-wasm`
3. `npm run build`

Load `dist/` as an unpacked extension in Chrome.

## Test
1. `bunx tsc --noEmit`
2. `npm run build:bridge-wasm`
3. `npm run build`
4. `npm run test:e2e`

## Release candidate
1. `npm run release:candidate`
2. Load the unpacked candidate under `artifacts/` in Chrome via `chrome://extensions`

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
The extension is packaged without Vite.

`scripts/build.mjs` does four things:
1. copies `public/` into `dist/`
2. builds Tailwind output into `dist/index.css`
3. bundles each extension entry independently with `esbuild`
4. writes the final extension HTML shells into `dist/`

Independent entry bundling is deliberate because Chrome content scripts and injected provider scripts need deterministic single-file outputs.

## Project docs
- [CHANGELOG.md](/home/cscott/Repos/frostr/igloo-ext/CHANGELOG.md)
- [CONTRIBUTING.md](/home/cscott/Repos/frostr/igloo-ext/CONTRIBUTING.md)
- [SECURITY.md](/home/cscott/Repos/frostr/igloo-ext/SECURITY.md)
- [TESTING.md](/home/cscott/Repos/frostr/igloo-ext/TESTING.md)
- [RELEASE.md](/home/cscott/Repos/frostr/igloo-ext/RELEASE.md)
