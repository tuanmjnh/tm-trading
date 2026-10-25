const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
await import('file:///' + ROOT + '/engine/models/botProfile.mjs')
await import('file:///' + ROOT + '/engine/models/botInstance.mjs')
await import('file:///' + ROOT + '/engine/models/strategyProfile.mjs')
await import('file:///' + ROOT + '/engine/models/aiAgent.mjs')
const { BotProfile, BotInstance, StrategyProfile, AiAgent } = await import('file:///' + ROOT + '/engine/models/botProfile.mjs').then(m => ({
  BotProfile: m.BotProfile,
  BotInstance: m.BotInstance
})).catch(() => {})

const collections = [
  { name: 'bot_profiles', model: conn.model('bot_profiles') },
  { name: 'bot_instances', model: conn.model('bot_instances') },
  { name: 'strategy_profiles', model: conn.model('strategy_profiles') },
  { name: 'ai_agents', model: conn.model('ai_agents') }
]

for (const coll of collections) {
  try {
    const count = await coll.model.countDocuments({ ownerId: { $exists: false } })
    console.log(coll.name + ': ' + count + ' docs missing ownerId')
  } catch (e) {
    console.log(coll.name + ': ERROR - ' + e.message)
  }
}
process.exit(0)