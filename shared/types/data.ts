// =============================================================================
//  Data Center API types (roadmap §58.9 Slice 4, §23.4).
//
//  Dataset != Recording != Quality != Lineage — four distinct views over the
//  SAME real persistence the recorder writes:
//    - Dataset    : the retention manifest row (`datasets`) — one per
//                   kind×source×symbol×timeframe, with measured start/end/count.
//    - Recording  : grouped recorded rows — `candles` for OHLCV bars, or the
//                   `market_feed` ledger for funding/liquidation/... events.
//    - Quality    : coverage/gap/staleness verdict derived from the manifest,
//                   never re-derived from a different source (D12).
//    - Lineage    : which dataset(s) produced which backtest series (D1 stamp:
//                   engineVersion + paramsHash + dataHash).
//
//  The dashboard reads these read-only from /api/v1/data/* (fail-soft: an
//  unavailable store returns an empty list, never a 500).
// =============================================================================

/** Manifest kind: candle datasets plus the feed ledger namespaces. */
export type DatasetKind = 'candles' | string

export type DatasetCompression = 'none' | 'parquet' | 'zst'

/** One `datasets` manifest row (§23.4). */
export interface Dataset {
  _id: string
  datasetId: string
  kind: DatasetKind
  source: string
  symbol: string
  timeframe: string | null
  schemaVersion: string
  retentionDays: number
  compression: DatasetCompression
  /** Null until an offline reconcile (§24) computes one. */
  checksum: string | null
  startTs: number | null
  endTs: number | null
  count: number
  suspect: boolean
  lastReconcileAt: number | null
  createdAt: number | null
  updatedAt: number | null
}

export type QualityVerdict = 'ok' | 'gap' | 'stale' | 'suspect' | 'empty'

/** Coverage/staleness verdict for one dataset row. */
export interface DatasetQuality {
  datasetId: string
  kind: DatasetKind
  source: string
  symbol: string
  timeframe: string | null
  count: number
  expected: number | null
  gaps: number | null
  coveragePct: number | null
  spanMs: number | null
  startTs: number | null
  endTs: number | null
  ageMs: number | null
  stale: boolean
  suspect: boolean
  checksum: string | null
  verdict: QualityVerdict
}

/** Recorded rows for one venue grouping (candles or feed events). */
export interface RecordingGroup {
  plane: 'candles' | 'feed'
  kind: DatasetKind
  symbol: string
  timeframe: string | null
  source: string | null
  count: number
  startTs: number | null
  endTs: number | null
  /** Manifest row that owns this group, when one exists. */
  datasetId: string | null
}

/** One dataset a backtest series resolved its bars from. */
export interface LineageDatasetRef {
  datasetId: string
  kind: DatasetKind
  source: string
  count: number
  startTs: number | null
  endTs: number | null
  suspect: boolean
  /** How the series was linked to this dataset (market-agnostic match). */
  matchedBy: 'symbol+timeframe'
}

/** Backtest series → dataset provenance (§58.9 acceptance: traceable links). */
export interface LineageEntry {
  seriesId: string
  engineVersion: string
  paramsHash: string
  symbol: string
  tf: string
  market: string
  method: string
  preset: string | null
  dataHashCount: number
  dataHashes: string[]
  gitRev: string | null
  lastRunAt: string | null
  runs: number
  datasetIds: string[]
  datasets: LineageDatasetRef[]
}

export interface DatasetsResponse {
  success: boolean
  data: Dataset[]
  meta: { count: number; mongo?: 'up' | 'down' }
}

export interface RecordingsResponse {
  success: boolean
  data: RecordingGroup[]
  meta: { count: number; mongo?: 'up' | 'down' }
}

export interface DatasetQualityResponse {
  success: boolean
  data: DatasetQuality[]
  meta: { count: number; mongo?: 'up' | 'down'; ok?: number; warn?: number }
}

export interface LineageResponse {
  success: boolean
  data: LineageEntry[]
  meta: { count: number; mongo?: 'up' | 'down'; filesMissing?: boolean }
}
