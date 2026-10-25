// Temp: tm-trading — rename server-side duplicate type definitions (Server
// prefix) and rewrite their import sites across server code. Deletes itself.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

// name -> defining server file
const RENAMES = {
  ReplayPosition: 'server/utils/replayBroker.ts',
  ReplayOrder: 'server/utils/replayBroker.ts',
  ReplayOrderType: 'server/utils/replayBroker.ts',
  ReplayOrderStatus: 'server/utils/replayBroker.ts',
  ReplaySummary: 'server/utils/replaySessions.ts',
  PermissionAction: 'server/types/permission.ts',
  LiveAccount: 'server/utils/livePositions.ts',
  LivePositionFields: 'server/utils/livePositions.ts',
  PaperAccountSummary: 'server/utils/paperAccount.ts',
  MarketEventPublic: 'server/utils/newsStore.ts',
  NewsSourcePublic: 'server/utils/newsStore.ts',
  NewsDeskMeta: 'server/utils/newsStore.ts',
  Instrument: 'server/utils/instruments.ts',
  InstrumentVenue: 'server/utils/instruments.ts',
  Dataset: 'server/utils/dataCenter.ts',
  DatasetKind: 'server/utils/dataCenter.ts'
}

const serverFiles = walk('server')

// 1) rename definitions in the defining file
for (const [name, defFile] of Object.entries(RENAMES)) {
  const src = readFileSync(defFile, 'utf8')
  const re = new RegExp(`export (interface|type) ${name}([ =:{])`, 'g')
  const next = src.replace(re, `export $1 Server${name}$2`)
  if (next !== src) { writeFileSync(defFile, next); console.log(`def renamed: ${name} in ${defFile}`) }
}

// 2) rewrite import identifiers + usages in ALL server files (except shared/)
//    Only touch: import statements FROM the defining file, and bare identifier
//    usages that resolve to it. To stay safe, rewrite per-name with word
//    boundaries across server files that import it explicitly.
let touched = 0
for (const file of serverFiles) {
  if (Object.values(RENAMES).includes(file) === false && !/from '(\.\.\/)+|(from '#server)/.test(readFileSync(file, 'utf8'))) continue
  let src = readFileSync(file, 'utf8')
  let changed = false
  for (const [name, defFile] of Object.entries(RENAMES)) {
    if (file === defFile) continue
    const rel = file.replace(/\\/g, '/')
    // does this file import the name from the defining file (relative path)?
    const base = defFile.replace(/^server\//, '').replace(/\.ts$/, '')
    const depth = rel.split('/').length - 1 - 1 // server/<rest>
    const dots = '../'.repeat(rel.replace('server/', '').split('/').length - 1)
    const importRe = new RegExp(`from '(${dots})${base}'`)
    if (!importRe.test(src)) continue
    const wordRe = new RegExp(`\\b${name}\\b`, 'g')
    const next = src.replace(wordRe, `Server${name}`)
    if (next !== src) { src = next; changed = true }
  }
  if (changed) { writeFileSync(file, src); touched++; console.log('imports/usages updated:', file) }
}
console.log('server files touched:', touched)
