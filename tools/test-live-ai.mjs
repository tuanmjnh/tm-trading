// Temp: LIVE per-provider AI test - discover models, pick the best, save it,
// run a real trading-prompt chat call. Deletes itself.
import mongoose from 'mongoose'
import { loadEnv } from '../exec/env.mjs'
import { connectMongo } from '../engine/db.mjs'
import { AiProviderConnection } from '../engine/models/aiProviderConnection.mjs'
import * as store from '../ai/providerStore.mjs'

loadEnv()
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tm-trading')
const conn = await connectMongo()
if (!conn) { console.error('mongo down'); process.exit(1) }

const OWNER = '8df6001b-38cd-4415-95fc-80c2b15fcb55'
const rows = await AiProviderConnection.find({ ownerId: OWNER, enabled: true }).lean()
console.log('connections:', rows.map(r => r.provider).join(', '))

function pickBest(models) {
  const ids = models.map(m => String(m.model ?? m.modelId ?? m)).filter(Boolean)
  if (!ids.length) return null
  const bad = /embed|rerank|whisper|tts|guard|diffusion|sdxl|flux/i
  const prefer = [
    /deepseek-r1/i, /llama-3\.3-70b/i, /llama-3\.1-405b/i, /qwen3-235b|qwen.*32b/i,
    /nemotron.*70b|ultra/i, /gpt-4o|gpt-4\.1|opus|gemini.*pro/i,
    /instruct|chat/i
  ]
  const scored = ids
    .filter(id => !bad.test(id))
    .map((id) => {
      let score = 0
      prefer.forEach((re, i) => { if (re.test(id)) score += 100 - i })
      const params = id.match(/(\d+)b/i)
      if (params) score += Math.min(50, Number(params[1]))
      return { id, score }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.id ?? ids[0]
}

const TRADE_PROMPT = 'You are a trading assistant. Reply with ONE short English sentence: should the current BTC market be treated as bullish, bearish or neutral? (this is a connectivity test)'

for (const row of rows) {
  console.log('')
  console.log('=== ' + row.provider + ' (model: ' + (row.model || 'none') + ') ===')
  try {
    let models = []
    try {
      const key = row.secretEnc ? store.decryptStored(row.secretEnc) : ''
      const disc = await store.discoverModelsForInput({
        provider: row.provider,
        baseUrl: row.baseUrl || undefined,
        apiKey: key || undefined
      })
      models = disc?.models ?? []
      console.log('discovered:', models.length, 'models')
    } catch (e) {
      console.log('discover failed:', String(e?.message ?? e).slice(0, 110))
    }

    const best = pickBest(models) || row.model
    if (best && best !== row.model) {
      await store.setPrimaryModel({ ownerId: OWNER, connectionId: String(row._id), model: best, actor: 'live-test' })
      console.log('model switched:', row.model, '->', best)
      row.model = best
    } else {
      console.log('model kept:', best)
    }

    const fresh = await AiProviderConnection.findById(String(row._id)).lean()
    const r = await store.testConnection(fresh, { actor: 'live-test', timeoutMs: 30000 })
    console.log('testConnection:', r.ok ? 'OK' : 'FAIL', '| latency:', r.latencyMs + 'ms', '| code:', r.code ?? '-', '| error:', String(r.error ?? '-').slice(0, 130))

    if (r.ok) {
      const gw = await import('../ai/gateway.mjs')
      const key = fresh.secretEnc ? store.decryptStored(fresh.secretEnc) : ''
      const cfg = {
        provider: fresh.provider === 'hub' ? 'openai' : fresh.provider,
        apiKey: key,
        baseUrl: fresh.baseUrl || undefined,
        model: fresh.model,
        timeoutMs: 30000
      }
      const c0 = Date.now()
      const answer = await gw.chat([{ role: 'user', content: TRADE_PROMPT }], [], { cfg, maxTokens: 120 })
      console.log('chat OK in', (Date.now() - c0) + 'ms | answer:', String(answer?.content ?? answer).slice(0, 220))
    }
  } catch (e) {
    console.log('ERROR:', String(e?.message ?? e).slice(0, 220))
  }
}

await mongoose.disconnect()
process.exit(0)
