// types/macro.ts
// Macro release calendar contract (V3.5 §60.7 / §60.12). Mirrors the server's
// allowlisted projection in server/utils/macroCalendar.ts — keep the two in step.

export interface MacroCalendarValue {
  value: number | null
  sourceId: string | null
  vintageAt: string | null
}

export interface MacroCalendarEvent {
  id: string
  seriesId: string
  title: string
  kind: 'macro_release' | 'central_bank' | 'corporate_action' | 'earnings' | 'exchange_notice' | string
  importance: 'high' | 'med' | 'low'
  scheduledAt: string | null
  refPeriod: string
  status: 'scheduled' | 'released' | 'revised' | 'cancelled' | string
  /** true = cadence estimate from observed publication times, not an official schedule. */
  projected: boolean
  projectionMethod: string | null
  projectionCadence: string | null
  projectionSamples: number | null
  projectionConfidence: string | null
  previous: MacroCalendarValue
  /** null = no consensus source is wired (never render it as 0). */
  consensus: number | null
  actual: number | null
  sourceId: string | null
}

export interface MacroCalendarResponse {
  events: MacroCalendarEvent[]
  meta: {
    mongo: 'up' | 'down'
    total: number
    projected: number
    generatedAt: string | null
  }
}
