// =============================================================================
//  Market intelligence cho dashboard (roadmap Phase 8) + heartbeat D9.
//
//  Nguồn: collection `intel` (services ghi — snapshot mover/flow/accum/funding
//  + event news) và file logs/services.json (heartbeat, một nguồn evaluate
//  với services/heartbeat.mjs). Dashboard chỉ ĐỌC, không tính lại (D1).
//
//  Chưa chạy services / Mongo down -> mảng rong + mongo='down' (fail-soft).
// =============================================================================

/** Top biến động 24h (snapshot `mover`). */
export interface IntelMover {
  symbol: string
  pct24h: number
  chg4h: number
  quoteVolume: number
  lastPrice: number
  breakout: boolean
  atrPct: number
}

/** Dòng tiền (snapshot `flow`). */
export interface IntelFlow {
  symbol: string
  dir: 'buy' | 'sell' | 'mixed' | 'vol'
  reasons: string[]
  volRatio: number
  takerRatio: number
  cmf: number
  pct24h: number
  score: number
}

/** Gom hàng / sideway (snapshot `accum`). */
export interface IntelAccum {
  symbol: string
  reasons: string[]
  rangePct: number
  priceChg48: number
  obvNorm: number
  volRatio: number
  pct24h: number
}

/** Funding rate (snapshot `funding`). */
export interface IntelFunding {
  symbol: string
  rate: number
  pct: number
  nextFundingTime: number
  price: number
  oiContracts: number | null
  oiNotionalUsd: number | null
}

/** Tin tức đã score (event `news`). */
export interface IntelNewsItem {
  title: string
  link: string
  source: string
  level: 'high' | 'med'
  dir: 'pos' | 'neg' | 'flat'
  tags: string[]
  score: number
  ts: string
  excerpt: string
}

/** 1 dòng filter alt-lướt (data.sweep của snapshot `regime`) — Phase 9. */
export interface IntelSweepRow {
  symbol: string
  ok: boolean
  reasons: string[]
  blockers: string[]
  rate: number | null
  oiTrendPct: number | null
}

/** Kết luận thị trường (snapshot `regime`, 1 doc) — Phase 9. */
export interface IntelRegime {
  season: 'alt' | 'btc' | 'neutral'
  asi: { d30: number | null; d90: number | null; d365: number | null } | null
  fng: { value: number; classification: string; avg30: number | null } | null
  btcDom: number | null
  ethDom: number | null
  mcapChg24h: number | null
  flags: string[]
  unlocks48h: { symbol: string; date: string; label: string }[]
  supplyDrift: { symbol: string; circulating: number; driftPctPerDay: number | null }[]
  sweep: IntelSweepRow[]
  sources: Record<string, string>
  ts: string
}

/** Zone thanh lý 1 symbol (snapshot `zone`) — Phase 9. */
export interface IntelZone {
  symbol: string
  markPx: number
  oiUsd: number | null
  /** Long/short account ratio 5m (ngữ cảnh bias) — null nếu nguồn lỗi. */
  lsRatio: number | null
  /** Ước tính gia mô (bands đòn bẩy) — KHÔNG phải số thật. */
  est: { lev: number; side: 'long' | 'short'; price: number; pct: number; usd: number }[]
  /** Thanh lý thật đã gom cụm từ forceOrder (trống nếu WS chưa có event). */
  actual: { side: 'long' | 'short'; price: number; usd: number; n: number }[]
  ts: string
}

/** 1 service trong heartbeat D9 — evaluate từ services/heartbeat.mjs. */
export interface IntelServiceRow {
  name: string
  intervalSec: number
  overdueSec: number
  /** true = quá hạn 2 × chu kỳ (service chết / chưa chạy đủ). */
  overdue: boolean
  lastRunAt: string | null
  lastOkAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  count: number
}

/** Diem gop 1 symbol (snapshot `confluence`) — Phase 10. */
export interface IntelConfluence {
  symbol: string
  /** Tong [-1,1] — 4 phan da trong data.parts; dashboard chi format (D1). */
  score: number
  /** 4 phan diem goc [-1,1] — method (0.4) / regime (0.2) / funding (0.2) / zone (0.2). */
  parts: { method: number; regime: number; funding: number; zone: number }
  rank: number
  tf: string
  bars: number
  /** Nguon chon symbol: 'env' | 'mover' | 'fallback'. */
  src: string
  ts: string
}

export interface IntelData {
  /** 'up' = Mongo san sang; 'down' = khong ket noi duoc (fail-soft). */
  mongo: 'up' | 'down'
  /** ISO time cua snapshot moi nhat; null = chua co du lieu. */
  generatedAt: string | null
  movers: IntelMover[]
  flows: IntelFlow[]
  accums: IntelAccum[]
  funding: IntelFunding[]
  news: IntelNewsItem[]
  /** Regime hien tai — null khi Mongo down/chua chay services (Phase 9). */
  regime: IntelRegime | null
  /** Zone thanh ly — rong khi chua co du lieu (Phase 9). */
  zones: IntelZone[]
  /** Diem gop hang ngay — rong khi chua chay service confluence (Phase 10). */
  confluence: IntelConfluence[]
  services: IntelServiceRow[]
}

export interface IntelResponse {
  success: boolean
  data: IntelData
}
