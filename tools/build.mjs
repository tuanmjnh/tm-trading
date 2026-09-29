#!/usr/bin/env node
// =============================================================================
//  TM TRADING - ASSEMBLER
//  Pine Script khong ho tro #include nen day la "preprocessor".
//  Doc pine/parts/*.pine theo thu tu ten file -> ghep ra pine/dist/*.pine
//
//  Usage:
//    node tools/build.mjs            # build ca 2 target
//    node tools/build.mjs --watch    # tu dong build lai khi parts doi
//    node tools/build.mjs indicator  # chi build 1 target
// =============================================================================

import { readdirSync, readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS = join(ROOT, 'pine', 'parts')
const DIST = join(ROOT, 'pine', 'dist')

const TARGETS = {
  indicator: {
    file: 'tm-signals.pine',
    // Giu tren MOT dong: khai bao script la vi tri nhay parse, khong sua.
    decl: `indicator("TM Signals [v6]", "TM Signals", overlay = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
  },
  strategy: {
    file: 'tm-backtest.pine',
    decl: `strategy("TM Backtest [v6]", "TM Backtest", overlay = true, pyramiding = 0, calc_on_order_fills = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 1, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 0)`,
  },
}

// --- doc part theo thu tu ten file (00_, 10_, 20_ ...) ---
function readParts() {
  return readdirSync(PARTS)
    .filter((f) => f.endsWith('.pine'))
    .sort()
    .map((f) => ({ name: f, src: readFileSync(join(PARTS, f), 'utf8').replace(/\r\n/g, '\n') }))
}

// --- cat block theo marker // @part skip:<target> ---
function filterMarkers(src, target) {
  const out = []
  let skipping = false
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*\/\/\s*@part\s+skip:(\w+)/)
    if (m) {
      skipping = m[1] === target
      continue
    }
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

// --- kiem tra nhe: indent, ngoac, ham khong ton tai, tham so sai thu tu ---
//
//  TradingView khong bao gio dung offline nen 2 loi nay phai bat bang tay:
//    - goi ham Pine khong ton tai (vd input.timezone) -> CE10271
//    - truyen tham so theo thu tu cho ham co offset o vi tri 6 (plotshape/plot) -> CE10271
//
//  QUY TAC BOI BUILTINS:
//    Day chi la DANH SACH HAM (ten di kem "(") - gom ca phep ep kieu int/float/bool/string/color.
//    Khong dua hao so/ky hieu (color.red, shape.triangleup, position.top_right, size.tiny...)
//    vi lint khong bao gio doi chieu chung voi dang "ten(" - dua vao chi tao cam gia la
//    "da kiem chung".
//    Moi ten them vao PHAI dang ky tai https://www.tradingview.com/pine-script-reference/v6/
//    roi moi chen. Ten nao chua ky -> de ngoai de lint bao, dung im lap lai loi CE10271
//    (van de da xay ra voi table.cell_clear).
const BUILTINS = new Set(`
array.clear array.copy array.from array.get array.indexof array.insert array.join array.new
array.pop array.push array.remove array.reverse array.shift array.size array.slice array.sort array.sum
box.new box.delete box.set_bgcolor box.set_border_color box.set_border_style box.set_border_width
box.set_left box.set_right box.set_lefttop box.set_rightbottom box.set_top box.set_bottom box.set_extend
box.set_text box.set_text_color box.set_text_font_family box.set_text_size box.set_text_halign box.set_text_valign
color.new color.rgb color.from_gradient
input.bool input.color input.float input.int input.price input.session input.string input.symbol
input.text_area input.timeframe
label.new label.delete label.set_x label.set_y label.set_xy label.set_text label.set_color
label.set_bgcolor label.set_textcolor label.set_style label.set_size label.set_tooltip label.set_textalign
line.new line.delete line.set_xy1 line.set_xy2 line.set_x1 line.set_x2 line.set_y1 line.set_y2
line.set_color line.set_style line.set_width line.set_extend line.set_first_point line.set_second_point
linefill.new linefill.delete linefill.set_color
math.abs math.acos math.asin math.atan math.avg math.ceil math.cos math.exp math.floor math.log
math.log10 math.max math.min math.pow math.random math.round math.sign math.sin math.sqrt math.sum
math.todegrees math.toradians matrix.new matrix.get matrix.set matrix.add_row matrix.add_col
matrix.fill matrix.copy matrix.transpose max_bars_back
plot plotchar plotarrow plotbar plotcandle plotshape hline fill bgcolor
request.security request.security_lower_tf request.dividends request.earnings request.splits
str.contains str.endswith str.format str.format_time str.isequal str.length str.lower str.match
str.pos str.repeat str.replace str.replace_all str.split str.substring str.tostring str.trim str.upper
strategy.cancel strategy.cancel_all strategy.close strategy.close_all strategy.entry strategy.exit
strategy.order
ta.ad ta.atr ta.bb ta.bbw ta.cci ta.change ta.correlation ta.crossover ta.crossunder ta.cum ta.dmi
ta.ema ta.highest ta.highestbars ta.hma ta.kc ta.kcw ta.lowest ta.lowestbars ta.macd ta.median ta.mfi
ta.mom ta.normalize ta.obv ta.percentrank ta.pivothigh ta.pivotlow ta.rma ta.roc ta.rsi ta.sar ta.sma
ta.stdev ta.stoch ta.supertrend ta.tr ta.trix ta.trima ta.tsi ta.variance ta.vwap ta.vwma ta.wma
ta.wpr timeframe.change timeframe.in_seconds
table.new table.cell table.clear table.delete table.merge_cells table.remove table.set_bgcolor
table.set_border_color table.set_border_width table.set_position
alert alertcondition log.info log.warning log.error
int float bool string color
`.trim().split(/\s+/))

// Vi tri (bat dau tu 1) cua tham so `offset` - lay NGUYEN chu ky chinh thuc:
//   plot      (series, title, color, linewidth, style, trackprice, histbase, offset, ...) -> 8
//   plotchar  (series, title, char, location, color, offset, ...)                          -> 6
//   plotshape (series, title, style, location, color, offset, ...)                         -> 6
//   plotarrow (series, title, colorup, colordown, offset, ...)                             -> 5
//   plotbar / plotcandle KHONG co tham so offset (dau vao la OHLC) -> khong dua vao day.
// Nguon:
//   https://www.tradingview.com/pine-script-docs/visuals/plots/
//   https://www.tradingview.com/pine-script-docs/visuals/text-and-shapes/
//   https://www.tradingview.com/pine-script-docs/visuals/bar-plotting/
// Canh bao khi so tham so theo thu tu >= vi tri nay: tham so o vi tri do da roi vao
// `offset` ma khong phai gia tri nguoi viet mong doi. Hay truyen bang TEN tham so.
const POSITIONAL_RISK = new Map([
  ['plot', 8],
  ['plotchar', 6],
  ['plotarrow', 5],
  ['plotshape', 6],
])

// Tu khoa / toan tu cua Pine - khong phai la loi goi ham.
const KEYWORDS = new Set(`
na nz and or not if else for while to switch var varip export import type method enum true false
break continue by parens series simple const input
open high low close volume hl2 hlc3 ohlc4 hlcc4 bar_index last_bar_index time
overlay scale shape location display text
`.trim().split(/\s+/))

// --- che comment VA noi dung chuoi, giu nguyen so dong ---
// Khong lam vay thi regex se khop nhau nham trong text tieng Viet trong input.label
// (vd "Chỉ tín hieu tren nen da dong (" -> nham la goi ham "dong(").
// Cac tham so trong ham ta.* yeu cau SIMPLE INT (so chu ky / do dai).
// Truyen bien series float se bi bao CE10123.
// Gia tri = vi tri tham so (bat dau tu 0).
const INT_PARAMS = {
  'ta.atr': [0],
  'ta.ema': [1],
  'ta.sma': [1],
  'ta.rsi': [1],
  'ta.bb': [1],
  'ta.bbw': [1],
  'ta.stdev': [1],
  'ta.kc': [1],
  'ta.kcw': [1],
  'ta.mom': [1],
  'ta.roc': [1],
  'ta.cci': [1],
  'ta.mfi': [1],
  'ta.dmi': [0, 1],
  'ta.macd': [1, 2],
  'ta.stoch': [4, 5, 6],
  'ta.supertrend': [1],
  'ta.tsi': [1, 2],
  'ta.wma': [1],
  'ta.vwma': [1],
  'ta.hma': [1],
  'ta.cog': [1],
  'ta.tr': [],
}

// Bien duoc gan tu input.int / input.timeframe / so nguyen / phep tinh tren bien int
function intVars(code) {
  const out = new Set()
  for (const line of code.split('\n')) {
    const m = line.match(/^\s*(\w+)\s*(?::=|=(?!=))\s*(.+)$/)
    if (!m) continue
    const [, name, rhs] = m
    const isInt =
      /^input\.(int|timeframe)\(/.test(rhs.trim()) ||
      /^\d+(\s*[-+*]\s*\d+)*\s*$/.test(rhs.trim()) ||
      [...rhs.matchAll(/\b(\w+)\b/g)].some((x) => out.has(x[1]))
    if (isInt) out.add(name)
  }
  return out
}

// Ten tham so hop le cua ham Pine v6. Tru ten sai -> CE10120.
// Chi kiem tra nhung ham co nam trong bang; ham ngoai bang thi bo qua.
const PARAM_NAMES = {
  'table.new': 'position, columns, rows, bgcolor, frame_color, frame_width, border_color, border_width, force_overlay',
  'table.cell': 'table_id, column, row, text, width, height, text_color, text_halign, text_valign, text_size, tooltip, bgcolor, text_font_family, text_formatting, text_wrap, force_overlay',
  'table.clear': 'table_id, start_column, start_row, end_column, end_row',
  'table.delete': 'table_id',

  'box.new': 'left, top, right, bottom, border_color, border_width, border_style, border_radius, extend, xloc, bgcolor, text, text_size, text_color, text_halign, text_valign, text_font_family, tooltip, text_formatting, force_overlay',
  'box.set_lefttop': 'id, left, top',
  'box.set_rightbottom': 'id, right, bottom',
  'box.set_border_color': 'id, color',
  'box.set_bgcolor': 'id, color',
  'box.set_border_width': 'id, border_width',
  'box.delete': 'id',

  'line.new': 'x1, y1, x2, y2, xloc, extend, color, style, width, force_overlay',
  'line.set_xy1': 'id, x1, y1',
  'line.set_xy2': 'id, x2, y2',
  'line.set_color': 'id, color',
  'line.delete': 'id',

  'label.new': 'x, y, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip, text_font_family, force_overlay',
  'label.set_xy': 'id, x, y',
  'label.set_text': 'id, text',
  'label.set_color': 'id, color',
  'label.set_textcolor': 'id, textcolor',
  'label.delete': 'id',

  plot: 'series, title, color, linewidth, style, trackprice, histbase, offset, join, editable, show_last, display, precision, force_overlay',
  plotshape: 'series, title, style, location, color, offset, text, textcolor, editable, size, show_last, display, format, precision, force_overlay',
  alert: 'message, freq',
  alertcondition: 'condition, title, message',

  'input.string': 'defval, title, options, group, tooltip, inline, confirm',
  'input.bool': 'defval, title, group, tooltip, inline, confirm',
  'input.int': 'defval, title, minval, maxval, step, group, tooltip, inline, confirm',
  'input.float': 'defval, title, minval, maxval, step, group, tooltip, inline, confirm',
  'input.color': 'defval, title, group, inline, confirm',
  'input.session': 'defval, title, days, group, tooltip, inline',
  'input.timeframe': 'defval, title, group, tooltip, inline',
  'input.symbol': 'defval, title, group, tooltip, inline',

  'request.security': 'symbol, timeframe, expression, gaps, lookahead',
  time: 'timeframe, session, timezone',
  'str.format_time': 'format, time, timezone',
  'str.tostring': 'value, format',
  'str.replace_all': 'source, target, replacement, occurrence',
  'str.format': 'pattern, values',

  'ta.supertrend': 'factor, atrPeriod',
  'ta.rsi': 'source, length',
  'ta.bb': 'source, length, mult',
  'ta.ema': 'source, length',
  'ta.sma': 'source, length',
  'ta.atr': 'length',
  'ta.lowest': 'source, length',
  'ta.highest': 'source, length',
  'ta.change': 'source, length',
  'ta.crossover': 'source1, source2',
  'ta.crossunder': 'source1, source2',
  'ta.pivotlow': 'source, leftbars, rightbars',
  'ta.pivothigh': 'source, leftbars, rightbars',

  'strategy.entry': 'id, direction, qty, limit, stop, oca_name, comment, alert_message, alert_profit, alert_loss, disable_alert',
  'strategy.close_all': 'comment, alert_message, immediately, disable_alert',
  'strategy.exit': 'id, from_entry, qty, qty_percent, comment, profit, loss, trail_price, trail_points, trail_offset, stop, limit, oca_name, comment_profit, comment_loss, comment_trailing, alert_message, alert_profit, alert_loss, alert_trailing, disable_alert, qty_percent_next, scale',

  'array.push': 'id, value',
  'array.shift': 'id',
  'array.size': 'id',
  'array.clear': 'id',
  'array.get': 'id, index',
  'array.set': 'id, index, value',
}

const PARAM_SET = new Map(Object.entries(PARAM_NAMES).map(([k, v]) => [k, new Set(v.split(',').map((s) => s.trim()))]))

// Nguon chung thuc (dang ky truoc khi them rule):
//   str.format_time(time, format, timezone) -> time la `series int`, dinh dang la string.
//   https://www.tradingview.com/pine-script-docs/concepts/time/
//   -> str.format_time("yyyy", time, "UTC") = CE10123 (literal string nhung can series int).
// Cach doc: ten bang = "ham co tham so dau PHAI la UNIX time, khong duoc la chuoi".
const ARG0_TIME_NOT_STRING = new Set(['str.format_time'])

// tach danh sach tham so cap nhat (bat dau ngay SAU dau '(')
function splitArgs(code, startIdx) {
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

  // Bien nao la simple int (de kiem tra tham so cua ta.*)
  const ints = intVars(code)

  // Moi noi goi ham, tach theo dau phay cap nhat + so doi tham so
  for (const m of code.matchAll(/([A-Za-z_][\w.]*)\s*\(/g)) {
    const fn = m[1]
    if (KEYWORDS.has(fn) || fn.startsWith('tm_') || fn.startsWith('f_') || locals.has(fn) || udts.has(fn)) continue
    const known = BUILTINS.has(fn) || ['indicator', 'strategy', 'library'].includes(fn)
    if (!known) {
      const line = code.slice(0, m.index).split('\n').length
      warnings.push(`${name}:${line} goi ham "${fn}" - khong co trong Pine v6?`)
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

    // tham so phai la simple int nhung lai truyen bien float -> CE10123
    const needInt = INT_PARAMS[fn]
    if (needInt) {
      for (const idx of needInt) {
        const a = args[idx]?.trim()
        if (!a || a.includes('=')) continue
        if (/^-?\d+$/.test(a)) continue
        const names = [...a.matchAll(/\b(\w+)\b/g)].map((x) => x[1])
        if (names.length && names.every((v) => ints.has(v))) continue
        warnings.push(`${name}:${line} ${fn}() tham so "${a}" phai la simple int (so chu ky), dang la bien float`)
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
  return src.replace('{{DECL}}', TARGETS[target].decl)
}

export function build(target) {
  const parts = readParts()
  const raw = parts.map((p) => filterMarkers(subst(p.src, target), target)).join('\n')

  // `//@version=6` bat buoc phai la dong dau tien -> banner dat sau no.
  const banner = [
    '',
    '// =============================================================================',
    '//  AUTO-GENERATED - DO NOT EDIT',
    `//  Target: ${target}`,
    '//  Source: pine/parts/*.pine   ->   node tools/build.mjs',
    `//  Built : ${new Date().toISOString()}`,
    '// =============================================================================',
  ].join('\n')

  const code = (raw + banner).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
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
    console.log('\nDang theoi doi pine/parts ... (Ctrl+C de dung)\n')
    watch(PARTS, (_e, file) => {
      if (!file?.endsWith('.pine')) return
      console.log(`> ${file} thay doi`)
      for (const t of targets) build(t)
    })
  }

  process.exit(bad > 0 ? 2 : 0)
}
