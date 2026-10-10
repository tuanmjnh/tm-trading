#!/usr/bin/env node
// =============================================================================
//  TM TRADING — audit: how many `positions` docs carry a TP ladder that
//  `exec/paper.mjs sanitizeTps()` would REJECT (null / non-number / non-finite /
//  <= 0 levels), plus rows whose `sl` the exit scan refuses.
//  An AUDIT, not a gate: it measures the dirty-data backlog so the fix can be
//  sized — exit 0 whether it finds dirt or not. Mongo down -> loud SKIP (nothing
//  audited), per repo fail-soft convention.
//
//  Run: node tools/audit-tps.mjs   [--json]
// =============================================================================
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { loadEnv, ROOT } from '../exec/env.mjs'
import { sanitizeTps } from '../exec/paper.mjs'

loadEnv()

const out = (obj) => console.log(JSON.stringify(obj, null, 2))

async function main() {
  const started = Date.now()
  let m = null
  try {
    const db = await import('../engine/db.mjs')
    const conn = await db.connectMongo()
    if (!conn) {
      out({ ok: true, audited: false, reason: 'mongo-unavailable: SKIP — nothing was audited, run again when Mongo is up' })
      process.exit(0)
    }
    const { Position } = await import('../engine/models/index.mjs')
    m = { Position }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, audited: false, error: e?.message || String(e) }))
    process.exit(1)
  }

  const rows = await m.Position.find({}).lean()
  const tpsBuckets = new Map()
  const samples = []
  const push = (kind, row) => {
    tpsBuckets.set(kind, (tpsBuckets.get(kind) ?? 0) + 1)
    if (samples.length < 15) {
      samples.push({
        id: String(row._id), symbol: row.symbol, status: row.status, source: row.source,
        entryTime: row.entryTime ? new Date(row.entryTime).toISOString() : null,
        tps: row.tps, sl: row.sl, defect: kind,
      })
    }
  }

  let dirty = 0
  let openDirty = 0
  for (const p of rows) {
    const r = sanitizeTps(p.tps)
    if (!r.ok) {
      dirty++
      if (p.status === 'open') openDirty++
      const idx = r.index === null || r.index === undefined ? 'missing' : `tps[${r.index}]`
      push(`${idx}:${r.reason}`, p)
    }
  }
  // Same defect class, second field: findFirstExit refuses sl <= 0 on the exit scan.
  let badSl = 0
  let openBadSl = 0
  for (const p of rows) {
    const sl = Number(p.sl)
    if (!(Number.isFinite(sl) && sl > 0)) {
      badSl++
      if (p.status === 'open') openBadSl++
    }
  }

  const byStatus = {}
  for (const p of rows) byStatus[p.status ?? '?'] = (byStatus[p.status ?? '?'] ?? 0) + 1

  const summary = {
    ok: true,
    audited: true,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    scanned: rows.length,
    byStatus,
    tps: { dirty, openDirty, byDefect: Object.fromEntries(tpsBuckets) },
    sl: { invalid: badSl, openInvalid: openBadSl },
    samples,
  }
  writeFileSync(join(ROOT, 'logs', 'tps-audit.json'), JSON.stringify(summary, null, 2) + '\n')
  out({ ...summary, log: 'logs/tps-audit.json' })
  process.exit(0)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) await main()