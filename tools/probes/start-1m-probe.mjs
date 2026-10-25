const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { BotInstance } = await import('file:///' + ROOT + '/engine/models/botInstance.mjs')
const { BotCommand } = await import('file:///' + ROOT + '/engine/models/botCommand.mjs')
const instanceId = 'bot-wonderwhales-btcusdt-p-1-ww-probe-20261025'
const inst = await BotInstance.findOne({ instanceId }).lean()
if (!inst) { console.log('instance not found'); process.exit(1) }
const now = Date.now()
await BotInstance.updateOne({ instanceId }, {
  $set: {
    state: 'queued',
    health: 'ok',
    healthReason: null,
    lease: { supervisorId: null, claimedAt: null, beatAt: null, expiresAt: null }
  }
})
const cmdId = 'cmd_start_' + instanceId + '_' + now.toString(36)
await BotCommand.create({
  instanceId,
  ownerId: inst.ownerId,
  botProfileId: inst.botProfileId,
  accountId: inst.accountId,
  type: 'start',
  commandId: cmdId,
  status: 'pending',
  createdAt: now,
  schemaVersion: 'botCommand.v1'
})
console.log('Enqueued start command for', instanceId)
process.exit(0)