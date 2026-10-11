import type { PipelineStage } from 'mongoose'
import type { Dataset, DatasetQuality, DatasetKind, LineageDatasetRef, LineageEntry, QualityVerdict, RecordingGroup } from '../../types/data'
import type { RunSeriesDetail } from '../../types/runs'
import { candleModel, datasetModel, marketFeedModel } from './engineModel'
import { loadRunSeries } from './reports'

// =============================================================================
//  DATA CENTER READ MODEL (roadmap §58.9 Slice 4, §23.4).
//
//  Read-only projections over the SAME persistence the recorder writes:
//    - datasets manifest     -> Dataset / Quality / Lineage
//    - candles / market_feed -> Recordings
//  We never recompute engine numbers here (D1); coverage is derived from the
//  manifest's measured start/end/count (D12), never guessed.
//
//  Every DB touch is fail-soft: a store outage yields empty data + mongo:'down'
//  (never a 500). The pure transforms below are exported so they can be tested
//  offline with injected rows.
// =============================================================================

type AnyModel = typeof import('mongoose').Model<any>

/** Mirrors engine/data.mjs TF_MS — the timeframe grid the recorder writes. */
export const TF_MS: Record<string, number> = {
  '1': 60_000, '3': 180_000, '4': 240_000, '5': 300_000, '10': 600_000, '15': 900_000,
  '30': 1_800_000, '60': 3_600_000, '120': 7_200_000, '240': 14_400_000, '360': 21_600_000,
  '720': 43_200_000, 'D': 86_400_000
}

const DAY_MS = 86_400_000

export function tfToMs(tf: string | null | undefined): number | null {
  if (tf == null) return null
  return TF_MS[String(tf)] ?? null
}

/** Natural dataset key — mirrors market/recorder.mjs `datasetIdFor`. */
export function datasetIdFor(kind: string, source: string, symbol: string, timeframe: string | null): string {
  return `${kind}:${source}:${symbol}:${timeframe}`
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// -----------------------------------------------------------------------------
//  Quality (pure)
// -----------------------------------------------------------------------------

export interface QualityOptions {
  now?: number
  /** Override the staleness threshold; defaults to max(3×tf, 1 day). */
  staleAfterMs?: number
}

function clampPct(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10
}

/** One manifest row -> a coverage/gap/staleness verdict (pure, D12). */
export function datasetQuality(row: Dataset, opts: QualityOptions = {}): DatasetQuality {
  const now = opts.now ?? Date.now()
  const count = Number(row.count ?? 0)
  const startTs = row.startTs ?? null
  const endTs = row.endTs ?? null
  const tfMs = tfToMs(row.timeframe)
  const hasSpan = startTs != null && endTs != null && endTs >= startTs
  const spanMs = hasSpan ? (endTs as number) - (startTs as number) : null

  // endTs is the CLOSE time of the last bar (recorder uses max closeTime), so a
  // contiguous run of N bars spans ~N×tf ms. `round` absorbs the ⌈-1ms⌉ that
  // Binance close times carry (closeTime = openTime + tf - 1) without an
  // off-by-one on either convention.
  const expected = tfMs && hasSpan ? Math.max(1, Math.round((spanMs as number) / tfMs)) : null
  const gaps = expected != null ? Math.max(0, expected - count) : null
  const coveragePct = expected != null && expected > 0 ? clampPct((count / expected) * 100) : null

  const ageMs = endTs != null ? Math.max(0, now - endTs) : null
  const staleAfterMs = opts.staleAfterMs ?? (tfMs ? Math.max(tfMs * 3, DAY_MS) : DAY_MS * 3)
  const stale = ageMs != null && ageMs > staleAfterMs

  let verdict: QualityVerdict = 'ok'
  if (count === 0) verdict = 'empty'
  else if (row.suspect) verdict = 'suspect'
  else if (gaps != null && gaps > 0) verdict = 'gap'
  else if (stale) verdict = 'stale'

  return {
    datasetId: row.datasetId,
    kind: row.kind,
    source: row.source,
    symbol: row.symbol,
    timeframe: row.timeframe,
    count,
    expected,
    gaps,
    coveragePct,
    spanMs,
    startTs,
    endTs,
    ageMs,
    stale,
    suspect: !!row.suspect,
    checksum: row.checksum ?? null,
    verdict
  }
}

export function summarizeQuality(rows: Dataset[], opts: QualityOptions = {}): DatasetQuality[] {
  return rows.map(r => datasetQuality(r, opts)).sort((a, b) => {
    // Warnings first (worst gaps first), clean datasets sink to the bottom.
    const rank = (v: QualityVerdict) => (v === 'ok' ? 1 : 0)
    const d = rank(a.verdict) - rank(b.verdict)
    return d !== 0 ? d : (b.gaps ?? -1) - (a.gaps ?? -1)
  })
}

export function qualityCounts(list: DatasetQuality[]): { ok: number, warn: number } {
  let ok = 0
  let warn = 0
  for (const q of list) (q.verdict === 'ok' ? ok++ : warn++)
  return { ok, warn }
}

// -----------------------------------------------------------------------------
//  Recording grouping (pure)
// -----------------------------------------------------------------------------

export interface RawCandleGroup {
  _id: { symbol?: string, timeframe?: string, source?: string }
  count?: number
  startTs?: number
  endTs?: number
}

export interface RawFeedGroup {
  _id: { kind?: string, symbol?: string }
  count?: number
  startTs?: number
  endTs?: number
}

export const CANDLE_GROUP_PIPELINE: PipelineStage[] = [
  { $group: { _id: { symbol: '$symbol', timeframe: '$timeframe', source: '$source' }, count: { $sum: 1 }, startTs: { $min: '$openTime' }, endTs: { $max: '$closeTime' } } },
  { $sort: { count: -1 } },
  { $limit: 500 }
]

export const FEED_GROUP_PIPELINE: PipelineStage[] = [
  { $group: { _id: { kind: '$kind', symbol: '$symbol' }, count: { $sum: 1 }, startTs: { $min: '$eventTime' }, endTs: { $max: '$eventTime' } } },
  { $sort: { count: -1 } },
  { $limit: 500 }
]

export function mapCandleGroups(docs: RawCandleGroup[]): RecordingGroup[] {
  return docs.map(d => {
    const symbol = String(d._id?.symbol ?? '')
    const timeframe = d._id?.timeframe != null ? String(d._id.timeframe) : null
    const source = d._id?.source != null ? String(d._id.source) : null
    return {
      plane: 'candles' as const,
      kind: 'candles' as const,
      symbol,
      timeframe,
      source,
      count: Number(d.count ?? 0),
      startTs: d.startTs ?? null,
      endTs: d.endTs ?? null,
      datasetId: source ? datasetIdFor('candles', source, symbol, timeframe) : null
    }
  })
}

export function mapFeedGroups(docs: RawFeedGroup[]): RecordingGroup[] {
  return docs.map(d => {
    const kind = String(d._id?.kind ?? '')
    const symbol = String(d._id?.symbol ?? '')
    return {
      plane: 'feed' as const,
      kind,
      symbol,
      timeframe: null,
      source: null,
      count: Number(d.count ?? 0),
      startTs: d.startTs ?? null,
      endTs: d.endTs ?? null,
      datasetId: datasetIdFor(kind, 'feed', symbol, null)
    }
  })
}

// -----------------------------------------------------------------------------
//  Lineage (pure): backtest series -> candle dataset(s) (D1 traceability)
// -----------------------------------------------------------------------------

export function buildLineage(series: RunSeriesDetail[], datasets: Dataset[]): LineageEntry[] {
  const candleDatasets = datasets.filter(d => d.kind === 'candles')
  const lower = (s: unknown) => String(s ?? '').toLowerCase()

  const entries = series.map((s): LineageEntry => {
    const mkt = lower(s.market)
    let cands = candleDatasets.filter(d =>
      lower(d.symbol) === lower(s.symbol) && String(d.timeframe) === String(s.tf))
    if (mkt) {
      const marketMatched = cands.filter(d => lower(d.source).includes(mkt))
      if (marketMatched.length) cands = marketMatched
    }
    const refs: LineageDatasetRef[] = cands
      .map((d): LineageDatasetRef => ({
        datasetId: d.datasetId,
        kind: d.kind,
        source: d.source,
        count: Number(d.count ?? 0),
        startTs: d.startTs ?? null,
        endTs: d.endTs ?? null,
        suspect: !!d.suspect,
        matchedBy: 'symbol+timeframe'
      }))
      .sort((a, b) => b.count - a.count)

    return {
      seriesId: s.id,
      engineVersion: s.engineVersion,
      paramsHash: s.paramsHash,
      symbol: s.symbol,
      tf: s.tf,
      market: s.market,
      method: s.method,
      preset: s.preset ?? null,
      dataHashCount: s.dataHashCount,
      dataHashes: s.dataHashes ?? [],
      gitRev: s.gitRev ?? null,
      lastRunAt: s.lastRunAt ?? null,
      runs: s.summary?.runs ?? 1,
      datasetIds: refs.map(r => r.datasetId),
      datasets: refs
    }
  })

  const at = (s: string | null) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0 }
  return entries.sort((a, b) => at(b.lastRunAt) - at(a.lastRunAt))
}

// -----------------------------------------------------------------------------
//  DB-backed readers (fail-soft, injectable for tests)
// -----------------------------------------------------------------------------

export interface DatasetQuery {
  kind?: string
  symbol?: string
  source?: string
  timeframe?: string
  q?: string
  limit?: number
}

export interface DataCenterDeps {
  loadDatasetRows?: (q: DatasetQuery) => Promise<{ rows: Dataset[], mongo: 'up' | 'down' }>
  aggregateCandleGroups?: () => Promise<RawCandleGroup[] | null>
  aggregateFeedGroups?: () => Promise<RawFeedGroup[] | null>
  loadSeries?: () => Promise<{ series: RunSeriesDetail[], filesMissing: boolean }>
}

async function loadDatasetRows(q: DatasetQuery): Promise<{ rows: Dataset[], mongo: 'up' | 'down' }> {
  const Dataset = await datasetModel()
  if (!Dataset) return { rows: [], mongo: 'down' }
  const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 1000)
  const filter: Record<string, unknown> = {}
  if (q.kind) filter.kind = q.kind
  if (q.source) filter.source = q.source
  if (q.timeframe) filter.timeframe = q.timeframe
  if (q.symbol) filter.symbol = { $regex: `^${escapeRegex(q.symbol)}`, $options: 'i' }
  try {
    let rows = (await (Dataset as AnyModel).find(filter).sort({ updatedAt: -1, count: -1 }).limit(limit).lean()) as unknown as Dataset[]
    const text = q.q ? String(q.q).trim().toLowerCase() : ''
    if (text) {
      rows = rows.filter(r =>
        String(r.datasetId ?? '').toLowerCase().includes(text)
        || String(r.symbol ?? '').toLowerCase().includes(text)
        || String(r.source ?? '').toLowerCase().includes(text))
    }
    return { rows, mongo: 'up' }
  } catch {
    return { rows: [], mongo: 'down' }
  }
}

async function aggregateCandleGroups(): Promise<RawCandleGroup[] | null> {
  const Candle = await candleModel()
  if (!Candle) return null
  try {
    return (await (Candle as AnyModel).aggregate(CANDLE_GROUP_PIPELINE)) as RawCandleGroup[]
  } catch {
    return null
  }
}

async function aggregateFeedGroups(): Promise<RawFeedGroup[] | null> {
  const MarketFeed = await marketFeedModel()
  if (!MarketFeed) return null
  try {
    return (await (MarketFeed as AnyModel).aggregate(FEED_GROUP_PIPELINE)) as RawFeedGroup[]
  } catch {
    return null
  }
}

async function loadSeriesRows(): Promise<{ series: RunSeriesDetail[], filesMissing: boolean }> {
  const res = await loadRunSeries()
  return { series: res.series, filesMissing: res.filesMissing }
}

export async function listDatasets(q: DatasetQuery = {}, deps?: DataCenterDeps): Promise<{ data: Dataset[], mongo: 'up' | 'down' }> {
  const { rows, mongo } = await (deps?.loadDatasetRows ?? loadDatasetRows)(q)
  return { data: rows, mongo }
}

export async function listDatasetQuality(q: DatasetQuery = {}, deps?: DataCenterDeps, opts: QualityOptions = {}): Promise<{ data: DatasetQuality[], mongo: 'up' | 'down' }> {
  const { rows, mongo } = await (deps?.loadDatasetRows ?? loadDatasetRows)(q)
  return { data: summarizeQuality(rows, opts), mongo }
}

export async function listRecordings(deps?: DataCenterDeps): Promise<{ data: RecordingGroup[], mongo: 'up' | 'down' }> {
  const [candles, feeds] = await Promise.all([
    (deps?.aggregateCandleGroups ?? aggregateCandleGroups)(),
    (deps?.aggregateFeedGroups ?? aggregateFeedGroups)()
  ])
  const mongo: 'up' | 'down' = candles === null && feeds === null ? 'down' : 'up'
  const data = [...mapCandleGroups(candles ?? []), ...mapFeedGroups(feeds ?? [])]
    .sort((a, b) => b.count - a.count)
  return { data, mongo }
}

export async function listLineage(deps?: DataCenterDeps): Promise<{ data: LineageEntry[], mongo: 'up' | 'down', filesMissing: boolean }> {
  const [{ rows, mongo }, seriesRes] = await Promise.all([
    (deps?.loadDatasetRows ?? loadDatasetRows)({ limit: 1000 }),
    (deps?.loadSeries ?? loadSeriesRows)()
  ])
  return { data: buildLineage(seriesRes.series, rows), mongo, filesMissing: seriesRes.filesMissing }
}

export type { Dataset, DatasetKind }
