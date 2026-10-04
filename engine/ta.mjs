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