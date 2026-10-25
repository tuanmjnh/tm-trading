#!/usr/bin/env node
// services/agentHeartbeat.mjs
// AI Agent Heartbeat Loop — runs every interval for active A1/A2 agents
// Calls the gateway tools to generate proposals for human review

import { connectMongo } from '../engine/db.mjs'
import { AiAgent } from '../engine/models/aiAgent.mjs'
import { AiAgentVersion } from '../engine/models/aiAgentVersion.mjs'
import { resolveProviderConfig } from '../ai/providerStore.mjs'
import { chat, aiConfig } from '../ai/gateway.mjs'

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_PROPOSALS_PER_CYCLE = 3

async function loadActiveAgents() {
  return await AiAgent.find({
    state: 'active',
    autonomy: { $in: ['A1', 'A2'] }
  }).lean()
}

async function loadAgentVersion(agentId, versionId) {
  return await AiAgentVersion.findOne({ versionId, agentId }).lean()
}

async function runHeartbeat() {
  console.log(`[${new Date().toISOString()}] Agent heartbeat starting...`)
  
  const agents = await loadActiveAgents()
  console.log(`Found ${agents.length} active agents`)
  
  for (const agent of agents) {
    try {
      const version = await loadAgentVersion(agent.agentId, agent.activeVersionId)
      if (!version) {
        console.warn(`Agent ${agent.agentId}: active version ${agent.activeVersionId} not found`)
        continue
      }

      if (!version.tools || version.tools.length === 0) {
        console.warn(`Agent ${agent.agentId}: no tools configured, skipping`)
        continue
      }

      console.log(`Processing agent ${agent.agentId} (${agent.name}) v${version.version}`)
      
      // Resolve provider config for the agent's model
      const providerConfig = await resolveProviderConfig({
        ownerId: agent.ownerId,
        required: ['chat', 'tools']
      })
      if (!providerConfig) {
        console.warn(`Agent ${agent.agentId}: no suitable provider configured`)
        return
      }
      
      // Call the provider gateway with the agent's system prompt and tools
      const prompt = `You are ${agent.name}. ${agent.description || ''}
Current time: ${new Date().toISOString()}
Autonomy level: ${agent.autonomy}
Available tools: ${version.tools.join(', ')}

Generate up to ${MAX_PROPOSALS_PER_CYCLE} trade proposals based on current market conditions.
Each proposal must include: symbol, side, entry, stopLoss, takeProfit, sizePct, rationale.
If insufficient evidence, respond with "insufficient evidence".`

      const response = await chat([
        { role: 'system', content: version.prompts?.system || 'You are a trading analyst.' },
        { role: 'user', content: prompt }
      ], version.tools.map(t => ({ type: 'function', function: { name: t, description: '' } })), {
        cfg: {
          ...aiConfig(),
          provider: providerConfig.provider,
          adapter: providerConfig.adapter,
          baseUrl: providerConfig.baseUrl,
          model: providerConfig.model,
          apiKey: providerConfig.apiKey,
        }
      })

      if (response.toolCalls?.length) {
        console.log(`Agent ${agent.agentId} generated ${response.toolCalls.length} proposal(s)`)
        // TODO: Persist proposals to ai_proposals collection for human review
      } else {
        console.log(`Agent ${agent.agentId}: no proposals generated`)
      }

    } catch (err) {
      console.error(`Error processing agent ${agent.agentId}:`, err.message)
    }
  }
}

async function main() {
  const conn = await connectMongo()
  if (!conn) { 
    console.error('MongoDB unavailable'); 
    process.exit(1) 
  }

  console.log('AI Agent Heartbeat service started')
  console.log(`Interval: ${HEARTBEAT_INTERVAL_MS / 60000} minutes`)

  // Run once immediately
  await runHeartbeat()

  // Then schedule recurring
  setInterval(async () => {
    try {
      await runHeartbeat()
    } catch (err) {
      console.error('Heartbeat cycle error:', err.message)
    }
  }, HEARTBEAT_INTERVAL_MS)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})