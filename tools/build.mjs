#!/usr/bin/env node
// =============================================================================
//  TM TRADING - ASSEMBLER
//  Pine Script khong ho tro #include nen day la "preprocessor".
//  Doc pine/parts*/ + chen pine/shared/{file} (marker {{SHARED}}) -> pine/dist
//
//  Usage:
//    node tools/build.mjs            # build ca target
//    node tools/build.mjs --watch    # tu dong build lai khi parts/shared doi
//    node tools/build.mjs vsa        # chi build 1 target (vsa/indicator/strategy)
// =============================================================================

import { readdirSync, readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = join(ROOT, 'pine', 'shared')
const DIST = join(ROOT, 'pine', 'dist')

const TARGETS = {
  indicator: {
    file: 'TM Signals.pine',
    dir: 'parts',
    shared: ['common.pine'],
    // Giu tren MOT dong: khai bao script la vi tri nhay parse, khong sua.
    decl: `indicator("TM Signals", shorttitle = "TM·SIG", overlay = false, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
  },
  strategy: {
    file: 'TM Backtest.pine',
    dir: 'parts',
    shared: ['common.pine'],
    decl: `strategy("TM Backtest", shorttitle = "TM·BT", overlay = true, pyramiding = 0, calc_on_order_fills = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 1, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 0)`,
  },
  vsa: {
    file: 'TM VSA Wyckoff.pine',
    dir: 'parts-vsa',
    shared: ['common.pine', 'sess-inputs.pine'],
    decl: `indicator("TM VSA Wyckoff", "TM VSA Wyckoff", overlay = false, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
  },
  // Ban backtest cua VSA - CUNG nguon parts-vsa, chi khac khai bao strategy va
  // 60_viz.pine bi cat (@part skip:vsa-strategy) vi do la phan ve rieng cua pane
  // volume. Logic su kien (20/30/40) dung nguyen ven -> khong the lech voi ban
  // indicator. Cau noi lenh nam o 50_strategy.pine (@part skip:vsa).
  'vsa-strategy': {
    file: 'TM VSA Backtest.pine',
    dir: 'parts-vsa',
    shared: ['common.pine', 'sess-inputs.pine'],
    decl: `strategy("TM VSA Backtest", "TM VSA Backtest", overlay = true, pyramiding = 0, calc_on_order_fills = true, process_orders_on_close = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 0)`,
  },
  // Phase 11 - Liquidity Sweep: quet thanh khoan (pivot swing kieu LuxAlgo) +
  // rau tu choi + xac nhan volume VSA -> tin hieu dao chieu. overlay = false nen
  // histogram volume nam o pane rieng (giong TM VSA Wyckoff); MOI hinh ve tren
  // gia (level/box/nhan/Entry-SL-TP/dashboard) phai kem force_overlay = true.
  sweep: {
    file: 'TM Liquidity Sweep.pine',
    dir: 'parts-sweep',
    shared: ['common.pine', 'sess-inputs.pine'],
    decl: `indicator("TM Liquidity Sweep", "TM Liquidity Sweep", overlay = false, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
  },
  xau: {
    file: 'TM XAU Signals.pine',
    dir: 'parts-xau',
    shared: ['common.pine', 'zones.pine'],
    decl: `indicator("TM XAU Signals", shorttitle = "TM·XAU", overlay = false, dynamic_requests = true, max_boxes_count = 200, max_lines_count = 200, max_labels_count = 200)`,
  },
  // Phase 12 - XAU v2 (docs/indicator-XAU/master-prompt v2.md): event UDT co
  // timestamp/tf/confirmed/level, MSS + retest + failed breakout, FVG + Order
  // Block + trendline, indicator engine nhom theo chuc nang (MACD/DMI/BB/VWAP/
  // OBV/RelVol), MTF Context + HTF VETO. overlay=false -> moi hinh ve tren gia
  // phai kem force_overlay = true (giong parts-xau).
  xau2: {
    file: 'TM XAU Signals 2.pine',
    dir: 'parts-xau2',
    shared: ['common.pine', 'zones.pine'],
    decl: `indicator("TM XAU Signals 2", shorttitle = "TM·XAU2", overlay = false, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
  },
}

// --- doc part theo thu tu ten file (00_, 10_, 20_ ...) trong dir cua target ---
function readParts(target) {
  const dir = join(ROOT, 'pine', TARGETS[target].dir)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.pine'))
    .sort()
    .map((f) => ({ name: f, src: readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n') }))
}

// --- noi dung shared cua target (chen qua marker {{SHARED}}) ---
function sharedCode(target) {
  return (TARGETS[target].shared ?? [])
    .map((f) => readFileSync(join(SHARED, f), 'utf8').replace(/\r\n/g, '\n'))
    .join('\n')
}

// --- cat block theo marker // @part skip:<target> ---
// Tra ve [{ t, n }] - `n` la so dong TRONG FILE GOC (khong phai dong da cat),
// de `errors.mjs` chi dung dung vi tri trong pine/parts/.
// Ten target cho phep gach noi (vsa-strategy), neu khong `\w+` se chi bat duoc
// phan truoc gach -> marker "skip:vsa-strategy" bi hieu nham thanh "skip:vsa".
function filterMarkerLines(src, target) {
  const out = []
  let skipping = false
  let n = 0
  for (const line of src.split('\n')) {
    n++
    const m = line.match(/^\s*\/\/\s*@part\s+skip:([\w-]+)/)
    if (m) {
      skipping = m[1] === target
      continue
    }
    if (!skipping) out.push({ t: line, n })
  }
  return out
}

// --- kiem tra nhe: indent, ngoac, ham khong ton tai, tham so sai thu tu ---
//
//  TradingView khong bao gio dung offline nen cac loi nay phai bat bang tay:
//    - goi ham Pine khong ton tai (vd input.timezone) -> CE10271
//    - truyen tham so theo thu tu cho ham co offset o vi tri do      -> CE10271
//    - truyen float vao tham so can int / dao thu tu time & format  -> CE10123
//    - ten tham so khong co trong chu ky                             -> CE10120
//
//  NGUON CHAN LY: tools/pine-ref.json (sinh boi tools/pine-ref.mjs tu
//  folknor/pine-tools - du lieu lay tu tai lieu chinh thuc TradingView).
//  MOI luat ben duoi deu duoc DERIVE tu do, khong danh tay. Day la quy tac P0:
//  truoc day lint lay "cai minh nho" lam chan ly va da viet nguoc 4 lan
//  (table.cell_clear, str.format_time, POSITIONAL_RISK, FAKE_NAMES) - moi lan deu
//  do test chi kiem 1 chieu tao cam gia "da dung".
//  Cap nhat:  node tools/pine-ref.mjs   roi   npm run verify
const REF_PATH = join(ROOT, 'tools', 'pine-ref.json')
let REF
try {
  REF = JSON.parse(readFileSync(REF_PATH, 'utf8'))
} catch (e) {
  throw new Error(`thieu ${REF_PATH} - hay chay "node tools/pine-ref.mjs" truoc (${e.message})`)
}
const REF_FUNCS = REF.functions

// Tat ca ten ham Pine v6: gom ca phep ep kieu (int/float/bool/string/color),
// ham khai bao (indicator/strategy/library) va cac chu ky co tuy chon.
// Chi can ten di kem "(" la da duoc kiem chung; ten khac se bi bao CE10271.
// (Ham dang kieu `array.new<box>()` khong khop regex "ten(" nen duoc bo qua -
//  khong co cach nao phan biet voi ten khong ton tai chi qua van ban.)
const BUILTINS = new Set(Object.keys(REF_FUNCS))

// Tu khoa / toan tu Pine - khong phai loi goi ham.
// Bo indicator/strategy/library vi chung LA ham (co bo tham so rieng) va phai
// van duoc kiem tra tham so nhu ham thuong.
const DECLS = new Set(['indicator', 'strategy', 'library'])
const KEYWORDS = new Set(REF.keywords.filter((k) => !DECLS.has(k)))

// TUNG chu ky rieng cua ham. `params/types` trong ref la chu ky GOP (union) cua
// cac overload - dung duoc cho ten tham so NHUNG KHONG dung cho vi tri, vi vi tri
// 4 cua box.new la `border_width` (int) theo chu ky point nhung la `bottom`
// (float) theo chu ky x/y. Luat dua vao vi tri phai dong y qua TAT CA cac chu ky.
function signatures(spec) {
  return spec.sigs?.length ? spec.sigs : [{ params: spec.params, types: spec.types }]
}

// Vi tri (bat dau tu 1) cua tham so `offset`: truyen du tham so theo thu tu den
// vi tri do thi gia tri se bi gan cho `offset` thay cho gia tri nguoi viet mong doi.
// Chi lay khi MOI chu ky deu co `offset` cung MOT vi tri >= 4 - vi du
// barcolor/bgcolor/ta.alma co offset som (vi tri 1-2) nen truyen 2-3 tham so theo
// thu tu van binh thuong. Ket qua hien tai: plot->8, plotshape/plotchar->6, plotarrow->5.
const POSITIONAL_RISK = new Map(
  Object.entries(REF_FUNCS)
    .map(([name, spec]) => {
      const sigs = signatures(spec)
      const idx = sigs.map((s) => s.params.indexOf('offset'))
      return idx[0] >= 4 && idx.every((i) => i === idx[0]) ? [name, idx[0] + 1] : null
    })
    .filter(Boolean),
)

// Kieu int "nguyen khong phon" (const/input/simple/series int). Bo qua kieu gop
// (series int/float) va cac kieu khac (input plot_display, const string...).
const PURE_INT = /^(?:const|input|simple|series)\s+int$/

// Vi tri tham so (bat dau tu 0) phai la int - derive cho MOI ham, khong chi ta.*
// (vd table.cell column/row, plot linewidth, array.get index...). Chi giu vi tri
// ma TAT CA cac chu ky deu co kieu int tai do (xem signatures() ben tren).
const INT_PARAMS = new Map(
  Object.entries(REF_FUNCS)
    .map(([name, spec]) => {
      const sigs = signatures(spec)
      const len = Math.min(...sigs.map((s) => s.params.length))
      const idx = []
      for (let i = 0; i < len; i++) if (sigs.every((s) => PURE_INT.test(s.types[i] || ''))) idx.push(i)
      return [name, idx]
    })
    .filter(([, idx]) => idx.length),
)

// Gia tri float CHAC CHAN:
//   - chu so thap phan / so mu (3.0, .5, 1e3) trong bieu thuc phep tinh
//   - gan tu ham co kieu tra ve chua "float" (ta.atr -> series float, input.float)
//   - bien da duoc nhan dinh la float (thuyet phan 3 lan)
//   - khai bao ro kieu: `float x = ...`
//
// NGUYEN TAC CHONG FALSE POSITIVE (P0): bat float CHAC CHAN, khong bat "khong
// chung minh duoc la int" (la quy tac cu da sinh loi). Trong ref con co nhieu
// tham so co kieu `unknown` hoac gop (int/float), nen neu bat moi bieu thuc khong
// phai so nguyen se nham code dung. Khong chac chan -> bo qua (chi mat bot khi
// phat hien, khong mat khi dung).
const FLOAT_LITERAL = /(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?|\d+[eE][-+]?\d+/
function isFloatReturns(ret) {
  return typeof ret === 'string' && /float/i.test(ret) && !/int/i.test(ret)
}
function floatVars(code) {
  const out = new Set()
  for (const m of code.matchAll(/^\s*(?:var\s+)?float\s+(\w+)/gm)) out.add(m[1])
  const assigns = [...code.matchAll(/^\s*(\w+)\s*(?::=|=(?!=))\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()])
  for (let pass = 0; pass < 3; pass++) {
    for (const [name, rhs] of assigns) {
      if (out.has(name) || !rhs) continue
      if (FLOAT_LITERAL.test(rhs)) {
        // chi tinh khi la phep tinh thuc su (tru so sanh / ternary -> ket qua co the la int)
        if (!/[?:<>=!]/.test(rhs)) out.add(name)
        continue
      }
      const call = rhs.match(/^([A-Za-z_][\w.]*)\s*\(/)
      if (call && isFloatReturns(REF_FUNCS[call[1]]?.returns)) out.add(name)
      else if (out.has(rhs)) out.add(name)
    }
  }
  return out
}

// Ten tham so hop le (truyen ten khong co -> CE10120). Lay toan bo chu ky cua ref;
// cac ham overload (line.new/label.new/box.new) da duoc gop chu ky nen tap ten van
// day du cho ca 2 cach goi (point-first va x/y-first).
const PARAM_SET = new Map(
  Object.entries(REF_FUNCS)
    .filter(([, spec]) => spec.params.length)
    .map(([name, spec]) => [name, new Set(spec.params)]),
)

// Nguon chung thuc (dang ky truoc khi them rule):
//   str.format_time(time, format, timezone) -> time la `series int`, dinh dang la string.
//   https://www.tradingview.com/pine-script-docs/concepts/time/
//   -> str.format_time("yyyy", time, "UTC") = CE10123 (literal string nhung can series int).
// Cach derive: MOI chu ky deu co tham so DAU TIEN ten "time" va kieu do la int
// nguyen (str.format_time, hour/minute/second/dayofmonth/..., chart.point.from_time).
// chu y: `time("D")` KHONG bi bao vi tham so dau cua cac chu ky cua ham `time`
// la `timeframe` (string).
const ARG0_TIME_NOT_STRING = new Set(
  Object.entries(REF_FUNCS)
    .filter(([, spec]) =>
      signatures(spec).every((s) => s.params[0] === 'time' && PURE_INT.test(s.types[0] || '')),
    )
    .map(([name]) => name),
)

// Dung cho test (smoke.mjs) dam bao FAKE_NAMES khong bi dua nham vao ref.
export function isPineFunction(name) {
  return BUILTINS.has(name)
}

// tach danh sach tham so cap nhat (bat dau ngay SAU dau '(')
// export cho smoke.mjs kiem tra so tham so (vd CE10165 ta.pivotlow thieu rightbars)
export function splitArgs(code, startIdx) {
  let d = 0
  let cur = ''
  const args = []
  let str = null
  for (let k = startIdx; k < code.length; k++) {
    const c = code[k]
    if (str) {
      cur += c
      if (c === '\\') cur += code[++k] ?? ''
      else if (c === str) str = null
      continue
    }
    if (c === '"' || c === "'") { str = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') d++
    if (c === ')' && d === 0) { args.push(cur); return args }
    if (c === ')' || c === ']' || c === '}') d--
    if (c === ',' && d === 0) { args.push(cur); cur = ''; continue }
    cur += c
  }
  return args
}

// --- che comment VA noi dung chuoi, giu nguyen so dong ---
// Khong lam vay thi regex se khop nhau nham trong text tieng Viet trong input.label
// (vd "Chi tin hieu tren nen da dong (" -> nham la goi ham "dong(").
// Chuoi bi che thanh khoang trang nen "1.5" trong string khong bi doc la float.
function mask(src) {
  let out = ''
  let inStr = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const two = src.slice(i, i + 2)
    if (inStr) {
      if (c === '\\') { out += '  '; i++; continue }
      if (c === inStr) { inStr = null; out += c; continue }
      out += c === '\n' ? '\n' : ' '
      continue
    }
    if (c === '"' || c === "'") { inStr = c; out += c; continue }
    if (two === '//') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue }
    out += c
  }
  return out
}

export function lint(src, name = 'test') {
  const warnings = []
  const code = mask(src)
  const lines = code.split('\n')
  let depth = 0
  let inStr = null

  lines.forEach((line, i) => {
    const raw = line.trim()
    const cont = depth > 0
    if (raw === '' || raw.startsWith('//')) return
    if (!cont) {
      const indent = line.match(/^ */)[0].length
      if (indent % 4 !== 0) warnings.push(`${name}:${i + 1} indent ${indent} (boi so 4) - "${raw.slice(0, 48)}"`)
    }
    // Bieu thuc bi tach qua nhieu dong. Pine yeu cau mang const (vd `options`)
    // va bo khai bao script phai la const -> tach dong sinh loi CE10156/parse.
    // Da gap that voi input.string(options = [ ... ]) nhieu dong.
    if (/[,\[]\s*$/.test(line) && raw.length > 0) {
      warnings.push(`${name}:${i + 1} bieu thuc tach qua dong - giu tren MOT dong de tranh CE10156`)
    }
    for (let k = 0; k < line.length; k++) {
      const ch = line[k]
      if (inStr) {
        if (ch === '\\') k++
        else if (ch === inStr) inStr = null
        continue
      }
      if (ch === '"' || ch === "'") inStr = ch
      else if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
    }
  })
  if (depth !== 0) warnings.push(`phan dau thieu ngoac (net ${depth})`)

  // Ham do nguoi viet trong chinh file: f_xxx(...) = ... hoac f_xxx(...) =>
  const locals = new Set()
  for (const m of code.matchAll(/^\s*(f_\w+)\s*\(/gm)) locals.add(m[1])

  // Khoi tao UDT: TmPlan.new(...)
  const udts = new Set()
  for (const m of code.matchAll(/^\s*type\s+(\w+)/gm)) udts.add(`${m[1]}.new`)

  // Bien nao chac chan la float (de kiem tra tham so can int)
  const floats = floatVars(code)

  // Moi noi goi ham, tach theo dau phay cap nhat + so doi tham so
  for (const m of code.matchAll(/([A-Za-z_][\w.]*)\s*\(/g)) {
    const fn = m[1]
    if (KEYWORDS.has(fn) || fn.startsWith('tm_') || fn.startsWith('f_') || locals.has(fn) || udts.has(fn)) continue
    if (!BUILTINS.has(fn)) {
      const line = code.slice(0, m.index).split('\n').length
      warnings.push(`${name}:${line} goi ham "${fn}" - khong co trong Pine v6? (CE10271)`)
      continue
    }

    const args = splitArgs(code, m.index + m[0].length)
    const line = code.slice(0, m.index).split('\n').length

    // tham so theo thu tu co the lam `offset` bi lan
    const offsetAt = POSITIONAL_RISK.get(fn)
    if (offsetAt !== undefined) {
      const positional = args.filter((a) => !a.includes('=')).length
      if (positional >= offsetAt) {
        warnings.push(`${name}:${line} ${fn}() truyen ${positional} tham so theo thu tu - tham so thu ${offsetAt} se bi gan vao "offset"`)
      }
    }

    // tham so yeu cau int nhung truyen vao float chac chan -> CE10123
    const needInt = INT_PARAMS.get(fn)
    if (needInt) {
      for (const idx of needInt) {
        const a = args[idx]?.trim()
        if (!a) continue
        // truyen bang ten (`length = x`) thi van kiem tra phia sau dau =
        const named = a.match(/^\s*[A-Za-z_]\w*\s*=(?![=<>])\s*(.+)$/)
        const v = (named ? named[1] : a).trim()
        if (!v) continue
        const isFloat = FLOAT_LITERAL.test(v) || [...v.matchAll(/\b(\w+)\b/g)].some((x) => floats.has(x[1]))
        if (isFloat) {
          warnings.push(`${name}:${line} ${fn}() tham so ${idx + 1} "${v}" phai la simple int (so chu ky) nhung la FLOAT (CE10123)`)
        }
      }
    }

    // tham so dau cua str.format_time phai la UNIX time, khong duoc la chuoi format
    if (ARG0_TIME_NOT_STRING.has(fn)) {
      const a = args[0]?.trim()
      if (a && (a.startsWith('"') || a.startsWith("'"))) {
        warnings.push(`${name}:${line} ${fn}() tham so 1 phai la UNIX time (series int), dang la chuoi format "${a}" - sai thu tu (CE10123)`)
      }
    }

    // ten tham so khong ton tai -> CE10120
    const valid = PARAM_SET.get(fn)
    if (valid) {
      for (const a of args) {
        // Phai khop dung `ten =` dau tham so. Dung `(?![=<>])` de khong nham
        // vao `==`, `<=`, `>=` ben trong bieu thuc (vd tm_posDir == 1 ? ...).
        const m = a.match(/^\s*([A-Za-z_]\w*)\s*=(?![=<>])/)
        if (!m) continue
        if (!valid.has(m[1])) {
          warnings.push(`${name}:${line} ${fn}() khong co tham so "${m[1]}" (CE10120)`)
        }
      }
    }
  }

  return [...new Set(warnings)]
}

// --- bien chua thay the ---
function subst(src, target) {
  // dung ham tra ve de khong bi doc $&/`$1` trong noi dung (chuong trinh con chua $)
  return src.replace('{{DECL}}', () => TARGETS[target].decl).replace('{{SHARED}}', () => sharedCode(target))
}

// Ghep parts -> code dist, DONG THOI ghi lai dong nao den tu file nao.
// tra ve { code, origin } voi origin[i] = { from, n } cua dong thu i (0-based):
//   from = ten file trong pine/parts/, n = so dong TRONG FILE DO.
// `errors.mjs` dung de doan loi "line N" cua TradingView ve dung vi tri sua.
//
// Cac buoc khong doi so voi cach noi chuoi truoc day:
//   1. noi cac part bang '\n' (giong join cua ban cu).
//   2. banner (bat dau bang MOT dong rong) noi vao cuoi.
//   3. replace(/\n{3,}/g, '\n\n')  -> nhom dong RONG lien tiep >= 2 giam con 1
//      (truong hop o DAU chuoi: 3 dong tro len giam con 2 - khac biet nho cua regex).
//   4. trimEnd() + '\n'.
export function assemble(target) {
  const lines = []
  for (const p of readParts(target)) {
    for (const l of filterMarkerLines(subst(p.src, target), target)) {
      lines.push({ t: l.t, from: p.name, n: l.n })
    }
  }

  // `//@version=6` bat buoc phai la dong dau tien -> banner dat sau no.
  const banner = [
    '',
    '// =============================================================================',
    '//  AUTO-GENERATED - DO NOT EDIT',
    `//  Target: ${target}`,
    '//  Source: pine/parts*/ + pine/shared/*.pine   ->   node tools/build.mjs',
    `//  Built : ${new Date().toISOString()}`,
    '// =============================================================================',
  ].join('\n')

  // noi chuoi = gop phan dau cua dong ke cuoi (khong them dong moi)
  const bl = banner.split('\n')
  if (lines.length) lines[lines.length - 1].t += bl[0]
  else lines.push({ t: bl[0], from: '(banner)', n: 0 })
  for (let i = 1; i < bl.length; i++) lines.push({ t: bl[i], from: '(banner)', n: 0 })

  // buoc 3: nhom dong rong lien tiep
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t !== '') { kept.push(lines[i]); continue }
    let j = i
    while (j < lines.length && lines[j].t === '') j++
    const L = j - i
    const keep = i === 0 ? (L > 2 ? 2 : L) : L > 1 ? 1 : L
    for (let k = 0; k < keep; k++) kept.push(lines[i + k])
    i = j - 1
  }

  // buoc 4: trimEnd() + '\n'
  while (kept.length && kept[kept.length - 1].t.trim() === '') kept.pop()
  if (kept.length) kept[kept.length - 1] = { ...kept[kept.length - 1], t: kept[kept.length - 1].t.replace(/\s+$/, '') }

  return { code: kept.map((l) => l.t).join('\n') + '\n', origin: kept }
}

export function build(target) {
  const { code } = assemble(target)
  mkdirSync(DIST, { recursive: true })
  writeFileSync(join(DIST, TARGETS[target].file), code, 'utf8')

  const warnings = lint(code, TARGETS[target].file)
  console.log(`  OK  ${TARGETS[target].file.padEnd(20)} ${code.split('\n').length} dong`)
  warnings.slice(0, 12).forEach((w) => console.log(`      !  ${w}`))
  if (warnings.length > 12) console.log(`      !  ... va ${warnings.length - 12} canh bao nua`)
  return warnings.length
}

export const args = process.argv.slice(2)

// Chay truc tiep moi build. `import` (npm test) thi chi lay ham ra dung.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const only = args.filter((a) => !a.startsWith('--'))
  const targets = only.length ? only : Object.keys(TARGETS)

  let bad = 0
  for (const t of targets) {
    if (!TARGETS[t]) {
      console.error(`  Khong biet target "${t}"`)
      process.exit(1)
    }
    bad += build(t)
  }

  if (args.includes('--watch')) {
    const dirs = [...new Set([...Object.values(TARGETS).map((t) => join(ROOT, 'pine', t.dir)), SHARED])]
    console.log('\nDang theoi doi ' + dirs.map((d) => d.slice(ROOT.length + 1)).join(' + ') + ' ... (Ctrl+C de dung)\n')
    for (const dir of dirs)
      watch(dir, (_e, file) => {
        if (!file?.endsWith('.pine')) return
        console.log(`> ${file} thay doi`)
        for (const t of targets) build(t)
      })
  }

  process.exit(bad > 0 ? 2 : 0)
}
