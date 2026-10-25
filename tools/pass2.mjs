// Temp: comprehensive second pass — replace ALL word-boundary occurrences of
// the renamed names across server code (defs already Server-prefixed; the
// word-boundary check never matches inside ServerX). Deletes itself.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const NAMES = [
  'ReplayPosition', 'ReplayOrder', 'ReplayOrderType', 'ReplayOrderStatus', 'ReplaySummary',
  'PermissionAction', 'LiveAccount', 'LivePositionFields', 'PaperAccountSummary',
  'MarketEventPublic', 'NewsSourcePublic', 'NewsDeskMeta', 'Instrument', 'InstrumentVenue',
  'Dataset', 'DatasetKind'
]

const EXTS = ['.ts', '.mjs']
function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (EXTS.some(x => e.endsWith(x))) out.push(p)
  }
  return out
}

let touched = 0
for (const file of walk('server')) {
  const src = readFileSync(file, 'utf8')
  let next = src
  for (const name of NAMES) {
    next = next.replace(new RegExp(`\\b${name}\\b`, 'g'), `Server${name}`)
  }
  if (next !== src) { writeFileSync(file, next); touched++; console.log('updated:', file) }
}
console.log('files:', touched)
