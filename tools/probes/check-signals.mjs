const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { Signal } = await import('file:///' + ROOT + '/engine/models/signal.mjs')
const ownerId = '8df6001b-38cd-4415-95fc-80c2b15fcb55'
const sigs = await Signal.find({ 
  ownerId, 
  symbol: 'BTCUSDT', 
  tf: '1',
  signalKey: { $gt: 'sig_8b1c14b363cbe25d3e5e2c38fb4cd2a8f12c8748' }
}).sort({ signalKey: 1 }).limit(10).lean()
for (const s of sigs) {
  console.log('Signal:', s.signalKey, 'symbol:', s.symbol, 'tf:', s.tf, 'ts:', s.ts)
}
process.exit(0)