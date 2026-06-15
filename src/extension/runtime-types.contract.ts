/**
 * Compile-time wire-type drift guard. NOT runtime code — this file is never
 * imported by an entry point, so it is not bundled; it exists only so
 * `tsc --noEmit` (typecheck:local, run in CI) FAILS when the canonical
 * igloo-shared runtime wire shapes gain a field that a downstream mirror does
 * not follow:
 *   - igloo-chrome's local `RuntimeStatusSummary` mirror (./runtime-types), and
 *   - igloo-ui's adapter input types — igloo-ui is deliberately decoupled from
 *     igloo-shared (it has no igloo-shared dependency, by design), so the
 *     cross-package check lives here, the one place that depends on both.
 *
 * Only KEY COVERAGE is asserted, not value-type equality: the mirrors
 * intentionally loosen some field types (e.g. igloo-ui's `code: string`) and
 * intentionally diverge on / omit others (chrome's camelCase `StoredPeerPolicy`,
 * the omitted `onboarding_statuses`). Those intentional skips are spelled out as
 * `Omit<...>` below — so adding a NEW igloo-shared field forces a conscious
 * choice (mirror it, or add it to the Omit) rather than drifting silently.
 */
import type {
  RuntimeStatusSummary as WireStatusSummary,
  RuntimePeerStatus as WirePeerStatus,
  RuntimeOperationFailure as WireOperationFailure,
  RuntimePendingApproval as WirePendingApproval,
} from 'igloo-shared';
import type {
  RuntimeStatusSummaryInput,
  RuntimePeerStatusInput,
  RuntimeOperationFailureInput,
  RuntimePendingApprovalInput,
} from 'igloo-ui';
import type { RuntimeStatusSummary as ChromeStatusSummary } from './runtime-types';

// Every key of Wire must be a key of Mirror; otherwise this resolves to a tuple
// that names the missing key(s), failing the `= true` assignment below.
type KeysCovered<Wire, Mirror> = keyof Wire extends keyof Mirror
  ? true
  : ['igloo-shared wire field not mirrored:', Exclude<keyof Wire, keyof Mirror>];

// igloo-ui adapter inputs mirror every canonical wire field the adapter reads.
// (igloo-ui intentionally ignores `onboarding_statuses`.)
const _uiSummary: KeysCovered<Omit<WireStatusSummary, 'onboarding_statuses'>, RuntimeStatusSummaryInput> = true;
const _uiPeer: KeysCovered<WirePeerStatus, RuntimePeerStatusInput> = true;
const _uiFailure: KeysCovered<WireOperationFailure, RuntimeOperationFailureInput> = true;
const _uiApproval: KeysCovered<WirePendingApproval, RuntimePendingApprovalInput> = true;

// chrome's local summary mirror covers the wire fields, minus the two it
// intentionally diverges on / omits (camelCase peer_permission_states via
// StoredPeerPolicy; onboarding_statuses is unused in the extension UI).
const _chromeSummary: KeysCovered<
  Omit<WireStatusSummary, 'peer_permission_states' | 'onboarding_statuses'>,
  ChromeStatusSummary
> = true;

// Reference the assertions so they are not flagged as unused locals.
void _uiSummary;
void _uiPeer;
void _uiFailure;
void _uiApproval;
void _chromeSummary;
