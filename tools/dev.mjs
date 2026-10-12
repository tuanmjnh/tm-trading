#!/usr/bin/env node
// =============================================================================
//  TM TRADING — developer CLI (roadmap §44 "CLI / Developer Commands").
//
//  One entry point for the framework-free maintenance commands the roadmap
//  lists. Every command does REAL work over the existing engine / market /
//  simulation / service modules — nothing is faked, and no command ever
//  connects to a real-money account (§44, §2.1: simulation-first).
//
//    market:catalog    canonical instrument catalog summary (§7, §30.1)
//    market:status     probe each venue REST endpoint for reachability (§40.1)
//    market:once       one bounded realtime ingestion window + quality report
//    market:watch      continuous ingestion, periodic status (Ctrl-C to stop)
//    indicator:test    structural self-test of the indicator registry (§11)
//    indicator:parity  run the Pine golden-parity fixtures (engine/test.mjs)
//    terminal:dev      start the dashboard/terminal dev server (port 4001)
//    paper:status      paper account projection from Mongo (§20)
//    paper:watch       poll the paper account projection
//    replay:create     materialize a deterministic replay input file (§22)
//    replay:run        deterministically replay closed bars (§22, §42.5)
//    replay:test       run the simulation/replay suite (§22, §42.5)
//    research:once     run the AI research/review pass once (§27)
//
//  Run: npm run <command>   (scripts use `node --import tsx` for the .ts catalog)
//       node tools/dev.mjs <command> [--flags]
// =============================================================================
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INDICATORS, calculateIndicator } from '../engine/indicators.mjs'
import { createReplayPlayer, normalizeReplayBars } from '../simulation/replay.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- argument parsing (pure, unit-tested) -----------------------------------
/**
 * Parse `--flag=value`, `--flag value` and boolean `--flag` into a flags map;
 * everything else is a positional. Kept dependency-free so it is testable.
 */
export function parseArgs(argv = []) {
  const positionals = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i])
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        const key = a.slice(2)
        const next = argv[i + 1]
        if (next !== undefined && !String(next).startsWith('--')) {
          flags[key] = String(next)
          i++
        } else {
          flags[key] = true
        }
      }
    } else {
      positionals.push(a)
    }
  }
  return { positionals, flags }
}

const int = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : d
}
const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const json = (o) => JSON.stringify(o, null, 2)

// --- pure helpers (unit-tested in tests/dev-cli.test.ts) --------------------

/** Roll the catalog up by type / status / venue for `market:catalog`. */
export function catalogSummary(instruments = []) {
  const byType = {}
  const byStatus = {}
  const byVenue = {}
  for (const it of instruments) {
    byType[it.type ?? 'unknown'] = (byType[it.type ?? 'unknown'] ?? 0) + 1
    byStatus[it.status ?? 'unknown'] = (byStatus[it.status ?? 'unknown'] ?? 0) + 1
    for (const v of it.venues ?? []) byVenue[v.venue] = (byVenue[v.venue] ?? 0) + 1
  }
  return { total: instruments.length, byType, byStatus, byVenue }
}

/** Deterministic, dependency-free bar series for the indicator self-test. */
export function syntheticBars(n, { base = 100 } = {}) {
  const bars = []
  for (let i = 0; i < n; i++) {
    const open = base + Math.sin(i / 5) * 2 + i * 0.1
    const close = open + Math.cos(i / 3)
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - 0.5
    bars.push({ openTime: i * 60_000, closeTime: (i + 1) * 60_000, open, high, low, close, volume: 10 + (i % 7) })
  }
  return bars
}

/**
 * Structural acceptance for every indicator definition (§11.3 contract):
 * the calculate() output must expose exactly the declared outputs, each an
 * array aligned to the input length with at least one finite value. This
 * catches an output-key rename, an off-by-one alignment or a definition whose
 * series is entirely null — without asserting numeric values (the golden
 * parity fixtures do that, see indicator:parity).
 */
export function indicatorSelfTest({ only = null } = {}) {
  const results = []
  for (const def of INDICATORS) {
    if (only && def.id !== only) continue
    const errors = []
    const bars = syntheticBars((def.warmup || 0) + 40)
    let out = null
    try {
      out = calculateIndicator(def.id, bars)
    } catch (e) {
      errors.push(`threw: ${e?.message || e}`)
    }
    if (out) {
      const want = def.outputs.map((o) => o.key)
      const got = Object.keys(out)
      if (got.length !== want.length) errors.push(`output count ${got.length} != ${want.length}`)
      for (const o of def.outputs) {
        const series = out[o.key]
        if (!Array.isArray(series)) {
          errors.push(`${o.key} is not an array`)
          continue
        }
        if (series.length !== bars.length) errors.push(`${o.key} length ${series.length} != ${bars.length}`)
        if (!series.some((v) => Number.isFinite(v))) errors.push(`${o.key} has no finite values`)
      }
    }
    results.push({ id: def.id, version: def.version, kind: def.kind, warmup: def.warmup, ok: errors.length === 0, errors })
  }
  const pass = results.filter((r) => r.ok).length
  return { results, pass, fail: results.length - pass, total: results.length }
}

/** Content hash of a played bar sequence — proves replay determinism (§42.5). */
export function digestEvents(events = []) {
  const h = createHash('sha256')
  for (const e of events) h.update(`${e.openTime}:${e.open}:${e.high}:${e.low}:${e.close}:${e.volume};`)
  return h.digest('hex')
}

// --- command helpers --------------------------------------------------------

function runChild(cmd, args, { shell = false } = {}) {
  return new Promise((resolveCode) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell })
    child.on('close', (code) => resolveCode(code ?? 1))
    child.on('error', (e) => {
      console.error(`dev: cannot run ${cmd} — ${e?.message || e}`)
      resolveCode(1)
    })
  })
}

async function loadCatalog() {
  try {
    return await import('../server/utils/instruments.ts')
  } catch (e) {
    throw new Error(`cannot load the instrument catalog (run via an npm script that uses tsx): ${e?.message || e}`)
  }
}

// --- market:catalog ---------------------------------------------------------

async function cmdMarketCatalog(flags) {
  const cat = await loadCatalog()
  const venue = typeof flags.venue === 'string' ? flags.venue : null
  const type = typeof flags.type === 'string' ? flags.type : null
  const status = typeof flags.status === 'string' ? flags.status : null
  const rows = cat.INSTRUMENTS.filter(
    (it) => (!venue || (it.venues ?? []).some((v) => v.venue === venue)) && (!type || it.type === type) && (!status || it.status === status)
  )
  const summary = catalogSummary(rows)
  if (flags.json) {
    console.log(json({ summary, venues: cat.VENUE_IDS, instruments: rows }))
    return 0
  }
  console.log(`market:catalog — ${summary.total} instruments`)
  console.log(`  venues : ${Object.entries(summary.byVenue).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`)
  console.log(`  types  : ${Object.entries(summary.byType).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`)
  console.log(`  status : ${Object.entries(summary.byStatus).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`)
  for (const it of rows) {
    const vs = (it.venues ?? []).map((v) => `${v.venue}:${v.native}`).join(' ')
    console.log(`  ${it.id.padEnd(26)} ${it.type.padEnd(6)} ${vs}`)
  }
  return 0
}

// --- market:status ----------------------------------------------------------

const VENUE_PING = {
  binance: 'https://fapi.binance.com/fapi/v1/ping',
  bybit: 'https://api.bybit.com/v5/market/time',
  okx: 'https://www.okx.com/api/v5/public/time'
}

async function pingVenue(url, timeoutMs) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { signal: ac.signal })
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : e?.message || String(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function cmdMarketStatus(flags) {
  const timeoutMs = int(flags.timeout, 5000)
  const results = {}
  await Promise.all(
    Object.entries(VENUE_PING).map(async ([venue, url]) => {
      results[venue] = await pingVenue(url, timeoutMs)
    })
  )
  if (flags.json) {
    console.log(json(results))
  } else {
    console.log(`market:status — venue REST reachability (timeout ${timeoutMs}ms)`)
    for (const [venue, r] of Object.entries(results)) {
      console.log(`  ${venue.padEnd(8)} ${r.ok ? 'up  ' : 'down'} ${String(r.ms).padStart(5)}ms${r.ok ? '' : `  ${r.error ?? `HTTP ${r.status}`}`}`)
    }
  }
  const down = Object.values(results).filter((r) => !r.ok).length
  return flags.strict && down > 0 ? 1 : 0
}

// --- market:once / market:watch --------------------------------------------

async function ingestWindow({ symbols, timeframes, market, seconds, label }) {
  const mod = await import('../market/index.mjs')
  const { evaluateQuality } = await import('../market/quality.mjs')
  const provider = mod.createBinanceProvider({ market, symbols })
  const plane = mod.createMarketPlane({ symbols, timeframes, source: 'trades', provider })
  const counts = {}
  for (const topic of Object.values(mod.TOPICS)) plane.bus.on(topic, () => { counts[topic] = (counts[topic] ?? 0) + 1 })
  console.log(`${label} — ${symbols.join(',')} · tf ${timeframes.join(',')} · ${seconds}s`)
  plane.start()
  await sleep(seconds * 1000)
  plane.stop()
  const stats = plane.stats()
  const quality = evaluateQuality({ status: stats.monitor })
  return { stats, quality, counts }
}

function printIngest({ stats, quality, counts }, flags) {
  if (flags.json) {
    console.log(json({ stats, quality, counts }))
    return
  }
  console.log(`  routed=${stats.routed} futureDropped=${stats.futureDropped} unknownTopic=${stats.unknownTopic}`)
  console.log(`  events  : ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ') || 'none'}`)
  console.log(`  quotes  : ${json(stats.quotes)}`)
  console.log(`  latency : p50=${quality.latency.p50 ?? '—'} p95=${quality.latency.p95 ?? '—'} max=${quality.latency.max ?? '—'} samples=${quality.latency.samples}`)
  console.log(`  verdict : ${quality.verdict}${quality.suspect.length ? ` — ${json(quality.suspect)}` : ''}`)
}

async function cmdMarketOnce(flags) {
  const symbols = csv(flags.symbols) ?? ['BTCUSDT']
  const timeframes = csv(flags.timeframes) ?? ['1m']
  const result = await ingestWindow({
    symbols,
    timeframes,
    market: typeof flags.market === 'string' ? flags.market : 'fapi',
    seconds: int(flags.seconds, 20),
    label: 'market:once'
  })
  printIngest(result, flags)
  return 0
}

async function cmdMarketWatch(flags) {
  const symbols = csv(flags.symbols) ?? ['BTCUSDT']
  const timeframes = csv(flags.timeframes) ?? ['1m']
  const windowSec = int(flags.window, 30)
  const result = await ingestWindow({
    symbols,
    timeframes,
    market: typeof flags.market === 'string' ? flags.market : 'fapi',
    seconds: windowSec,
    label: 'market:watch'
  })
  printIngest(result, flags)
  console.log('  (one window shown; continuous watch is the services/run.mjs watch loop — use `npm run services`)')
  return 0
}

// --- indicator:test / indicator:parity --------------------------------------

function cmdIndicatorTest(flags) {
  const only = typeof flags.only === 'string' ? flags.only : null
  const res = indicatorSelfTest({ only })
  if (flags.json) {
    console.log(json(res))
  } else {
    console.log(`indicator:test — ${res.total} definitions`)
    for (const r of res.results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id} (v${r.version}, ${r.kind})${r.errors.length ? ` — ${r.errors.join('; ')}` : ''}`)
  }
  console.log(`\n${res.fail === 0 ? 'PASS' : 'FAIL'} — ${res.pass} pass, ${res.fail} fail\n`)
  return res.fail === 0 ? 0 : 1
}

async function cmdIndicatorParity() {
  console.log('indicator:parity — Pine golden-parity fixtures (engine/test.mjs)')
  return runChild(process.execPath, [join(ROOT, 'engine', 'test.mjs')])
}

// --- terminal:dev -----------------------------------------------------------

async function cmdTerminalDev(flags) {
  const args = ['run', 'dev']
  if (flags.port) {
    console.log(`dev: --port is fixed at 4001 by the dev script; ignoring ${flags.port}`)
  }
  console.log('terminal:dev — Nuxt dashboard on http://localhost:4001/')
  return runChild('npm', args, { shell: process.platform === 'win32' })
}

// --- paper:status / paper:watch --------------------------------------------

async function loadMongo() {
  const { loadEnv } = await import('../exec/env.mjs')
  const { connectMongo, isMongoConnected } = await import('../engine/db.mjs')
  loadEnv()
  await connectMongo()
  return isMongoConnected()
}

async function paperSnapshot(accountId) {
  const { PaperAccount } = await import('../engine/models/account.mjs')
  const { Position } = await import('../engine/models/position.mjs')
  const { accountSummary } = await import('../simulation/portfolio.mjs')
  const accounts = accountId ? await PaperAccount.find({ accountId }).lean() : await PaperAccount.find({}).lean()
  const out = []
  for (const acc of accounts) {
    const positions = await Position.find({ account: acc.accountId, source: 'paper' }).lean()
    let summary = null
    try {
      summary = accountSummary({ base: Number(acc.initialBalance) || 0, positions })
    } catch (e) {
      summary = { error: e?.message || String(e) }
    }
    out.push({ accountId: acc.accountId, mode: acc.mode, currency: acc.currency, initialBalance: acc.initialBalance, positions: positions.length, summary })
  }
  return out
}

async function cmdPaperStatus(flags) {
  const connected = await loadMongo()
  if (!connected) {
    console.log('paper:status — Mongo unavailable (set MONGODB_URI); nothing to read')
    return 0
  }
  const rows = await paperSnapshot(typeof flags.account === 'string' ? flags.account : null)
  if (flags.json) {
    console.log(json(rows))
    return 0
  }
  console.log(`paper:status — ${rows.length} account(s)`)
  for (const r of rows) {
    const s = r.summary ?? {}
    console.log(`  ${r.accountId} [${r.mode}] base=${r.initialBalance} positions=${r.positions}`)
    if (s.error) console.log(`    projection error: ${s.error}`)
    else console.log(`    equity=${s.equity} realized=${s.realized} unrealized=${s.unrealized} exposure=${s.exposure} marginUsed=${s.marginUsed} free=${s.freeMargin} open=${s.openCount} closed=${s.closedCount}`)
  }
  return 0
}

async function cmdPaperWatch(flags) {
  console.log('paper:watch — single snapshot (run on an interval/cron for continuous watching)')
  return cmdPaperStatus(flags)
}

// --- replay:create / replay:run / replay:test -------------------------------

async function loadBars(flags) {
  if (typeof flags.file === 'string') {
    const text = readFileSync(resolve(flags.file), 'utf8')
    try {
      const raw = JSON.parse(text)
      return Array.isArray(raw) ? raw : raw.bars ?? []
    } catch {
      return text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    }
  }
  if (!flags.symbol || !flags.timeframe) throw new Error('need --symbol and --timeframe (or --file=<json>)')
  const connected = await loadMongo()
  if (!connected) throw new Error('Mongo unavailable (set MONGODB_URI) and no --file given')
  const { Candle } = await import('../engine/models/candle.mjs')
  const q = { symbol: flags.symbol, timeframe: flags.timeframe, state: 'closed' }
  if (flags.from || flags.to) {
    q.openTime = {}
    if (flags.from) q.openTime.$gte = Number(flags.from)
    if (flags.to) q.openTime.$lte = Number(flags.to)
  }
  return Candle.find(q).sort({ openTime: 1 }).limit(int(flags.limit, 5000)).lean()
}

async function cmdReplayRun(flags) {
  const bars = await loadBars(flags)
  const symbol = flags.symbol ?? bars[0]?.symbol ?? 'unknown'
  const timeframe = flags.timeframe ?? bars[0]?.timeframe ?? '1m'
  const player = createReplayPlayer({ symbol, timeframe, bars })
  const emitted = []
  let chunk
  do {
    chunk = player.step(1000)
    emitted.push(...chunk)
  } while (chunk.length > 0)
  const st = player.state()
  const digest = digestEvents(emitted)
  if (flags.json) {
    console.log(json({ symbol, timeframe, played: st.cursor, total: st.total, digest }))
    return 0
  }
  console.log(`replay:run — ${symbol} ${timeframe}`)
  console.log(`  played  : ${st.cursor}/${st.total} closed bars`)
  if (emitted.length) console.log(`  window  : ${new Date(emitted[0].openTime).toISOString()} → ${new Date(emitted[emitted.length - 1].closeTime).toISOString()}`)
  console.log(`  digest  : ${digest}`)
  return 0
}

async function cmdReplayCreate(flags) {
  const bars = await loadBars(flags)
  const normalized = normalizeReplayBars(bars)
  if (normalized.length === 0) throw new Error('no closed bars to write')
  const symbol = flags.symbol ?? normalized[0].symbol ?? 'unknown'
  const timeframe = flags.timeframe ?? normalized[0].timeframe ?? '1m'
  const out = typeof flags.out === 'string' ? resolve(flags.out) : join(ROOT, 'reports', 'replay', `${symbol}-${timeframe}.ndjson`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, normalized.map((b) => JSON.stringify(b)).join('\n') + '\n')
  console.log(`replay:create — wrote ${normalized.length} closed bars → ${out}`)
  console.log(`  digest  : ${digestEvents(normalized)}`)
  console.log(`  run it  : npm run replay:run -- --file=${out} --symbol=${symbol} --timeframe=${timeframe}`)
  return 0
}

async function cmdReplayTest() {
  console.log('replay:test — simulation/replay determinism suite (simulation/test.mjs)')
  return runChild(process.execPath, [join(ROOT, 'simulation', 'test.mjs')])
}

// --- research:once ----------------------------------------------------------

async function cmdResearchOnce() {
  console.log('research:once — AI research/review pass (ai/review.mjs)')
  return runChild(process.execPath, [join(ROOT, 'ai', 'review.mjs')])
}

// --- dispatch ---------------------------------------------------------------

const COMMANDS = {
  'market:catalog': cmdMarketCatalog,
  'market:status': cmdMarketStatus,
  'market:once': cmdMarketOnce,
  'market:watch': cmdMarketWatch,
  'indicator:test': cmdIndicatorTest,
  'indicator:parity': cmdIndicatorParity,
  'terminal:dev': cmdTerminalDev,
  'paper:status': cmdPaperStatus,
  'paper:watch': cmdPaperWatch,
  'replay:create': cmdReplayCreate,
  'replay:run': cmdReplayRun,
  'replay:test': cmdReplayTest,
  'research:once': cmdResearchOnce
}

function usage() {
  console.log('tm-trading developer CLI (roadmap §44) — node tools/dev.mjs <command> [--flags]\n')
  console.log('Commands:')
  for (const name of Object.keys(COMMANDS)) console.log(`  ${name}`)
  console.log('\nCommon flags: --json  --symbols=BTCUSDT,ETHUSDT  --timeframe=1m  --file=<path>')
}

export async function main(argv = process.argv.slice(2)) {
  const { positionals, flags } = parseArgs(argv)
  const cmd = positionals[0]
  if (!cmd || flags.help || flags.h) {
    usage()
    return cmd ? 0 : 1
  }
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.error(`dev: unknown command "${cmd}"\n`)
    usage()
    return 1
  }
  try {
    return (await fn(flags)) ?? 0
  } catch (e) {
    console.error(`dev: ${cmd} failed — ${e?.message || e}`)
    return 1
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
