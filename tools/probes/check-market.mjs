const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { MarketFeed } = await import('file:///' + ROOT + '/engine/models/marketFeed.mjs')
const feeds = await MarketFeed.find({}).select('venue symbol apiKey status').lean()
const unique = new Map()
for (const f of feeds) {
  const key = f.venue + ':' + f.symbol
  if (!unique.has(key)) {
    unique.set(key, { venue: f.venue, symbol: f.symbol, status: f.status, hasKey: !!f.apiKey })
  }
}
for (const [k, v] of unique) {
  console.log(v.venue + ' ' + v.symbol + ' -> status:' + v.status + ' key:' + (v.hasKey ? 'set' : 'unset'))
}
process.exit(0)