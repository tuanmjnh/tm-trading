// scripts/seed-root-user.mjs
import { loadEnv } from '../exec/env.mjs'
import { connectMongo } from '../engine/db.mjs'

loadEnv()

const SOURCE_OWNER = '821c0885-6db5-484a-9d8e-f266c71715c4' // trading_root
const ROOT_OWNER = '8df6001b-38cd-4415-95fc-80c2b15fcb55'   // root

async function run() {
  await connectMongo()
  const m = await import('../engine/models/index.mjs')

  console.log(`[seed-root] Provisioning paper accounts for root (${ROOT_OWNER})...`)
  const accounts = await m.PaperAccount.find({ ownerId: SOURCE_OWNER }).lean()
  for (const acc of accounts) {
    const copy = { ...acc }
    delete copy._id
    delete copy.createdAt
    delete copy.updatedAt
    copy.ownerId = ROOT_OWNER
    await m.PaperAccount.findOneAndUpdate(
      { ownerId: ROOT_OWNER, accountId: copy.accountId },
      { $set: copy },
      { upsert: true }
    )
  }
  console.log(` ✅ Copied ${accounts.length} paper accounts`)

  console.log(`[seed-root] Provisioning strategy profiles & versions...`)
  const sProfiles = await m.StrategyProfile.find({ ownerId: SOURCE_OWNER }).lean()
  for (const sp of sProfiles) {
    const copy = { ...sp }
    copy._id = `${ROOT_OWNER}:${sp.profileId}`
    copy.ownerId = ROOT_OWNER
    delete copy.createdAt
    delete copy.updatedAt
    await m.StrategyProfile.findOneAndUpdate({ _id: copy._id }, { $set: copy }, { upsert: true })
  }

  const sVersions = await m.StrategyVersion.find({ ownerId: SOURCE_OWNER }).lean()
  for (const sv of sVersions) {
    const copy = { ...sv }
    delete copy._id
    copy.ownerId = ROOT_OWNER
    delete copy.createdAt
    delete copy.updatedAt
    await m.StrategyVersion.findOneAndUpdate(
      { ownerId: ROOT_OWNER, strategyVersionId: sv.strategyVersionId },
      { $set: copy },
      { upsert: true }
    )
  }
  console.log(` ✅ Copied ${sProfiles.length} strategy profiles`)

  console.log(`[seed-root] Provisioning bot profiles...`)
  const bProfiles = await m.BotProfile.find({ ownerId: SOURCE_OWNER }).lean()
  for (const bp of bProfiles) {
    const copy = { ...bp }
    copy._id = `${ROOT_OWNER}:${bp.profileId}`
    copy.ownerId = ROOT_OWNER
    delete copy.createdAt
    delete copy.updatedAt
    await m.BotProfile.findOneAndUpdate({ _id: copy._id }, { $set: copy }, { upsert: true })
  }
  console.log(` ✅ Copied ${bProfiles.length} bot profiles`)

  console.log(`[seed-root] Provisioning AI agent versions & AI agents...`)
  const aVersions = await m.AiAgentVersion.find({ ownerId: SOURCE_OWNER }).lean()
  for (const av of aVersions) {
    const copy = { ...av }
    delete copy._id
    copy.ownerId = ROOT_OWNER
    delete copy.createdAt
    delete copy.updatedAt
    await m.AiAgentVersion.findOneAndUpdate(
      { ownerId: ROOT_OWNER, versionId: av.versionId },
      { $set: copy },
      { upsert: true }
    )
  }

  const agents = await m.AiAgent.find({ ownerId: SOURCE_OWNER }).lean()
  const now = Date.now()
  for (const ag of agents) {
    const copy = { ...ag }
    const baseId = ag.agentId || ag._id
    copy._id = `root_${baseId}`
    copy.agentId = `root_${baseId}`
    copy.ownerId = ROOT_OWNER
    copy.lastHeartbeatAt = now
    copy.lastEventAt = now
    delete copy.createdAt
    delete copy.updatedAt
    await m.AiAgent.findOneAndUpdate(
      { ownerId: ROOT_OWNER, agentId: copy.agentId },
      { $set: copy },
      { upsert: true }
    )
  }
  console.log(` ✅ Copied ${agents.length} AI agents`)

  console.log(`[seed-root] Provisioning active Bot Instances for root...`)
  const { createInstanceFromProfile } = await import('../services/botRuntimeStore.mjs')
  for (const bp of bProfiles) {
    const res = await createInstanceFromProfile({
      ownerId: ROOT_OWNER,
      profileId: bp.profileId,
      createdBy: 'seed-root',
      now
    })
    console.log(`   Instance ${bp.profileId}:`, res?.instanceId, res?.state)
  }

  console.log('[seed-root] ALL DONE!')
  process.exit(0)
}

run().catch(err => {
  console.error('[seed-root] Error:', err)
  process.exit(1)
})
