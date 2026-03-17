# igloo-chrome

Chrome MV3 signing-device extension for FROSTR.

This project is extension-first:
- `background.js` is the control plane.
- `offscreen.html` hosts the signer runtime boundary.
- `options.html` is the operator dashboard.
- `popup.html` exposes quick status and entry into the dashboard.
- `content-script.js` and `nostr-provider.js` expose the website bridge.

The runtime target is `bifrost-rs` compiled to browser WASM. The extension UI borrows the newer `igloo-web` operator surface, but the extension architecture is purpose-built for MV3.

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
- Playwright coverage now lives in `../../test/igloo-chrome` and exercises smoke, provider, live signer, and lifecycle paths

## Prerequisites
- Node.js and npm
- `wasm-pack`
- `clang`
- local `bifrost-rs` checkout at `../bifrost-rs` in this workspace, or `BIFROST_RS_DIR` set explicitly

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

`npm run test:e2e` proxies to the infra-owned Playwright suite under `../../test/igloo-chrome`.

The Playwright global setup:
- builds the extension once
- prebuilds shared shell binaries into `../../build/igloo-shell-target`
- runs the chrome suite with `2` workers

The E2E harness writes Playwright artifacts under `../../test/igloo-chrome/results/`. Failed runs also attach `observability-bundle.json` with structured runtime diagnostics and fixture event logs.

Manual demo environment:
- `./run.sh demo start` from the infra repo root starts `services/dev-relay` and `services/igloo-demo`
- direct `docker compose -f compose.test.yml ...` is also supported for advanced/manual runs
- manual demo onboarding packages and passwords are written under `../../data/test-harness/`
- browser-facing local demo relays should use `ws://localhost:<port>`
- Playwright fixtures do not use the shared `data/test-harness` path; they provision an isolated compose project plus a temporary artifact directory per test worker
- `./run.sh demo onboard` prints the current package/password pairs for manual pairing with the extension

Cross-repo demo/testing strategy lives in
[`../../docs/E2E-DEMO-STRATEGY.md`](../../docs/E2E-DEMO-STRATEGY.md).

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
- `../bifrost-rs`

Override with:
- `BIFROST_RS_DIR=/absolute/path/to/bifrost-rs npm run build:bridge-wasm`

The canonical browser bridge artifacts are owned by [`igloo-shared`](/home/cscott/Repos/frostr/frostr-infra/repos/igloo-shared). The Chrome build step syncs those shared artifacts into the extension `public/wasm` directory.

## Build system
The extension is packaged without Vite.

`scripts/build.mjs` does four things:
1. copies `public/` into `dist/`
2. builds Tailwind output into `dist/index.css`
3. bundles each extension entry independently with `esbuild`
4. writes the final extension HTML shells into `dist/`

Independent entry bundling is deliberate because Chrome content scripts and injected provider scripts need deterministic single-file outputs.

## Shared UI
Reusable presentational UI comes from `../igloo-ui` as the local `igloo-ui` package.
Extension-specific runtime, provider, and control-plane logic remains in `igloo-chrome`.

## Project docs
- [CHANGELOG.md](./CHANGELOG.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [TESTING.md](./TESTING.md)
- [RELEASE.md](./RELEASE.md)
- [../../docs/INDEX.md](../../docs/INDEX.md)
- [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [../../docs/PROTOCOL.md](../../docs/PROTOCOL.md)
- [../../docs/adrs/INDEX.md](../../docs/adrs/INDEX.md)
