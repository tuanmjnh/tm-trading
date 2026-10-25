const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { BotInstance } = await import('file:///' + ROOT + '/engine/models/botInstance.mjs')
const inst = await BotInstance.findOne({ instanceId: 'bot-wonderwhales-btcusdt-p-1-ww-probe-20261025' }).lean()
console.log('Subscriptions:', inst.subscriptions)
console.log('State:', inst.state)
console.log('LastSignalKey:', inst.lastSignalKey)
console.log('LastSignalTs:', inst.lastSignalTs)
process.exit(0)