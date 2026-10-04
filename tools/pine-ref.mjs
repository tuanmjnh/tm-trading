#!/usr/bin/env node
// =============================================================================
//  TM TRADING - PINE REFERENCE BUILDER
//  Sinh tools/pine-ref.json = NGUON CHAN LY cho lint trong build.mjs.
//
//  Tai du lieu ngon ngu Pine v6 tu folknor/pine-tools (du lieu sinh tu tai lieu
//  chinh thuc TradingView, khong doi hinh), giam bo description/examples de
//  chi giu phan lint can dung.
//
//  Usage:
//    node tools/pine-ref.mjs           # fetch lai va ghi tools/pine-ref.json
//
//  Bo sung nguon doi chieu (da duoc verify truoc khi dua vao rule):
//    https://github.com/codenamedevan/pinescriptv6
//      pinescriptv6_complete_reference.md (403KB, 862 muc)
//  - ta.cog / ta.rci / request.quandl / ta.obv / ta.tr: TON TAI that
//      (cong cu truoc do dua vao FAKE_NAMES la SAI)
//  - table.cell_clear / input.timezone / ta.pivot / ta.hhv / ta.llv / ta.pmf /
//    ta.pwma / line.set_xy / color.gradient / request.alert / symbol.* /
//    shape.triangle_down / position.center_left / ta.ad / ta.normalize /
//    ta.trix / ta.trima / table.remove / str.isequal / label.set_bgcolor:
//    KHONG ton tai
// =============================================================================

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tools', 'pine-ref.json')

const REPO = 'folknor/pine-tools'
const REF = 'main'
const BASE = `https://raw.githubusercontent.com/${REPO}/${REF}/pine-data/v6`
const FILES = ['functions', 'keywords', 'variables', 'constants']

async function fetchJson(name) {
  const url = `${BASE}/${name}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`)
  return { url, data: await res.json() }
}

// Giam thanh ghi: chi giu phan lint can (ten + tham so + kieu + kieu tra ve).
// `params/types` la CHU KY GOP (union) cua tat ca cac overload -> dung cho
// kiem tra ten tham so truyen bang ten (khong bao gio loi nham).
// `sigs` = tung chu ky RIENG (chi co khi ham co overload) -> dung cho cac luat
// dua vao VI TRI tham so (int, offset, tham so dau tien). Neu khong tach rieng thi
// box.new/line.new/label.new se bi doc sai vi tri (vi du box.new o vi tri 4 la
// `border_width` (int) theo chu ky point nhung la `bottom` (float) theo chu ky x/y).
function slimFunctions(list) {
  const out = {}
  for (const f of list) {
    const entry = {
      params: (f.parameters || []).map((p) => p.name),
      types: (f.parameters || []).map((p) => p.type),
      returns: f.returns || '',
    }
    if (f.overloads?.length) {
      entry.sigs = f.overloads.map((o) => ({
        params: (o.parameters || []).map((p) => p.name),
        types: (o.parameters || []).map((p) => p.type),
      }))
    }
    out[f.name] = entry
  }
  return out
}

async function main() {
  const got = {}
  for (const name of FILES) {
    const { url, data } = await fetchJson(name)
    got[name] = { url, data }
    console.log(`  ok   ${name}.json  ${data.length} muc`)
  }

  const ref = {
    source: {
      repo: `https://github.com/${REPO}`,
      path: 'pine-data/v6',
      ref: REF,
      retrieved: new Date().toISOString().slice(0, 10),
      files: Object.fromEntries(FILES.map((n) => [n, got[n].url])),
      counts: Object.fromEntries(FILES.map((n) => [n, got[n].data.length])),
      crossCheckedWith: 'https://github.com/codenamedevan/pinescriptv6 (pinescriptv6_complete_reference.md)',
    },
    functions: slimFunctions(got.functions.data),
    keywords: got.keywords.data.map((k) => k.name),
    variables: got.variables.data.map((v) => v.name),
    constants: got.constants.data.map((c) => c.name),
  }

  writeFileSync(OUT, JSON.stringify(ref, null, 1) + '\n', 'utf8')
  const size = readFileSync(OUT, 'utf8').length
  console.log(`  ok   tools/pine-ref.json  ${(size / 1024).toFixed(1)} KB`)
  console.log(
    `       ${Object.keys(ref.functions).length} ham, ${ref.keywords.length} tu khoa, ` +
      `${ref.variables.length} bien, ${ref.constants.length} hieu so`,
  )
}

if (existsSync(OUT) && process.argv.includes('--check')) {
  const cur = JSON.parse(readFileSync(OUT, 'utf8'))
  console.log(`pine-ref.json hien tai: ${Object.keys(cur.functions).length} ham (ngay ${cur.source.retrieved})`)
} else {
  await main()
}
