import type { IntelRegime, IntelServiceRow } from '~~/types/intel'
import type { ScannerCandidate } from '~/utils/scanner'

// =============================================================================
//  useMarketScanner — /markets/scanner reads (roadmap §58.5).
//
//  Consumes the SAME scanner-service snapshots the dashboard shows
//  (`/api/v1/intel`: mover / flow / accum) plus the canonical Instrument Catalog
//  (`/api/v1/instruments`). No second symbol list, no recalculation (D1).
//  Fail-soft to an empty snapshot when the request fails or Mongo is down.
// =============================================================================

export interface ScannerSnapshot {
  mongo: 'up' | 'down'
  generatedAt: string | null
  services: IntelServiceRow[]
  regime: IntelRegime | null
  candidates: ScannerCandidate[]
  /** Catalog size — context for how many scanned symbols are normalized. */
  catalogSize: number
}

const EMPTY: ScannerSnapshot = {
  mongo: 'down',
  generatedAt: null,
  services: [],
  regime: null,
  candidates: [],
  catalogSize: 0
}

export const useMarketScanner = () => {
  const intelApi = useIntel()
  const catalog = useMarketCatalog()

  async function load(): Promise<ScannerSnapshot> {
    try {
      const [intel, instruments] = await Promise.all([
        intelApi.get(),
        catalog.instruments()
      ])
      return {
        mongo: intel.mongo,
        generatedAt: intel.generatedAt,
        services: intel.services,
        regime: intel.regime,
        candidates: mergeScannerCandidates(intel, instruments),
        catalogSize: instruments.length
      }
    } catch {
      return { ...EMPTY }
    }
  }

  return { load }
}
