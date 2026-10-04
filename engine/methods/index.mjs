#!/usr/bin/env node
// =============================================================================
//  TM TRADING - METHOD PLUGIN INTERFACE
//  (roadmap Phase 4: khoa "tach VSA thanh plugin method 0" -> Phase 10 dung lai)
//
//  VI SAO CHOT TRUOC TU PHASE 4: neu de den Phase 10 moi tach, `backtest.mjs`
//  se gan khung vao VSA cu the (signalMode, levels, ...), va khi them method
//  PA/SMC/... phai boc lai toan bo. Day la LOI TRINH TU, khong phai viec them.
//  Nen backtest phai DUONG VAO interface nay voi DUNG MOT implementation.
//
//  CAC THANG KHONG DUOC TROI VAO PLUGIN (chung thuoc ve backtest, khong thuoc
//  ve "phuong phap phan tich"):
//   - phi (feePct) + slippage + compound        -> backtest.mjs
//   - equity curve, drawdown, PF/WR/net%        -> report.mjs
//   - version stamp (paramsHash/dataHash)       -> version.mjs + store.mjs
//   - lay du lieu / resample 1m -> 4m/10m       -> data.mjs
//
//  Interface (duong ghi ro trong roadmap Phase 10):
//      in : analyze(bars, opts) -> { events, scores, ... }
//      out: setups[] = { bar, dir, entry, sl, tp, ... }
// =============================================================================

/** Tang cua interface. Doi shape = tang so nay -> plugin cu phai biet truoc. */
export const INTERFACE_VERSION = 1

/**
 * Mo ta hop dong de doc duoc bang mat (va de test docla khong can doc code).
 *
 * `analyze` PHAI tro ve du 3 truong sau; con lai (series/flags/params/...) la
 * phuong phap rieng, backtest KHONG phep dua vao chung.
 */
export const METHOD_CONTRACT = Object.freeze({
  /** Truong bat buoc tren object plugin. */
  required: ['id', 'name', 'defaults', 'analyze'],
  /** Truong bat buoc tren ket qua cua analyze(). */
  analyzeReturns: ['events', 'scores', 'setups'],
  /**
   * events[i]  : { bar, type }      - su kien da dich nghia, theo thu tu xay ra
   * scores[i]  : number in [-1, 1]  - diem huong cua method TAI bar do (0 = khong co su kien)
   * setups[i]  : { bar, dir, entry, sl, tp, ... } - ke hoach lenh (dir = 1 LONG | -1 SHORT)
   */
  scoreRange: [-1, 1],
  directions: [1, -1],
})

const REGISTRY = new Map()

/**
 * Kiem tra plugin co dung hop dong khong. KHONG chay analyze() o day: day la
 * kiem tra tinh trang (static), con "co chay ra ket qua dung shape khong" thuoc
 * ve test suite - neu chay o day se an loi di sau import.
 *
 * @returns {string[]} danh sach loi; rong = hop le
 */
export function validateMethod(m) {
  const errs = []
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['method khong phai object']

  for (const k of METHOD_CONTRACT.required) {
    if (m[k] === undefined) errs.push(`thieu truong "${k}"`)
  }
  if (errs.length) return errs // thieu co ban thi khong tiep tuc cham cham

  if (typeof m.id !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(m.id)) {
    errs.push(`id phai la chuoi keu-duong 2-32 ky tu [a-z0-9-] (nhan ${JSON.stringify(m.id)})`)
  }
  if (typeof m.name !== 'string' || m.name.trim() === '') errs.push('name phai la chuoi khong rong')
  if (typeof m.defaults !== 'object' || m.defaults === null || Array.isArray(m.defaults)) {
    errs.push('defaults phai la object (day la bo tham so ma version.mjs hash)')
  }
  if (typeof m.analyze !== 'function') errs.push('analyze phai la function')

  return errs
}

/**
 * Dang ky method. Idempotent theo id: import lai (HMR, test chay 2 lan) van
 * binh thuong, nhung id trung voi plugin KHAC thi loi - khong duoc lam cham
 * mot method bang method khac.
 */
export function registerMethod(m) {
  const errs = validateMethod(m)
  if (errs.length) {
    throw new Error(`method khong dung hop dong (INTERFACE_VERSION=${INTERFACE_VERSION}):\n  - ${errs.join('\n  - ')}`)
  }
  const existed = REGISTRY.get(m.id)
  if (existed && existed !== m) {
    throw new Error(`method id "${m.id}" da duoc dang ky boi plugin khac`)
  }
  REGISTRY.set(m.id, m)
  return m
}

/** Lay method theo id. Khong co -> NEM LOI (khong duoc im lang chay method mac dinh). */
export function getMethod(id) {
  const m = REGISTRY.get(id)
  if (!m) {
    const known = [...REGISTRY.keys()].sort().join(', ') || '(chua co method nao)'
    throw new Error(`khong co method "${id}". Da dang ky: ${known}`)
  }
  return m
}

export function listMethods() {
  return [...REGISTRY.keys()].sort()
}

/** Xoa het (dung cho test). Khong xoa plugin da import - chi xoa dang ky. */
export function _resetRegistryForTest() {
  REGISTRY.clear()
}
