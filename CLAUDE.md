# CLAUDE.md

This file provides guidance for working in `igloo-chrome`.

## Project Overview

`igloo-chrome` is the Chrome MV3 signing-device extension for FROSTR.

Architecture:
- `background.ts` is the control plane
- `offscreen.ts` hosts the live signer runtime
- `options.html` is the operator dashboard
- `popup.html` is a quick status surface
- `nostr-provider.ts` and `content-script.ts` expose the website bridge

The extension is intentionally thin:
- signer truth comes from `bifrost-rs`
- background caches signer-owned `runtime_status()`
- UI updates are driven by `drain_runtime_events()` plus explicit refreshes
- provider flows call `prepare_sign()` / `prepare_ecdh()` before crypto work

## Build & Verification Commands

```bash
npm run build:bridge-wasm
npm run build
bunx tsc --noEmit
npm run test:e2e
```

Build with extra runtime diagnostics:

```bash
VITE_IGLOO_VERBOSE=1 npm run build
VITE_IGLOO_DEBUG=1 npm run build
```

## Runtime Boundaries

- `src/background.ts`: extension orchestration, cached status, prompts, runtime control
- `src/offscreen.ts`: live signer runtime host
- `src/lib/igloo.ts`: browser-side wrapper over the WASM signer bridge
- `src/extension/client.ts`: typed UI/control client for background messaging
- `src/lib/store.tsx`: options-page control-plane state only

Do not move signer logic into the React UI or background when `bifrost-rs` can own it.

## Shared UI

Reusable presentational UI comes from the sibling `igloo-ui` package.

What stays in `igloo-chrome`:
- extension-specific page composition
- settings/permissions behavior
- background/offscreen/provider wiring

What should not be reintroduced locally:
- duplicate copies of shared `button`, `card`, `peer-list`, `event-log`, `page-layout`, or onboarding presentation

## Testing

- Browser coverage lives in the top-level infra repo under `../../test/igloo-chrome`
- The Playwright global setup prebuilds:
  - the extension
  - shared `igloo-shell` binaries
- The suite currently runs with `2` workers and is green

Keep new browser-behavior changes aligned with that suite.

## Important Notes

- This is a hard-cut alpha codebase. Do not add compatibility layers for old runtime models or old onboarding flows.
- `runtime.snapshot` is for persistence and diagnostics, not the main readiness contract.
- `Wipe All Data` should keep using signer `wipe_state()` plus extension storage cleanup.
