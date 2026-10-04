import { executeTool } from './ai/agent.mjs'

const show = async (n, p) => {
  const t0 = Date.now()
  const r = await executeTool(n, p)
  const body = JSON.stringify(r)
  console.log(`${n}: ${Date.now() - t0}ms ${r.ok ? 'ok' : 'ERR'} ${body.slice(0, 260)}${body.length > 260 ? '…' : ''}`)
}

await show('queryDB', { collection: 'runs', limit: 2 })
await show('queryDB', { collection: 'trades', limit: 2 })
await show('queryDB', { collection: 'signals', limit: 2 })
await show('queryDB', { collection: 'intel', kind: 'confluence', limit: 2 })
await show('queryDB', { collection: 'bogus' })
await show('getKlines', { symbol: 'BTCUSDT', tf: '60', limit: 30 })
await show('getKlines', {})
await show('scanMovers', { limit: 3 })
await show('methodSignals', { symbol: 'BTCUSDT', tf: '60', limit: 100, events: 3 })
await show('regimeSnapshot', {})
await show('backtestQuick', { method: 'vsa', symbol: 'BTCUSDT', tf: '60', bars: 200 })

const { disconnectMongo } = await import('./engine/db.mjs')
await disconnectMongo()
setTimeout(() => process.exit(0), 100)
