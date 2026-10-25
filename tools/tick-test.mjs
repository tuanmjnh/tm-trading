// Temp: rerun + TWO real ticks - proves start -> evaluate -> bridge -> order.
import { loadEnv } from '../exec/env.mjs'
import { createBotWorker } from '../services/botWorker.mjs'
import mongoose from 'mongoose'

loadEnv()
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tm-trading')
const OWNER = '8df6001b-38cd-4415-95fc-80c2b15fcb55'

const { BotProfile } = await import('../engine/models/botProfile.mjs')
const profile = await BotProfile.findOne({ ownerId: OWNER, status: 'enabled' }).lean()
if (!profile) { console.error('no enabled profile'); process.exit(1) }
console.log('profile:', profile.profileId)

const store = await import('../services/botRuntimeStore.mjs')
const inst = await store.createInstanceFromProfile({ ownerId: OWNER, profileId: profile.profileId, createdBy: 'live-test', now: Date.now() })
console.log('instance:', JSON.stringify(inst))
if (!inst.ok) process.exit(1)
await store.enqueueCommand({ ownerId: OWNER, instanceId: inst.instanceId, type: 'start', commandId: 'cmd_test_' + Date.now().toString(36), botProfileId: profile.profileId })

const worker = createBotWorker({ ownerId: OWNER, nonce: 'live-test', log: console })
await worker.boot()

console.log('')
console.log('tick 1 (apply start + evaluate + bridge + cycle)...')
const t1 = await worker.tick()
for (const c of t1.cycles ?? []) {
  console.log('  instance:', c.instanceId)
  console.log('  eval:', JSON.stringify(c.eval))
  console.log('  signals:', JSON.stringify(c.signals))
  console.log('  stats:', JSON.stringify(c.stats))
}

console.log('')
console.log('tick 2 (15s later - next closed bar check)...')
await new Promise(r => setTimeout(r, 15000))
const t2 = await worker.tick()
for (const c of t2.cycles ?? []) {
  console.log('  eval:', JSON.stringify(c.eval))
  console.log('  signals:', JSON.stringify(c.signals))
  console.log('  stats:', JSON.stringify(c.stats))
}

const { BotInstance } = await import('../engine/models/botInstance.mjs')
const doc = await BotInstance.findOne({ ownerId: OWNER, state: { $in: ['running', 'starting'] } }).lean()
if (doc) console.log('FINAL STATE:', doc.state, '| counts:', JSON.stringify(doc.counts), '| health:', doc.health)
await worker.shutdown()
await mongoose.disconnect()
process.exit(0)
