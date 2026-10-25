const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { BotInstance } = await import('file:///' + ROOT + '/engine/models/botInstance.mjs')
const { Signal } = await import('file:///' + ROOT + '/engine/models/signal.mjs')
const { PaperOrder } = await import('file:///' + ROOT + '/engine/models/order.mjs')
const { PaperFill } = await import('file:///' + ROOT + '/engine/models/fill.mjs')
const { Position } = await import('file:///' + ROOT + '/engine/models/position.mjs')

const inst = await BotInstance.findOne({ instanceId: 'bot-wonderwhales-btcusdt-p-1-ww-probe-20261025' }).lean()
console.log('INSTANCE:', JSON.stringify({ id: inst.instanceId, state: inst.state, health: inst.health, lease: inst.lease, sessionId: inst.sessionId, counts: inst.counts, lastSignalTs: inst.lastSignalTs }, null, 2))

const ownerId = inst.ownerId
const startAfter = new Date('2026-10-25T12:10:00.000Z')
const [sig, ord] = await Promise.all([
  Signal.find({ ownerId, createdAt: { $gte: startAfter } }).sort({ createdAt: -1 }).limit(10).lean(),
  PaperOrder.find({ ownerId, createdAt: { $gte: startAfter } }).sort({ createdAt: -1 }).limit(10).lean()
])
console.log('NEW SIGNALS:', JSON.stringify(sig))
console.log('NEW ORDERS:', JSON.stringify(ord))
process.exit(0)