# Testing

## Test layers
This repository currently relies on browser-level end-to-end coverage owned by the
top-level infra test workspace.

Primary suite:
- `npm run test:e2e`

Canonical tiers from the infra test workspace:
- `npm --prefix ../../test run test:e2e:smoke`
- `npm --prefix ../../test run test:e2e:fast`
- `npm --prefix ../../test run test:e2e:live`
- `npm --prefix ../../test run test:e2e:demo`

The Playwright suite covers:
- onboarding and dashboard smoke flows
- popup, permissions, and settings flows
- provider permission prompts and persisted approvals
- live `getPublicKey()`, `signEvent`, and `nip44.encrypt/decrypt`
- live encrypted profile backup publish through the managed shell/relay path
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

The Playwright config now runs a global setup step before the suite:
- prebuilds the shared `igloo-shell` binaries under `../../build/igloo-shell-target`
- builds the unpacked extension once
- then runs the suite with `2` workers

Provider expectations in live tests:
- `getPublicKey()` reads configured profile metadata and does not require a hot runtime restore
- `signEvent` and `nip44.encrypt/decrypt` still require the live runtime and nonce-ready peer state

Normal runtime success paths now use signer-owned APIs:
- `runtime_status()` for host/UI state
- `prepare_sign()` before threshold signing
- `prepare_ecdh()` before NIP-44 encrypt/decrypt

Snapshot and nonce-pool inspection remain useful for diagnostics, but they are no longer the primary readiness gate for normal application behavior.

Observability controls:
- `VITE_IGLOO_VERBOSE=1 npm run build`
- `VITE_IGLOO_DEBUG=1 npm run build`

The infra-owned Playwright fixtures default to `VITE_IGLOO_VERBOSE=1` for live/runtime coverage.

The Playwright source now lives in `../../test/igloo-chrome`.

Cross-repo strategy and manual/demo entrypoints are documented in
[`../../docs/E2E-DEMO-STRATEGY.md`](../../docs/E2E-DEMO-STRATEGY.md).

## Notes
- The live signer tests start local relay/responder fixtures.
- The demo stack can be started manually from the infra repo root with `./run.sh demo start`.
- Advanced/operator manual runs may also use direct `docker compose -f compose.test.yml ...`.
- Manual demo onboarding packages and passwords are written under `../../data/test-harness/`.
- Browser-facing local demo relay URLs should use `ws://localhost:<port>`.
- Playwright live fixtures use isolated Docker Compose project names and per-run temporary artifact directories so `igloo-chrome` and `igloo-home` test runs do not collide.
- Test results are written under `../../test/igloo-chrome/results/` when Playwright emits artifacts.
- Failed runs also write `observability-bundle.json` alongside the Playwright artifacts.
- Runtime diagnostics should be read in this order: Playwright trace, `observability-bundle.json`, signer `runtime_status()` / drained runtime events, then snapshot details if deeper debugging is needed.

Cross-repo architecture and guidance docs live under `../../docs/`.
