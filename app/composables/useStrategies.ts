import type { StrategyProfile, StrategyVersion } from '~~/types/strategy'

// =============================================================================
//  useStrategies — read-only strategy library (§30.4, roadmap §58.9 Slice 2).
//  Lists profiles (the pointer that says which immutable version runs live) and
//  the versions of a given strategy. Fail-soft: an unavailable store yields an
//  empty list, never a thrown error in the UI.
// =============================================================================

export const useStrategies = () => {
  async function list(): Promise<StrategyProfile[]> {
    try {
      const res = await $fetch<{ success: boolean; data: StrategyProfile[] }>('/api/v1/strategies')
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function detail(id: string): Promise<StrategyProfile | null> {
    try {
      const res = await $fetch<{ success: boolean; data: StrategyProfile | null }>(
        `/api/v1/strategies/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  async function versions(strategyId: string, limit = 50): Promise<StrategyVersion[]> {
    try {
      const res = await $fetch<{ success: boolean; data: StrategyVersion[] }>(
        `/api/v1/strategies/${encodeURIComponent(strategyId)}/versions`,
        { params: { limit } }
      )
      return res.data ?? []
    } catch {
      return []
    }
  }

  /**
   * Activate a paper-ready version for live paper (§30.4). Unlike the readers
   * above this surfaces failure to the caller (a bad status / down store must
   * be visible in the Test Builder, not silent).
   */
  async function activatePaper(
    profileId: string,
    strategyVersionId: string,
    by: string | null = null
  ): Promise<{ profileId: string; strategyVersionId: string }> {
    const res = await $fetch<{
      success: boolean
      data?: { profileId: string; strategyVersionId: string }
      error?: string
      detail?: string | null
    }>(`/api/v1/strategies/${encodeURIComponent(profileId)}/activate-paper`, {
      method: 'POST',
      body: { strategyVersionId, by }
    })
    if (!res.success || !res.data) throw new Error(res.error || 'activate-failed')
    return res.data
  }

  return { list, detail, versions, activatePaper }
}
