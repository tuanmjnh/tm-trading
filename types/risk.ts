// =============================================================================
//  Trang thai risk gate cho dashboard (roadmap Phase 7).
//
//  Nguon: engine `risk_state` (mot ban ghi / account / ngay UTC — D2) +
//  `positions` (so lenh dang mo). Dashboard chi DOC, khong tinh lai (D1).
//
//  Ghi la do `exec/risk.mjs` (Phase 6) — khi chua chay, collection rong va
//  API van tra 200 + mongo='up'/'down' (fail-soft, khong 500).
// =============================================================================

/** Mot ban ghi risk_state — theo ngay UTC cua MOT account. */
export interface RiskAccountDay {
  account: string
  /** YYYY-MM-DD UTC (D2). */
  utcDay: string
  /** Kill-switch (D7c): true = chan mo lenh moi. */
  halted: boolean
  haltReason: string
  haltedAt: string | null
  realizedPnlAbs: number
  realizedPnlPct: number
  tradesOpened: number
  tradesClosed: number
  consecutiveLosses: number
}

/** Kết quả check D8 gần nhất — đọc từ audit `drift_report` trong logs/risk.ndjson. */
export interface DriftStatus {
  /** ISO time của lần check gần nhất. */
  lastCheckAt: string
  /** true = vượt ngưỡng (đã halt, chờ resume tay). */
  breach: boolean
  windowH: number
  /** Số cặp so sánh được (loại skipped). */
  checked: number
  /** Số cặp có tv ≠ engine (dấu hiệu lệch; breach do ngưỡng quyết định). */
  diverged: number
}

export interface RiskStatusData {
  /** Ngay hinh tai (UTC YYYY-MM-DD) — mốc doc risk_state. */
  day: string
  /** Ban ghi cua `day`; rong = chua co ghi nhan. Neu `day` khong co ma ban ghi
   *  gan nhat dang halted thi se keu ban ghi do (kill-switch la ban vung). */
  accounts: RiskAccountDay[]
  openPositions: number
  /** 'up' = Mongo san sang; 'down' = khong ket noi duoc (fail-soft). */
  mongo: 'up' | 'down'
  /** Check D8 gan nhat; null = chua chay (fail-soft doc file). */
  drift: DriftStatus | null
}

export interface RiskStatusResponse {
  success: boolean
  data: RiskStatusData
}
