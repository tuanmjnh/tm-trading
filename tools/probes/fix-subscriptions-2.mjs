const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { BotInstance } = await import('file:///' + ROOT + '/engine/models/botInstance.mjs')
const instanceId = 'bot-wonderwhales-btcusdt-p-1-ww-probe-20261025'
const inst = await BotInstance.findOne({ instanceId }).lean()
console.log('BEFORE:', inst.subscriptions)
const result = await BotInstance.updateOne({ instanceId }, { $set: { subscriptions: ['BTCUSDT'] } })
console.log('UPDATED:', result)
const inst2 = await BotInstance.findOne({ instanceId }).lean()
console.log('AFTER:', inst2.subscriptions)
process.exit(0)