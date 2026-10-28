import { loadEnv } from '../exec/env.mjs'

loadEnv()

const { connectMongo } = await import('../engine/db.mjs')
const m = await connectMongo()
if (!m) {
  console.error('Mongo connection failed')
  process.exit(1)
}

const db = m.connection.db
const oldOwner = '8df6001b-38cd-4415-95fc-80c2b15fcb55'
const newOwner = '821c0885-6db5-484a-9d8e-f266c71715c4'

const colls = await db.listCollections().toArray()
for (const c of colls) {
  const n = await db.collection(c.name).countDocuments({ ownerId: oldOwner })
  if (n > 0) {
    const res = await db.collection(c.name).updateMany({ ownerId: oldOwner }, { $set: { ownerId: newOwner } })
    console.log(c.name, 'updated rows:', res.modifiedCount)
  }
}

// Re-key bot_profiles if _id had oldOwner prefix
const bpOld = await db.collection('bot_profiles').find({ _id: new RegExp('^' + oldOwner) }).toArray()
for (const bp of bpOld) {
  const newId = bp._id.replace(oldOwner, newOwner)
  await db.collection('bot_profiles').deleteOne({ _id: bp._id })
  bp._id = newId
  bp.ownerId = newOwner
  await db.collection('bot_profiles').insertOne(bp)
  console.log('re-keyed bot_profile:', newId)
}

// Update minAtrPct on 15m bot_profiles to 0.2
const updatedP = await db.collection('bot_profiles').updateMany(
  { 'paramOverrides.minAtrPct': 0.5 },
  { $set: { 'paramOverrides.minAtrPct': 0.2 } }
)
console.log('updated minAtrPct 0.5 -> 0.2 on bot_profiles:', updatedP.modifiedCount)

console.log('Migration to', newOwner, 'complete.')
await m.disconnect()
