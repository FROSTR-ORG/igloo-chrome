# Release Process

## Goal
Produce a deterministic browser-loadable extension candidate from the current repository state.

## Prerequisites
- clean working tree or intentionally reviewed release changes
- `npm install`
- `wasm-pack`
- `clang`
- access to the shared Rust signer runtime source, or `BIFROST_RS_DIR` set correctly

## Pre-release checks
1. `npm run test:unit`
2. `npm run build`
3. `npm run test:e2e`

The current E2E release path uses infra-owned global setup to prebuild:
- the unpacked extension
- required shared runtime test binaries

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

For public release candidates, prefer:

```bash
npm run release:candidate
```

That path runs the release-mode build before packaging. Release-mode output
removes debug command handlers and local relay CSP entries, then
`check:production-package` verifies that `dist/manifest.json` contains no
`localhost` / `127.0.0.1` CSP entries and `dist/background.js` contains no
`ext.debug.*` command strings. The default dev/test build keeps those seams so
the workspace harness and manual local relays continue to work.

The packaging step creates:
- a browser-loadable unpacked candidate directory
- a SHA-256 checksum file
- a zip archive when the local `zip` command is available

## Host permissions

The manifest requests broad `http`/`https` content-script coverage because the
extension exposes the Nostr provider bridge on arbitrary sites that ask the user
to sign. It also allows `ws`/`wss` relay hosts because relay endpoints are
profile-configured rather than fixed by the extension. Narrowing this posture
would require a separate provider/permission architecture change; document the
rationale in the Web Store listing when submitting a public beta candidate.

## Manual release verification
Before handing off a candidate, verify:
- onboarding completes
- popup opens and reports status
- `window.nostr.getPublicKey()` succeeds
- `window.nostr.signEvent()` succeeds against a live responder
- `window.nostr.nip44.encrypt/decrypt()` succeed against a live responder
- permissions can be reviewed and revoked
- runtime restores cleanly after service-worker teardown and relaunch scenarios
- status and peer views reflect signer-owned runtime state rather than extension-derived heuristics

## Candidate handoff
Provide:
- version number
- candidate path under `artifacts/`
- checksum file path
- summary of verification run
- notable known risks, if any
