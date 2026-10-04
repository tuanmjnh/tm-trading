#!/usr/bin/env node
// =============================================================================
//  TM TRADING - VERSION / DANH TINH CUA MOT RUN  (roadmap D1, Phase 3)
//
//  Muc dich: mot ket qua backtest CHI co nghia khi biet no sinh ra tu
//  (code nao, bo tham so nao, du lieu nao). Thieu danh tinh -> ket qua cua
//  nhieu the he engine nam chung mot bang, va "toi uu preset" chay tren du lieu rac.
//
//  BAY DA KIEM CHUNG BANG THUC NGHIEM (xem test section 5):
//   1. Nguoi dung chi truyen tham so ho doi, phan con lai "de default ngam":
//      raw hash of user input -> distinct preset hash despite identical config
//      that giong het. => PHAI merge DEFAULTS truoc khi hash.
//   2. Cung gia tri, chi dao THU TU key -> hash khac. => PHAI sort key.
//   3. volMin: 0 (so) vs "0" (chuoi) -> hash khac. => PHAI ep kieu theo SCHEMA,
//      khong ep theo kieu cua gia tri nguoi dung dua vao.
//   4. Go sai ten tham so ("rp" thay vi "rP") -> hash van sinh ra binh thuong,
//      KHONG ai bao loi, va run do lang le nam chung bang. => PHAI nem loi.
//
//  Vi vay file nay khong chi la "hash cho vui" - no la noi DUY NHAT dinh nghia
//  the nao la "cung mot cau hinh". Sua file nay = doi danh tinh cua moi run cu.
// =============================================================================

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULTS } from './signals.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// -----------------------------------------------------------------------------
//  ENGINE_VERSION - tang THU CONG khi thay doi lam ket qua backtest khac di.
//  Tang khi: sua 20_volume/30_levels/40_events, sua ta.mjs, doi DEFAULTS,
//            doi cach fill/thu tu TP-SL.
//  KHONG tang khi: sua comment, doi ten bien, toi uu toc do thuan tuy.
// -----------------------------------------------------------------------------
//  0.4.0 (2026-10-01): (a) auto-close BAT BUOC lenh limit phai khop entry truoc khi
//  xet TP/SL; (b) them feePct/feeMaxR; (c) DOI MO HINH VAO LENH: mac dinh
//  entryMode='market' (vao tai close bar ST) + tpMode='r' (TP = rrFb x R) thay cho
//  limit tai cuc tri + TP theo pivot. Run cu KHONG con so sanh duoc voi run moi
//  (xem docs/vsa-optimization.md muc 4.1 va 5b/5c).
//  (d) them CHIEN LUOC: signalMode 'vsa' | 'wyckoff', wyckoffEvent spring|sos|lps
//      + sosSpread/sosVol/lpsTol. Xac nhan bang su kien WYCKOFF (spring/UTAD,
//      SOS/SOW, LPS/LPSY) thay cho BOS/CHoCH cua SMC.
//  0.5.0 (2026-10-02): (a) tach VSA thanh PLUGIN (engine/methods/vsa.mjs, ham
//  analyze() + registry) - engine/signals.mjs chi con la re-export, ket qua khong
//  doi; (b) them slipPct (slippage % moi chieu) vao DEFAULTS -> phi + slippage
//  su that trong backtest, nen moi run DEP HON truoc do va khong so sanh duoc;
//  (c) them engine/backtest.mjs (D5 mac dinh = dung voi Pine, D6 sub-bar 1m) -
//  backtest truoc do chi la cac setup thua (khong tinh phi, khong co Trade).
export const ENGINE_VERSION = '0.5.0'

const NUMBER = 'number'
const STRING = 'string'
const BOOLEAN = 'boolean'

// Schema suy TRUC TIEP tu DEFAULTS -> khong bao gio lech voi engine thuc te.
export const PARAM_SCHEMA = Object.fromEntries(
  Object.entries(DEFAULTS).map(([k, v]) => [
    k,
    typeof v === 'boolean' ? BOOLEAN : typeof v === 'number' ? NUMBER : STRING,
  ]),
)

// --- ep kieu theo SCHEMA (khong theo kieu gia tri nguoi dung dua vao) ---
function coerce(name, type, value) {
  if (type === NUMBER) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new Error(`tham so "${name}" phai la so huu han (nhan ${JSON.stringify(value)})`)
    }
    return n
  }
  if (type === BOOLEAN) {
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
    throw new Error(`tham so "${name}" phai la true/false (nhan ${JSON.stringify(value)})`)
  }
  if (typeof value === 'string') return value
  throw new Error(`tham so "${name}" phai la chuoi (nhan ${JSON.stringify(value)})`)
}

/**
 * Chuan hoa mot bo tham so ve dang DUY NHAT.
 *  - merge DEFAULTS  (bay 1)
 *  - sort key        (bay 2)
 *  - ep kieu schema  (bay 3)
 *  - nem loi ten sai (bay 4)
 */
export function canonicalParams(params = {}) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('params phai la object')
  }
  const unknown = Object.keys(params).filter((k) => !(k in PARAM_SCHEMA))
  if (unknown.length) {
    throw new Error(`tham so khong ton tai trong engine: ${unknown.sort().join(', ')}`)
  }
  const out = {}
  for (const name of Object.keys(PARAM_SCHEMA).sort()) {
    const raw = params[name] === undefined ? DEFAULTS[name] : params[name]
    out[name] = coerce(name, PARAM_SCHEMA[name], raw)
  }
  return out
}

/** JSON on dinh: sort key o MOI cap (ke ca object long nhau nhu universeSnapshot). */
export function stableStringify(value) {
  if (value === undefined) throw new TypeError('stableStringify: undefined khong bieu dien duoc')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Hash cua mot bo tham so - hai cau hinh tuong duong LUON cho cung hash. */
export function paramsHash(params) {
  return sha256(stableStringify(canonicalParams(params)))
}

/** Hash bat ky gia tri nao (dung cho dataHash, universeSnapshot, ...). */
export function hashOf(value) {
  return sha256(stableStringify(value))
}

/** Hash cua chuoi nen: chi lay truong OHLCV, khong phu thuoc truong la. */
export function barsHash(bars) {
  const h = createHash('sha256')
  for (const b of bars) {
    h.update(`${b.time},${b.open},${b.high},${b.low},${b.close},${b.volume}\n`)
  }
  return h.digest('hex')
}

/**
 * Doc git rev ma KHONG can spawn process (sandbox chan pipe, va khong phu thuoc
 * git co trong PATH). Loi -> tra null, khong bao gio nem: thieu git rev chi lam
 * run do "khong truy vet duoc bang git", khong phai ly do de hong ca run.
 */
export function readGitRev(root = ROOT) {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref: ')) return head || null
    const ref = readFileSync(join(root, '.git', head.slice(5).trim()), 'utf8').trim()
    return ref || null
  } catch {
    return null
  }
}

/**
 * Danh tinh day du cua mot run (D1). Moi document `runs` PHAI mang object nay.
 *
 * Co ca `params` (da canonical hoa) chu khong chi `paramsHash`: hash chung minh
 * "cung cau hinh", nhung de TAI LAP mot run thi phai co chinh bo tham so do.
 * Thieu no thi sau nay doi DEFAULTS se khong biet run cu chay voi so nao.
 *
 * `universeSnapshot` nen gom: danh sach symbol + ngay lay + nguon (D11).
 */
export function runStamp({ params, bars, symbol, tf, market, universeSnapshot = null, engineVersion = ENGINE_VERSION } = {}) {
  return {
    engineVersion,
    paramsHash: paramsHash(params ?? {}),
    params: canonicalParams(params ?? {}),
    dataHash: bars ? barsHash(bars) : null,
    symbol: symbol ?? null,
    tf: tf ?? null,
    market: market ?? null,
    universeSnapshot,
    gitRev: readGitRev(),
    createdAt: null, // noi ghi (store.mjs) dien thoi diem thuc
  }
}