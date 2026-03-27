# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, adapted for this repository.

## [0.2.0] - 2026-03-08

### Added
- Structured JSON observability across background, offscreen, and Playwright live/runtime harnesses.
- Failure-only `observability-bundle.json` artifacts for easier E2E triage.
- Docker-backed demo-harness coverage using the infra-owned `dev-relay` and `igloo-demo` services.
- Shared nonce-readiness assertions across the live, lifecycle, and demo E2E suites.

### Changed
- Onboarding is now hard-cut to encrypted, password-required `bfonboard1...` packages.
- Successful onboarding consumes the package immediately, persists runtime metadata and snapshots, and no longer stores the onboarding package for recovery.
- Offscreen restore now uses persisted runtime snapshots as the canonical recovery path.
- The bridge WASM build script now resolves the current workspace layout by default.
- Repo-local Playwright ownership moved to the surrounding workspace test harness.

### Fixed
- Runtime restore no longer loses nonce-ready state needed for post-onboarding signing.
- Provider signing now selects a nonce-ready peer subset instead of failing on raw peer ordering.
- Diagnostics output and runtime lifecycle reporting are now consistent across background, offscreen, and test harness consumers.

## [0.1.0] - 2026-03-07

### Added
- Chrome MV3 extension scaffold with background service worker, offscreen runtime document, options page, popup, permission prompt, content script, and injected provider bridge.
- Real `bifrost-rs` WASM integration for `getPublicKey()`, `signEvent`, `nip44.encrypt`, and `nip44.decrypt`.
- Runtime persistence and restore across offscreen teardown and browser-context relaunch.
- Playwright extension harness with smoke, live-provider, and lifecycle coverage.
- Project docs for contributing, testing, security reporting, and release operations.
- Release packaging flow for browser-loadable test candidates.

### Changed
- `getPublicKey()` now returns the group public key or fails; it no longer falls back to a share public key.
- Options page now follows the extension dashboard model with runtime, permissions, and settings views.
- Runtime diagnostics now expose nonce-pool and lifecycle state.
- Build system is extension-native and no longer depends on Vite.
- TypeScript configuration is simplified to a single project config.
- Runtime and dev dependency footprint is significantly reduced.

### Fixed
- Initial onboarding nonce hydration is preserved for runtime bootstrap.
- WASM loading now works reliably under MV3 CSP.
- Offscreen runtime restore prevents cold-start signing regressions after teardown.
