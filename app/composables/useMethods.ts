import type { MethodEvent, MethodLeague, MethodMeta } from '~~/types/methods'

// =============================================================================
//  useMethods — method events + league for the trade terminal (Phase 10 UI).
//
//  Reads the read-only /api/v1/methods and /api/v1/methods/events endpoints.
//  The dashboard never reimplements a strategy: events are computed by the
//  engine method plugins on bars the chart already serves (D1). The league is
//  a daily snapshot file. Toggling a method on/off refreshes the event set;
//  symbol/timeframe changes recompute for the new window.
// =============================================================================

export function useMethods(symbol: Ref<string>, timeframe: Ref<string>) {
  const methods = ref<MethodMeta[]>([])
  const league = ref<MethodLeague | null>(null)
  const enabled = ref<string[]>([])
  const events = ref<MethodEvent[]>([])
  const loading = ref(false)
  const error = ref('')
  let abort: AbortController | null = null

  const loadMeta = async (): Promise<void> => {
    try {
      const res = await $fetch<{ success: boolean; data: { methods: MethodMeta[]; league: MethodLeague | null } }>('/api/v1/methods')
      methods.value = res.data?.methods ?? []
      league.value = res.data?.league ?? null
    } catch {
      // fail-soft — the panel renders with no registry, no crash
    }
  }

  const refresh = async (): Promise<void> => {
    abort?.abort()
    if (!enabled.value.length) {
      events.value = []
      error.value = ''
      return
    }
    const ctrl = new AbortController()
    abort = ctrl
    loading.value = true
    error.value = ''
    try {
      const res = await $fetch<{ success: boolean; data: { events: MethodEvent[] } }>('/api/v1/methods/events', {
        params: {
          symbol: symbol.value,
          interval: timeframe.value,
          methods: enabled.value.join(',')
        },
        signal: ctrl.signal
      })
      events.value = res.data?.events ?? []
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') error.value = 'methods-request-failed'
    } finally {
      if (abort === ctrl) {
        loading.value = false
        abort = null
      }
    }
  }

  const toggle = (id: string): void => {
    const idx = enabled.value.indexOf(id)
    if (idx >= 0) enabled.value.splice(idx, 1)
    else enabled.value.push(id)
    void refresh()
  }

  watch([symbol, timeframe], () => {
    void refresh()
  })

  onMounted(() => {
    void loadMeta()
  })

  return {
    methods,
    league,
    enabled,
    events,
    loading,
    error,
    toggle,
    refresh,
    loadMeta
  }
}