import type { Dataset, DatasetQuality, LineageEntry, RecordingGroup } from '#shared/types/data'

// =============================================================================
//  useDataCenter — read-only Data Center projections (roadmap §58.9 Slice 4).
//  Dataset != Recording != Quality != Lineage, all sourced from the real
//  recorder persistence (datasets manifest + candles + market_feed), never
//  re-derived engine numbers. Fail-soft: store down returns an empty list.
// =============================================================================

export interface DatasetListOptions {
  kind?: string
  symbol?: string
  source?: string
  timeframe?: string
  q?: string
  limit?: number
}

export const useDataCenter = () => {
  async function datasets(options: DatasetListOptions = {}): Promise<Dataset[]> {
    try {
      const res = await $fetch<{ success: boolean; data: Dataset[] }>('/api/v1/data/datasets', {
        params: {
          kind: options.kind || undefined,
          symbol: options.symbol || undefined,
          source: options.source || undefined,
          timeframe: options.timeframe || undefined,
          q: options.q || undefined,
          limit: options.limit
        }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function quality(options: DatasetListOptions = {}): Promise<DatasetQuality[]> {
    try {
      const res = await $fetch<{ success: boolean; data: DatasetQuality[] }>('/api/v1/data/quality', {
        params: {
          kind: options.kind || undefined,
          symbol: options.symbol || undefined,
          source: options.source || undefined,
          timeframe: options.timeframe || undefined,
          q: options.q || undefined,
          limit: options.limit
        }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function recordings(): Promise<RecordingGroup[]> {
    try {
      const res = await $fetch<{ success: boolean; data: RecordingGroup[] }>('/api/v1/data/recordings')
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function lineage(): Promise<LineageEntry[]> {
    try {
      const res = await $fetch<{ success: boolean; data: LineageEntry[] }>('/api/v1/data/lineage')
      return res.data ?? []
    } catch {
      return []
    }
  }

  return { datasets, quality, recordings, lineage }
}
