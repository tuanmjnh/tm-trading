import type { MacroCalendarEvent, MacroCalendarResponse } from '#shared/types/macro'

// =============================================================================
//  useMacroCalendar — scheduled macro releases (V3.5 §60.7 / Slice C).
//
//  Reads `/api/v1/calendar`. Every row exposes `projected` and the cadence
//  evidence behind it, so the UI can label a cadence estimate as an estimate.
//  Fail-soft: any failure returns an empty, mongo-down snapshot — the page never
//  invents a schedule (§60.14 graceful degradation).
// =============================================================================

export interface MacroCalendarSnapshot {
  mongo: 'up' | 'down'
  generatedAt: string | null
  total: number
  projected: number
  events: MacroCalendarEvent[]
}

const EMPTY: MacroCalendarSnapshot = {
  mongo: 'down',
  generatedAt: null,
  total: 0,
  projected: 0,
  events: []
}

export const useMacroCalendar = () => {
  async function load(limit = 20, windowDays = 60): Promise<MacroCalendarSnapshot> {
    try {
      const res = await $fetch<MacroCalendarResponse>(`/api/v1/calendar?limit=${limit}`, {
        query: { toMs: Date.now() + windowDays * 86400 * 1000 }
      })
      return {
        mongo: res.meta?.mongo ?? 'down',
        generatedAt: res.meta?.generatedAt ?? null,
        total: res.meta?.total ?? res.events?.length ?? 0,
        projected: res.meta?.projected ?? 0,
        events: res.events ?? []
      }
    } catch {
      return { ...EMPTY }
    }
  }

  return { load }
}
