// =============================================================================
//  TM TRADING - ENGINE TA PRIMITIVES
//  Port ngu nghia Pine Script v6 sang JS thuan (khong dependency).
//
//  Vi sao phai port chu khong dung lai cong thuc "gan dung": roadmap §6 xac dinh
//  "Lech Pine <-> engine" la RUI RO #1. Moi ham o day phai khop dung cach Pine
//  tinh, khong phai cach ta thay no dep:
//
//   - ta.rma  : seed bang ta.sma(length) chu KHONG phai gia tri dau tien.
//               Cong thuc Pine: sum := na(sum[1]) ? ta.sma(src,length)
//                                                 : a*src + (1-a)*nz(sum[1])
//   - ta.atr  : ta.rma(ta.tr(true), length) - bar dau khong co close[1] thi
//               TR = high-low (khong phai na).
//   - ta.pivotlow/high: overload positional la (source, leftbars, rightbars).
//               Pivot CHI duoc xac nhan tai bar i = c + rightbars, tuc la
//               "nhin ve qua khu": o bar i ta moi biet bar c la pivot.
//   - math.sum: na cho den khi du `length` gia tri.
//
//  Gia tri "na" cua Pine bieu dien bang `null`.
// =============================================================================

/** ta.sma - trung binh dong, na khi chua du `length` gia tri. */
export function sma(values, length) {
  const out = new Array(values.length).fill(null)
  if (!(length > 0)) return out
  let sumV = 0
  let bad = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v)) sumV += v
    else bad++
    if (i >= length) {
      const old = values[i - length]
      if (Number.isFinite(old)) sumV -= old
      else bad--
    }
    if (i >= length - 1 && bad === 0) out[i] = sumV / length
  }
  return out
}

/**
 * ta.rma - Wilder MA.
 *
 * Pine (khong dung `alpha` nhung tuong duong):
 *   rma[i] = na(rma[i-1]) ? sma[i] : (v[i] + (len-1)*rma[i-1]) / len
 *
 * Luu y: neu v[i] la na thi ket qua na (Pine: alpha*na = na), va bar sau do
 * lai roi vao nhanh seed vi sum[1] la na. Ta tai hien dung hanh vi do.
 */
export function rma(values, length) {
  const out = new Array(values.length).fill(null)
  if (!(length > 0)) return out
  const seed = sma(values, length)
  const alpha = 1 / length
  for (let i = 0; i < values.length; i++) {
    if (i < length - 1) continue
    const v = values[i]
    if (!Number.isFinite(v)) {
      out[i] = null
      continue
    }
    const prev = out[i - 1]
    out[i] = prev == null ? seed[i] : alpha * v + (1 - alpha) * prev
  }
  return out
}

/** ta.tr(handle_na = true) - bar dau tien (khong co close[1]) tra high-low. */
export function trueRange(bars) {
  return bars.map((b, i) => {
    const prev = bars[i - 1]
    if (!prev) return b.high - b.low
    return Math.max(
      b.high - b.low,
      Math.abs(b.high - prev.close),
      Math.abs(b.low - prev.close),
    )
  })
}

/** ta.atr(length) */
export function atr(bars, length) {
  return rma(trueRange(bars), length)
}

/** math.sum - na cho den khi du `length` gia tri (khac ta.sma o cho do). */
export function rollingSum(values, length) {
  const out = new Array(values.length).fill(null)
  if (!(length > 0)) return out
  let sumV = 0
  for (let i = 0; i < values.length; i++) {
    sumV += values[i]
    if (i >= length) sumV -= values[i - length]
    if (i >= length - 1) out[i] = sumV
  }
  return out
}

/**
 * ta.pivotlow(source, leftbars, rightbars)
 *
 * Pivot low tai bar c khi low[c] la gia tri NHO NHAT trong cua so
 * [c-leftbars, c+rightbars]. Ket qua chi tra ve o bar i = c + rightbars
 * (Pine "xac nhan muon" - khong nhin truoc).
 *
 * Do nghiem ngat cua so sanh: theo vi du `pine_pivothigh` trong tai lieu Pine,
 * cac bar con lai phai THUC SU lon hon (strict) - bang nhau thi KHONG tinh pivot.
 * Assert test behavior (case: "all lows equal -> no pivot").
 *
 * Tra ve: mang, phan tu i = { value, index } | null.
 */
export function pivotLow(values, leftbars, rightbars) {
  return pivot(values, leftbars, rightbars, (v, o) => o > v)
}

/** ta.pivothigh(source, leftbars, rightbars) - nguoc lai pivotLow. */
export function pivotHigh(values, leftbars, rightbars) {
  return pivot(values, leftbars, rightbars, (v, o) => o < v)
}

function pivot(values, leftbars, rightbars, isPivot) {
  const out = new Array(values.length).fill(null)
  for (let i = rightbars; i < values.length; i++) {
    const c = i - rightbars
    if (c - leftbars < 0) continue
    const v = values[c]
    if (!Number.isFinite(v)) continue
    let ok = true
    for (let k = c - leftbars; k <= c + rightbars; k++) {
      if (k === c) continue
      const o = values[k]
      if (!Number.isFinite(o) || !isPivot(v, o)) {
        ok = false
        break
      }
    }
    if (ok) out[i] = { value: v, index: c }
  }
  return out
}

/** ta.lowest(source, length) */
export function lowest(values, length, from, to) {
  return extreme(values, length, from, to, Math.min)
}

/** ta.highest(source, length) */
export function highest(values, length, from, to) {
  return extreme(values, length, from, to, Math.max)
}

function extreme(values, length, from, to, pick) {
  const out = new Array(values.length).fill(null)
  const end = Math.min(to ?? values.length - 1, values.length - 1)
  for (let i = from ?? 0; i <= end; i++) {
    if (i < length - 1) continue
    let m = null
    for (let k = i - length + 1; k <= i; k++) {
      m = m == null ? values[k] : pick(m, values[k])
    }
    out[i] = m
  }
  return out
}

// -----------------------------------------------------------------------------
//  Indicator primitives (Phase 7I) - array-land ports of Pine ta.* functions.
//  Same contract as above: `null` = Pine `na`, exact Pine semantics over
//  "looks right". The chart adapter (app/utils/indicators.ts) AND the backtest
//  must both call these - single source of truth (roadmap 7I acceptance:
//  "Indicator engine = backtest implementation").
// -----------------------------------------------------------------------------

/**
 * ta.ema - exponential MA. Pine reference (seed from first valid src, NOT SMA):
 *   ema := na(ema[1]) ? src : alpha * src + (1 - alpha) * nz(ema[1])
 * A `na` src outputs `na` and leaves the recursion state untouched (KI-66:
 * neither updates nor resets).
 */
export function ema(values, length) {
  const out = new Array(values.length).fill(null)
  if (!(length > 0)) return out
  const alpha = 2 / (length + 1)
  let prev = null
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    out[i] = prev == null ? v : alpha * v + (1 - alpha) * prev
    prev = out[i]
  }
  return out
}

/**
 * ta.rsi - Wilder RSI:
 *   rs  = ta.rma(gains, length) / ta.rma(losses, length)
 *   rsi = 100 - 100 / (1 + rs)
 * Edge cases per Pine math: 0/0 -> na (flat window), x/0 -> +inf -> rsi = 100.
 * The first bar has no prev close -> both series start with `na`.
 */
export function rsi(closes, length) {
  const out = new Array(closes.length).fill(null)
  if (!(length > 0)) return out
  const gains = new Array(closes.length).fill(null)
  const losses = new Array(closes.length).fill(null)
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i]
    const p = closes[i - 1]
    if (!Number.isFinite(c) || !Number.isFinite(p)) continue
    const d = c - p
    gains[i] = d > 0 ? d : 0
    losses[i] = d < 0 ? -d : 0
  }
  const ag = rma(gains, length)
  const al = rma(losses, length)
  for (let i = 0; i < closes.length; i++) {
    if (ag[i] == null || al[i] == null) continue
    const rs = al[i] === 0 ? (ag[i] === 0 ? NaN : Infinity) : ag[i] / al[i]
    out[i] = Number.isFinite(rs) ? 100 - 100 / (1 + rs) : rs === Infinity ? 100 : null
  }
  return out
}

/**
 * ta.stdev - POPULATION standard deviation over a strict window (any `na`
 * inside the window -> `na`, conservatively; mirrors the sma `bad` gate).
 */
export function stdev(values, length) {
  const out = new Array(values.length).fill(null)
  if (!(length > 0)) return out
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0
    let ok = true
    for (let k = i - length + 1; k <= i; k++) {
      const v = values[k]
      if (!Number.isFinite(v)) { ok = false; break }
      sum += v
    }
    if (!ok) continue
    const mean = sum / length
    let sq = 0
    for (let k = i - length + 1; k <= i; k++) {
      const d = values[k] - mean
      sq += d * d
    }
    out[i] = Math.sqrt(sq / length)
  }
  return out
}

/**
 * ta.macd - EMA(fast) - EMA(slow), signal = EMA(macd), hist = macd - signal.
 * Returns `{ macd, signal, hist }`, all aligned to `closes` (`null` = na).
 */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast)
  const es = ema(closes, slow)
  const line = closes.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]))
  const sig = ema(line, signal)
  const hist = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]))
  return { macd: line, signal: sig, hist }
}

/**
 * ta.vwap - typical-price volume-weighted average price, ANCHORED at the first
 * bar of the array (session anchoring comes later with session support in the
 * chart adapter; documented deviation from Pine's default session reset).
 * Cumulative: sum(tp * vol) / sum(vol) over all bars so far.
 */
export function vwap(bars) {
  const out = new Array(bars.length).fill(null)
  let cumPV = 0
  let cumV = 0
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    const v = b.volume
    if (!Number.isFinite(v) || v < 0 || !Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(b.close)) {
      out[i] = null
      continue
    }
    const tp = (b.high + b.low + b.close) / 3
    cumPV += tp * v
    cumV += v
    out[i] = cumV > 0 ? cumPV / cumV : null
  }
  return out
}

/**
 * ta.obv - on-balance volume: starts at 0, +/- volume by close direction.
 * A bar with invalid close outputs `na` and leaves the accumulator untouched.
 */
export function obv(bars) {
  const out = new Array(bars.length).fill(null)
  let acc = 0
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    if (!Number.isFinite(b.close) || !Number.isFinite(b.volume)) continue
    if (i > 0) {
      const prev = bars[i - 1].close
      if (Number.isFinite(prev)) {
        if (b.close > prev) acc += b.volume
        else if (b.close < prev) acc -= b.volume
      }
    }
    out[i] = acc
  }
  return out
}

/**
 * ta.cmf - Chaikin money flow = sum(mfv, length) / sum(volume, length),
 * mfv = clv * volume, clv = ((c-l) - (h-c)) / (h-l).
 * Degenerate bar (h == l) -> multiplier 0; window with na or zero volume -> na.
 */
export function cmf(bars, length) {
  const out = new Array(bars.length).fill(null)
  if (!(length > 0)) return out
  const mfv = bars.map((b) => {
    const rng = b.high - b.low
    if (!(rng > 0) || !Number.isFinite(b.close) || !Number.isFinite(b.volume)) return null
    const clv = ((b.close - b.low) - (b.high - b.close)) / rng
    return clv * b.volume
  })
  for (let i = length - 1; i < bars.length; i++) {
    let sm = 0
    let sv = 0
    let ok = true
    for (let k = i - length + 1; k <= i; k++) {
      const v = bars[k].volume
      if (!Number.isFinite(v) || mfv[k] == null) { ok = false; break }
      sm += mfv[k]
      sv += v
    }
    if (!ok || sv === 0) continue
    out[i] = sm / sv
  }
  return out
}

/**
 * donchian - { upper, lower, middle } from highest(high) / lowest(low).
 * Built on the existing ta.highest/ta.lowest confirmation semantics.
 */
export function donchian(bars, length) {
  const upper = highest(bars.map((b) => b.high), length)
  const lower = lowest(bars.map((b) => b.low), length)
  const middle = upper.map((u, i) => (u == null || lower[i] == null ? null : (u + lower[i]) / 2))
  return { upper, lower, middle }
}

// -----------------------------------------------------------------------------
//  f_sessionOk (pine/shared/common.pine)
//  Pine: not na(time(timeframe.period, sess, tz))
//
//  Gioi han da biet: engine chi kiem tra GIO trong ngay theo tz, khong mo hinh
//  ngay nghi/le/danh sach ngay cua Pine. Du cho crypto va case fixture
//  "session on/off"; XAU/forex can bang tay khi doi chieu live (ghi trong docs).
// -----------------------------------------------------------------------------

function hhmm(str) {
  const m = /^(\d{2}):?(\d{2})$/.exec(String(str).trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function localMinutes(timeMs, tz) {
  if (!tz || tz === 'UTC') {
    const d = new Date(timeMs)
    return d.getUTCHours() * 60 + d.getUTCMinutes()
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(timeMs))
  const h = parts.find((x) => x.type === 'hour')?.value
  const mi = parts.find((x) => x.type === 'minute')?.value
  return Number(h) * 60 + Number(mi)
}

/** f_sessionOk(sess, tz) - `sess` dang "0800-1600" (ho tro phien qua dem). */
export function sessionOk(timeMs, sess, tz) {
  const m = /^(\d{4})-(\d{4})$/.exec(String(sess).trim())
  if (!m) return false
  const start = hhmm(m[1])
  const end = hhmm(m[2])
  if (start == null || end == null) return false
  const t = localMinutes(timeMs, tz)
  return start <= end ? t >= start && t < end : t >= start || t < end
}

/**
 * f_vsaName(vol, ma, rP, rVH, rH, rN, rL) - 6 bucket, TIM la tren cung.
 *
 * Khi ma la na: moi so sanh trong chuoi ternary cua Pine deu la na -> Pine coi
 * dieu kien na la false va roi xuong nhanh cuoi -> "VeryLow" (khong phai null).
 * Tai hien dung hanh vi do de dashboard/engine khong lech nhau.
 */
export function vsaBucket(vol, ma, r) {
  if (!(ma > 0)) return 'VeryLow'
  if (vol >= ma * r.rP) return 'TIM'
  if (vol >= ma * r.rVH) return 'VeryHigh'
  if (vol >= ma * r.rH) return 'High'
  if (vol >= ma * r.rN) return 'Normal'
  if (vol >= ma * r.rL) return 'Low'
  return 'VeryLow'
}