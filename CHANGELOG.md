# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, adapted for this repository.

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
