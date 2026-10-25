const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { BotProfile } = await import('file:///' + ROOT + '/engine/models/botProfile.mjs')

// Update the 15m ww-probe profile to use minAtrPct=0.2
const result = await BotProfile.updateOne(
  { profileId: 'bot-wonderwhales-btcusdt-p-15-ww-probe' },
  { 
    $set: { 
      'paramOverrides.minAtrPct': 0.2,
      updatedAt: Date.now()
    }
  }
)
console.log('Updated 15m ww-probe:', result)

// Also update the 1m ww-probe to ensure it's using sar-ema (no ATR gate)
const result2 = await BotProfile.updateOne(
  { profileId: 'bot-wonderwhales-btcusdt-p-1-ww-probe' },
  { 
    $set: { 
      'paramOverrides.mode': 'sar-ema',
      'paramOverrides.minAtrPct': 0.5,
      updatedAt: Date.now()
    }
  }
)
console.log('Updated 1m ww-probe:', result2)

process.exit(0)