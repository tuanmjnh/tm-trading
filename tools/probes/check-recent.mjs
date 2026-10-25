const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { Signal } = await import('file:///' + ROOT + '/engine/models/signal.mjs')
const ownerId = '8df6001b-38cd-4415-95fc-80c2b15fcb55'
const startAfter = new Date('2026-10-25T12:00:00.000Z')
const sigs = await Signal.find({ 
  ownerId, 
  symbol: 'BTCUSDT', 
  tf: '1',
  createdAt: { $gte: startAfter } 
}).sort({ createdAt: -1 }).limit(20).lean()
console.log('RECENT SIGNALS for BTCUSDT 1m:', JSON.stringify(sigs, null, 2))
process.exit(0)