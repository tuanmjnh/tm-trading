import mongoose from 'mongoose'
await mongoose.connect('mongodb://localhost:27017/tm-trading', { serverSelectionTimeoutMS: 5000 })
const db = mongoose.connection.db
const svs = await db.collection('strategy_versions').find({}).toArray()
for (const s of svs) console.log(s._id, '| methodVersions:', JSON.stringify(s.methodVersions ?? null), '| params keys:', Object.keys(s.parameters ?? {}).join(',') || '(none)', '| status:', s.status, '| ownerId:', s.ownerId)
const agv = await db.collection('ai_agent_versions').find({}).project({ agentId: 1, version: 1, status: 1, provider: 1, model: 1, connectionId: 1 }).toArray()
console.log('AGENT VERSIONS:', JSON.stringify(agv, null, 1))
const acc = await db.collection('paper_accounts').find({}).project({ accountId: 1, ownerId: 1, label: 1, status: 1, cash: 1, equity: 1 }).toArray()
console.log('ACCOUNTS:', JSON.stringify(acc, null, 1))
await mongoose.disconnect()
