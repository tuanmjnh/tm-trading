// =============================================================================
//  Which services an embedded (self-hosted) supervisor should start on boot.
//
//  A brand-new supervisor state file carries no operator intent, so nothing would
//  ever start and the control plane would honestly show every service as UNKNOWN.
//  For a single-process self-hosted runtime that is a useless default: the legacy
//  `services:watch` ran this exact set. The rule is deliberately narrow, and it is
//  pure so it can be tested without a running supervisor.
// =============================================================================

/** The shape of a registry entry this rule cares about. */
export interface SupervisableDefinition {
  id: string
  /** `false` = hosted by another process (the market plane, AI workers). */
  supervised?: boolean
  /** `true` = declared target with no code yet. */
  planned?: boolean
  intervalSec?: number | null
  supports?: ReadonlyArray<string>
}

/**
 * Services the embedded supervisor may auto-start.
 *
 * Excluded, each for a reason:
 *  - `supervised: false` — another process owns the lifecycle, and a second copy
 *    would duplicate work;
 *  - `planned: true` — there is no implementation to run;
 *  - no positive interval — an event-driven or on-demand service has no cadence
 *    to drive;
 *  - no `start` capability — the registry says the action is not supported;
 *  - `retention` — it purges rows past their declared retention window, which is
 *    an operator decision, never a side effect of booting a dashboard.
 */
export function desirableServices<T extends SupervisableDefinition>(
  registry: ReadonlyArray<T>,
): T[] {
  return registry.filter(definition =>
    definition.supervised !== false
    && definition.planned !== true
    && definition.id !== 'retention'
    && Number(definition.intervalSec) > 0
    && (definition.supports ?? []).includes('start'))
}
