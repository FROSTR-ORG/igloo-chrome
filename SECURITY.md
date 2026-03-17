# Security Policy

## Reporting a vulnerability
Do not open public issues for security-sensitive problems.

Report suspected vulnerabilities privately to the maintainers through your established internal security/contact channel.
Include:
- affected component or file
- impact summary
- reproduction steps
- any proof-of-concept material
- whether the issue affects released candidates only or mainline development builds as well

## Scope
Security-sensitive areas include:
- provider permission enforcement
- signer/runtime state handling
- profile storage and snapshot persistence
- message routing between content script, background, prompt, and offscreen runtime
- WASM bridge boundaries

Cross-repo architecture context:
- [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [../../docs/policies/observability-and-debugging-guidance.md](../../docs/policies/observability-and-debugging-guidance.md)

## Handling expectations
- Reports should be acknowledged promptly.
- Fixes should be validated with automated tests where practical.
- Public disclosure should wait until a fix or mitigation is available.
