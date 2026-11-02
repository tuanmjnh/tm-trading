// =============================================================================
//  Signal lifecycle (S8 chunk 4) — status states for a stored signal.
//
//  A stored signal is NOT just "received/rejected/forwarded". Once it lands it
//  enters a lifecycle that the dashboard renders:
//
//    ACTIVE        — live, still actionable (default for a fresh signal).
//    EXPIRED       — the signal's horizon passed with no fill; it is dead.
//    INVALIDATED   — the level/price was invalidated (stopped out, rejected
//                    by the risk gate, or contradicted by a newer bar) before
//                    it could be acted on.
//    SUPERSEDED    — a newer signal for the same instrument+side replaced it.
//
//  The original evidence (ts, price, sl, tps, attribution) is IMMUTABLE —
//  only the derived `lifecycleStatus` changes, and only through the dedicated
//  server transitions (see server/utils/signalLifecycle.ts). The webhook rows
//  keep their legacy `status` (received|rejected|forwarded) untouched; the
//  lifecycle is an ADDITIVE overlay computed at read time.
// =============================================================================

/** The four lifecycle states a stored signal can be in. */
export const SIGNAL_LIFECYCLE = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  INVALIDATED: 'invalidated',
  SUPERSEDED: 'superseded'
} as const

export type SignalLifecycleStatus = (typeof SIGNAL_LIFECYCLE)[keyof typeof SIGNAL_LIFECYCLE]

/** Ordered transitions allowed by the lifecycle state machine. */
export const SIGNAL_LIFECYCLE_TRANSITIONS: Record<SignalLifecycleStatus, SignalLifecycleStatus[]> = {
  active: ['expired', 'invalidated', 'superseded'],
  expired: [],
  invalidated: [],
  superseded: []
}

/** True when the status is one of the four lifecycle states. */
export function isSignalLifecycleStatus(v: unknown): v is SignalLifecycleStatus {
  return typeof v === 'string' && (Object.values(SIGNAL_LIFECYCLE) as string[]).includes(v)
}