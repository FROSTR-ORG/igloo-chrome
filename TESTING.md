# Testing

## Test layers
This repository currently relies on browser-level end-to-end coverage owned by the
top-level infra test workspace.

Primary suite:
- `npm run test:e2e`

The Playwright suite covers:
- onboarding and dashboard smoke flows
- popup, permissions, and settings flows
- provider permission prompts and persisted approvals
- live `getPublicKey()`, `signEvent`, and `nip44.encrypt/decrypt`
- runtime teardown, restore, and relaunch lifecycle behavior

## Prerequisites
- dependencies installed with `npm install`
- WASM artifacts built via `npm run build:bridge-wasm`
- Chromium available for Playwright

## Typical workflow
1. `bunx tsc --noEmit`
2. `npm run build:bridge-wasm`
3. `npm run build`
4. `npm run test:e2e`

Observability controls:
- `VITE_IGLOO_VERBOSE=1 npm run build`
- `VITE_IGLOO_DEBUG=1 npm run build`

The infra-owned Playwright fixtures default to `VITE_IGLOO_VERBOSE=1` for live/runtime coverage.

The Playwright source now lives in `../../test/igloo-chrome`.

## Notes
- The live signer tests start local relay/responder fixtures.
- The demo harness can be started manually from the infra repo root with `make demo-harness BG=1`.
- Manual demo onboarding packages and passwords are written under `../../data/test-harness/`.
- Test results are written under `../../test/igloo-chrome/results/` when Playwright emits artifacts.
- Failed runs also write `observability-bundle.json` alongside the Playwright artifacts.
- Runtime sign tests now assert nonce readiness before cryptographic operations. A healthy threshold-signing snapshot has enough peers with `can_sign=true` for the active threshold.
- Demo signing depends on the sign-ready peer subset, not raw peer ordering.
- If a test touching runtime behavior fails, inspect the Playwright trace first, then `observability-bundle.json`, then the local/offscreen nonce snapshot assertions, then the responder logs.
