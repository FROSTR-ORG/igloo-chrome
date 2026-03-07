# Testing

## Test layers
This repository currently relies on browser-level end-to-end coverage.

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

## Notes
- The live signer tests start local relay/responder fixtures.
- Test results are written under `test/results/` when Playwright emits artifacts.
- If a test touching runtime behavior fails, inspect the runtime diagnostics in the options page and compare against the lifecycle tests.
