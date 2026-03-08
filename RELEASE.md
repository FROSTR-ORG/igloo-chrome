# Release Process

## Goal
Produce a deterministic browser-loadable extension candidate from the current repository state.

## Prerequisites
- clean working tree or intentionally reviewed release changes
- `npm install`
- `wasm-pack`
- `clang`
- local `bifrost-rs` checkout at `../bifrost-rs`, or `BIFROST_RS_DIR` set correctly

## Pre-release checks
1. `bunx tsc --noEmit`
2. `npm run build:bridge-wasm`
3. `npm run build`
4. `npm run test:e2e`

## Versioning
Keep these aligned:
- `package.json`
- `public/manifest.json`
- `CHANGELOG.md`

Chrome manifest versions must be numeric dotted versions.

## Packaging
1. `npm run package`
2. Review the generated candidate under `artifacts/`
3. Load the unpacked candidate directory in Chrome via `chrome://extensions`

The packaging step creates:
- a browser-loadable unpacked candidate directory
- a SHA-256 checksum file
- a zip archive when the local `zip` command is available

## Manual release verification
Before handing off a candidate, verify:
- onboarding completes
- popup opens and reports status
- `window.nostr.getPublicKey()` succeeds
- `window.nostr.signEvent()` succeeds against a live responder
- `window.nostr.nip44.encrypt/decrypt()` succeed against a live responder
- permissions can be reviewed and revoked
- offscreen/runtime survives teardown and relaunch scenarios

## Candidate handoff
Provide:
- version number
- candidate path under `artifacts/`
- checksum file path
- summary of verification run
- notable known risks, if any
