#!/usr/bin/env node
// =============================================================================
//  TM TRADING — docs:check: docs ↔ reality consistency gate (docs/data-model.md,
//  AGENTS.md, README.md must describe the repo that actually exists).
//
//  It blocks exactly the class of error this repo just survived: docs claiming
//  `npm run test:stamp` (or any script / file) that no longer — or never —
//  existed. Three cheap deterministic checks, no LLM, no network:
//
//    1. every `npm run <script>` referenced in docs exists in package.json
//    2. every `node <file>`-style backticked file path in docs exists on disk
//    3. every `test:*` script runs a file that exists (same class, other side)
//
//  Run: npm run docs:check   (wired into `npm run verify`)
// =============================================================================
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const scripts = new Set(Object.keys(pkg.scripts ?? {}))

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// Docs that describe the repo (CLAUDE.md points at AGENTS.md, still scanned).
const docFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md', '.agents/AGENTS.md']
for (const f of readdirSync(join(ROOT, 'docs'))) {
  if (f.endsWith('.md')) docFiles.push(`docs/${f}`)
}
const read = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8') } catch { return null }
}

// --- Rule 1: every `npm run X` in docs names a real script -------------------
const runRe = /\bnpm\s+run\s+([A-Za-z][\w:.-]*)/g
for (const rel of docFiles) {
  const text = read(rel)
  if (text === null) continue
  const seen = new Set()
  for (const m of text.matchAll(runRe)) {
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)
    check(`docs ${rel}: \`npm run ${name}\` exists in package.json`, scripts.has(name))
  }
}

// --- Rule 2: every backticked repo path in docs exists -----------------------
const ROOTS = new Set(['engine', 'exec', 'services', 'server', 'tools', 'app', 'ai', 'pine', 'tests', 'shared', 'types', 'i18n', 'docs'])
const GENERATED = ['pine/dist/', 'logs/', 'reports/', 'data/', '.nuxt/', '.output/', 'node_modules/']
// Remnants EXPLICITLY documented as belonging to tm-hub (not this repo) plus
// known directory listings (docs describe trees, not files).
const EXCEPTIONS = new Set([
  'app/pages/admin/apps/[id]/import.vue', // app-inheritance: tm-hub file deleted in batch 2 — cited as a cut record
  'app/components/admin/import/*', // same: tm-hub batch-2 cut record (glob, not a path anyway)
  'app/composables/admin/useAdminImport.ts', // same: tm-hub batch-2 cut record
  'types/vue-draggable-resizable.d.ts', // app-inheritance: type shim deleted with its dep in batch 4
  'tests/mail-config.test.ts', // app-inheritance: tm-hub test deleted in batch 1
  'tools/notify/server.mjs', // roadmap Phase 1: MOVED to server/webhook.mjs (a move record, not a claim)
  // quotes of tm-hub commands, not this repo's scripts
  'TM Signals BTC.pine', // pine/dist output named by human-facing titles (spaces), not paths
])
const pathRe = /`([A-Za-z][\w./-]*\.(?:mjs|cjs|js|mts|ts|vue|py|md|json|pine))`/g
for (const rel of docFiles) {
  const text = read(rel)
  if (text === null) continue
  const seen = new Set()
  for (const m of text.matchAll(pathRe)) {
    const p = m[1]
    if (seen.has(p) || EXCEPTIONS.has(p)) continue
    seen.add(p)
    if (p.includes('*') || p.includes('<') || p.includes('>') || p.includes('[')) continue
    const root = p.split('/')[0]
    if (!ROOTS.has(root) || GENERATED.some((g) => p.startsWith(g))) continue
    check(`docs ${rel}: file \`${p}\` exists`, existsSync(join(ROOT, p)), `no such file`)
  }
}

// --- Rule 3: every `test:*` script runs a file that exists ------------------
for (const name of [...scripts].filter((s) => s === 'test' || s.startsWith('test:'))) {
  const cmd = pkg.scripts[name]
  const files = [...String(cmd).matchAll(/node\s+([A-Za-z][\w./-]*\.mjs)/g)].map((m) => m[1])
  if (!files.length) {
    check(`script \`${name}\` runs a node file`, false, JSON.stringify(cmd))
    continue
  }
  for (const f of files) check(`script \`${name}\` -> file \`${f}\` exists`, existsSync(join(ROOT, f)))
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)