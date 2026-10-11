import type { IndicatorMeta } from '~~/types/indicators'

// =============================================================================
//  useIndicators — read-only indicator catalog (§30.3, roadmap §58.9 Slice 2).
//  Definitions + math are owned by the engine registry (D1); the dashboard only
//  lists id/version/kind/paramsSchema/warmup/outputs. Fail-soft on the store.
// =============================================================================

export const useIndicators = () => {
  async function list(): Promise<IndicatorMeta[]> {
    try {
      const res = await $fetch<{ success: boolean; data: IndicatorMeta[] }>('/api/v1/indicators')
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function detail(id: string): Promise<IndicatorMeta | null> {
    try {
      const res = await $fetch<{ success: boolean; data: IndicatorMeta | null }>(
        `/api/v1/indicators/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  return { list, detail }
}
