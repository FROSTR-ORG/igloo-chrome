# Contributing

## Scope
This project is a Chrome MV3 signing-device extension for the FROSTR protocol. Changes should preserve three properties:
- provider correctness
- signer/runtime correctness
- extension lifecycle correctness

## Prerequisites
- Node.js and npm
- `wasm-pack`
- `clang`
- access to the shared Rust signer runtime source, or set `BIFROST_RS_DIR`
- Chromium/Chrome for manual extension checks

## Setup
1. `npm install`
2. `npm run build`

## Development workflow
1. Make the change.
2. Run `npm run test:unit`.
3. Run `npm run build`.
4. Run `npm run test:e2e`.

Workspace-owned entrypoints already enforce browser-WASM freshness:
- `make igloo-chrome-build`
- `make igloo-chrome-dev`
- `make demo-start`
- workspace Playwright prebuild and browser-WASM guard scripts

Repo-local public scripts now do the same through `npm run prepare:workspace` / `npm run prepare:e2e`.
Use `npm run build:browser-wasm` directly only for low-level browser-WASM debugging.

## Design expectations
- Keep the background service worker thin.
- Treat `bifrost-rs` as the source of signer truth.
- Keep extension-facing provider behavior deterministic and well-tested.
- Prefer explicit runtime contracts over implicit storage fallbacks.
- Do not reintroduce legacy format compatibility unless there is a concrete requirement.
- Keep dependencies minimal; avoid convenience packages unless they remove meaningful complexity.

## Code changes
- Prefer small, direct components over generic abstractions.
- New UI should follow existing extension patterns unless there is a strong reason to change them.
- Tests are required for behavioral changes to provider flows, runtime lifecycle, or permissions.

## Pull requests
Include:
- the problem being solved
- the design choice made
- test coverage added or updated
- any manual verification performed
