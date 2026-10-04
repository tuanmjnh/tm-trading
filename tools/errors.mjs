#!/usr/bin/env node
// =============================================================================
//  TM TRADING - TRADINGVIEW ERROR EXPLAINER
//  Danh text loi compile cua TradingView vao file, chay:
//
//    node tools/errors.mjs loi.txt                 # in bao cao
//    node tools/errors.mjs loi.txt --apply         # ghi cau loi vao tools/bad-snippets.json
//    node tools/errors.mjs loi.txt --target strategy
//    Get-Content loi.txt | node tools/errors.mjs   # doc stdin
//
//  TradingView chi bao "line N" tren FILE DIST (pine/dist/*.pine) - khong biet
//  file nao trong pine/parts/. Tool nay:
//    1. parse "line N: Col M" + ma loi CE#### trong text
//    2. doi dong dist ve part dung (lay origin tu build.assemble())
//    3. in doan ma + noi dung dung/le, va goi y nguoi sua
//    4. --apply: luu doan ma loi ra tools/bad-snippets.json de smoke.mjs
//      kiem tra loi nay khong quay lai (test 2 chieu)
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assemble } from './build.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const hasTarget = argv.includes('--target')
const targetArg = hasTarget ? argv[argv.indexOf('--target') + 1] : null
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--target')

// --- doc input (file hoac stdin) ---
let text = ''
if (files.length) {
  text = readFileSync(files[0], 'utf8')
} else if (!process.stdin.isTTY) {
  text = readFileSync(0, 'utf8')
}
if (!text.trim()) {
  console.error('khong co text loi - dan vao file roi chay: node tools/errors.mjs loi.txt')
  process.exit(1)
}

if (hasTarget && !['indicator', 'strategy', 'both', 'vsa'].includes(targetArg)) {
  console.error(`--target chi nhan indicator | strategy | vsa | both (nhan "${targetArg}")`)
  process.exit(1)
}

// --- 1. parse ---
// Cac dang gap that:
//   line 12: Col 5: khong tim thay ham "..."
//   Ln 12, Col 5 - CE10123: ...
//   CE10271 (khong ke vi tri - khong doi duoc ve dong, chi bao ma)
const RE_POS = /\b(?:line|Ln)\s*(\d+)\s*(?::\s*|,\s*)?(?:Col\s*(\d+))?/i
const RE_CE = /\bCE\d{4,6}\b/

const issues = []
const raw = text.split(/\r?\n/)
const used = new Set()
for (let i = 0; i < raw.length; i++) {
  const m = raw[i].match(RE_POS)
  if (!m) continue
  used.add(i)
  const block = [raw[i], raw[i + 1] ?? '', raw[i + 2] ?? ''].filter(Boolean)
  used.add(i + 1)
  used.add(i + 2)
  const ce = block.map((l) => l.match(RE_CE)).find(Boolean)
  issues.push({
    line: Number(m[1]),
    col: m[2] ? Number(m[2]) : null,
    ce: ce ? ce[0] : null,
    msg: raw[i].replace(RE_POS, '').replace(/^[:\s,-]+/, '').trim() || block.join(' | '),
  })
}
// ma loi khong ke vi tri -> khong doi duoc ve dong, chi bao ma
for (let i = 0; i < raw.length; i++) {
  if (used.has(i)) continue
  const ce = raw[i].match(RE_CE)
  if (ce) issues.push({ line: 0, col: null, ce: ce[0], msg: raw[i].trim() })
}
if (!issues.length) {
  console.error('khong parse duoc loi - can co "line N" hoac ma "CE####"')
  console.error('van de parse:\n' + text.slice(0, 500))
  process.exit(1)
}

// --- 2. doi dist -> part ---
const targets =
  targetArg && targetArg !== 'both'
    ? [targetArg]
    : ['indicator', 'strategy']
const asm = {}
for (const t of targets) asm[t] = assemble(t)

// chon target: neu text ro rang thi lay, khong ro thi in ca 2
function guessTarget() {
  if (targetArg && targetArg !== 'both') return [targetArg]
  if (/VSA Wyckoff|tm_sigSV|tm_sigBC|VSA ST LONG/i.test(text)) return ['vsa']
  if (/\bstrategy\.|Strategy Tester|initial_capital/i.test(text)) return ['strategy']
  if (/table\.new|dashboard|alertcondition/i.test(text)) return ['indicator']
  return ['indicator', 'strategy']
}
const chosen = guessTarget()

// Thu muc parts cua tung target: vsa nam o pine/parts-vsa, khong phai pine/parts.
// Truoc day hardcode 'parts' nen bao loi cua ban VSA luon tro sai duong dan.
const PARTS_DIR = { indicator: 'parts', strategy: 'parts', vsa: 'parts-vsa' }

function partPath(from, target) {
  // "x.pine" -> pine/<parts-dir>/x.pine ; "shared/x.pine" -> pine/shared/x.pine
  const dir = PARTS_DIR[target] || 'parts'
  return join(ROOT, 'pine', from.startsWith('shared/') ? from : join(dir, from))
}
function partLabel(from, target) {
  const dir = PARTS_DIR[target] || 'parts'
  return `pine/${from.startsWith('shared/') ? from : join(dir, from)}`
}

// --- 3. in bao cao ---
console.log(`parse duoc ${issues.length} loi: ${issues.map((x) => `${x.ce ?? 'CE?'}@${x.line || '?'}`).join(', ')}\n`)

const mapped = []
const printed = new Set()
for (const iss of issues) {
  if (!iss.line) {
    console.log(`--- ${iss.ce} (khong ke vi tri) - khong doi duoc ve dong`)
    console.log(`    ${iss.msg}\n`)
    continue
  }
  for (const t of chosen) {
    const { code, origin } = asm[t]
    const distLines = code.split('\n')
    if (iss.line > distLines.length) {
      console.log(`--- ${iss.ce ?? ''} line ${iss.line} vuot qua ${t} (${distLines.length} dong) - hay chay "npm run build" truoc\n`)
      continue
    }
    const o = origin[iss.line - 1]
    if (o.from === '(banner)') {
      console.log(`--- ${iss.ce ?? 'CE?'} line ${iss.line} nam trong banner tu dong (khong sua duoc)\n`)
      continue
    }
    const key = `${iss.ce}|${iss.line}|${o.from}|${o.n}`
    if (printed.has(key)) continue
    printed.add(key)
    const pp = partPath(o.from, t)
    const src = existsSync(pp) ? readFileSync(pp, 'utf8').replace(/\r\n/g, '\n').split('\n') : []
    const stmt = takeStatement(src, o.n)
    mapped.push({ ...iss, target: t, from: o.from, n: o.n, stmt })
    console.log(`--- ${iss.ce ?? 'CE?'}  (line ${iss.line}${iss.col ? `, col ${iss.col}` : ''} tren dist ${t})`)
    console.log(`    part : ${partLabel(o.from, t)}:${o.n}`)
    if (iss.msg) console.log(`    loi  : ${iss.msg}`)
    console.log('    ma   :')
    stmt.forEach((l, k) => console.log(`      ${String(o.n + k).padStart(4)} | ${l}`))
    console.log('')
  }
}

// Lay cau lenh (tu dong loi, tiep tuc den khi ngoac doi chieu)
function takeStatement(src, lineNo) {
  const start = Math.max(0, lineNo - 1)
  const out = []
  let depth = 0
  for (let i = start; i < Math.min(src.length, start + 12); i++) {
    const t = src[i]
    out.push(t)
    for (const c of t) {
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') depth--
    }
    if (depth <= 0 && i > start) break
    if (depth <= 0 && i === start && !/[,\[]\s*$/.test(t)) break
  }
  return out
}

// --- 4. --apply ---
if (apply) {
  if (!mapped.length) {
    console.log('khong doi duoc loi nao ve part -> khong ghi gi ca')
    process.exit(0)
  }
  const out = join(ROOT, 'tools', 'bad-snippets.json')
  const cur = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const seen = new Set(cur.map((s) => s.name))
  let added = 0
  for (const m of mapped) {
    const name = `${m.ce ?? 'CE?'} ${m.from}:${m.n}`
    if (seen.has(name)) continue
    seen.add(name)
    cur.push({
      name,
      from: partLabel(m.from, m.target),
      line: m.n,
      expect: m.ce,
      code: `//@version=6\nindicator("x")\n${m.stmt.join('\n')}\n`,
    })
    added++
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(cur, null, 2) + '\n', 'utf8')
  console.log(`da ghi ${added} cau moi vao tools/bad-snippets.json (total ${cur.length})`)
  console.log('chay "npm test" de dam bao loi nay khong quay lai')
}
