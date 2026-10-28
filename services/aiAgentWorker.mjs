// services/aiAgentWorker.mjs
// =============================================================================
//  PER-USER AI AGENT RUNTIME WORKER (roadmap §59.15 / §59.16 / ADR-002)
//
//  Runs an autonomous heartbeat & evaluation loop for all active AI agents:
//    - Periodic heartbeat (marks agent health as "OK" / fresh),
//    - Realtime market & regime data collection (klines + intel),
//    - Governed LLM invocation using the agent's immutable system prompt,
//    - Structured trade proposal / advice generation via `submitAgentAction`,
//    - Write to `ai_proposals` and `ai_agent_actions` (append-only ledger).
// =============================================================================

import { loadEnv } from '../exec/env.mjs'
import { connectMongo } from '../engine/db.mjs'
import { chat, aiConfig } from '../ai/gateway.mjs'
import { checkOrder, loadRiskConfig } from '../exec/risk.mjs'
import { getActiveLearnedRules } from './aiReviewWorker.mjs'

loadEnv()

let modelsMemo = null

async function getModels() {
  if (modelsMemo) return modelsMemo
  const mg = await connectMongo()
  if (!mg) return null
  const [ag, agv, act, prop, sess, al] = await Promise.all([
    import('../engine/models/aiAgent.mjs'),
    import('../engine/models/aiAgentVersion.mjs'),
    import('../engine/models/aiAgentAction.mjs'),
    import('../engine/models/aiProposal.mjs'),
    import('../engine/models/session.mjs'),
    import('../engine/models/alert.mjs'),
  ])
  modelsMemo = {
    AiAgent: ag.AiAgent,
    AiAgentVersion: agv.AiAgentVersion,
    AiAgentAction: act.AiAgentAction,
    AiProposal: prop.AiProposal,
    TradingSession: sess.TradingSession,
    Alert: al.Alert,
  }
  return modelsMemo
}

/** Fetch recent klines for market context. Fail-soft to simulated/cached. */
async function getRecentMarketContext(symbol = 'BTCUSDT', tf = '15') {
  const cleanSym = String(symbol || 'BTCUSDT').trim().toUpperCase().replace(/\.P$/i, '')
  try {
    const { fetchKlines } = await import('../engine/data.mjs')
    const res = await fetchKlines({
      symbol: cleanSym,
      tf: String(tf || '15'),
      limit: 20,
      refresh: true,
      market: process.env.PAPER_MARKET || 'spot'
    }).catch(() => null)
    const klines = Array.isArray(res?.bars) ? res.bars : []
    if (klines.length >= 2) {
      const last = klines[klines.length - 1]
      const lastClose = Number(last.close)
      const lastHigh = Number(last.high)
      const lastLow = Number(last.low)
      const lastVol = Number(last.volume)
      const lastOpen = Number(last.open)
      if (Number.isFinite(lastClose) && lastClose > 0) {
        return {
          symbol: cleanSym,
          tf,
          barsCount: klines.length,
          lastClose,
          lastHigh,
          lastLow,
          lastVol,
          summary: `Last closed ${cleanSym} ${tf}m bar: open=${lastOpen} high=${lastHigh} low=${lastLow} close=${lastClose} vol=${lastVol}`
        }
      }
    }
  } catch {
    // Fail-soft
  }
  return {
    symbol: cleanSym,
    tf,
    barsCount: 0,
    lastClose: 67800,
    lastHigh: 68100,
    lastLow: 67500,
    lastVol: 125.4,
    summary: `${cleanSym} approx price: 67800 (market data simulated/cached)`
  }
}

export function createAiAgentWorker({
  intervalMs = 30_000,
  log = console,
} = {}) {
  let stopped = false
  let ticking = false

  async function tick() {
    if (stopped || ticking) return { ok: true, skipped: true }
    ticking = true

    const cycles = []
    let evaluatedThisTick = 0
    try {
      const m = await getModels()
      if (!m) return { ok: false, code: 'mongo_down' }

      // Sort least-recently evaluated agents first (round-robin fairness across all agents & owners)
      const activeAgents = await m.AiAgent.find({ state: 'active' })
        .sort({ lastEventAt: 1, lastHeartbeatAt: 1 })
        .lean()
      if (!activeAgents.length) {
        return { ok: true, activeCount: 0, cycles }
      }

      const now = Date.now()
      const evaluatedByOwner = new Map()

      for (const agent of activeAgents) {
        const agentId = agent.agentId || agent._id
        const ownerId = agent.ownerId

        // 1. Update heartbeat
        await m.AiAgent.updateOne(
          { $or: [{ _id: agent._id }, { agentId }] },
          { $set: { lastHeartbeatAt: now } }
        ).catch(() => null)

        // 2. If agent has an active version, evaluate market
        if (!agent.activeVersionId) {
          cycles.push({ agentId, action: 'heartbeat_only', reason: 'no_active_version' })
          continue
        }

        const version = await m.AiAgentVersion.findOne({
          versionId: agent.activeVersionId,
          ownerId
        }).lean()

        if (!version) {
          cycles.push({ agentId, action: 'heartbeat_only', reason: 'version_not_found' })
          continue
        }

        // Only evaluate proposals once every 60s per agent, and limit concurrent LLM calls per tick to prevent HTTP 429
        const lastAction = await m.AiAgentAction.findOne({ agentId, ownerId })
          .sort({ at: -1 })
          .lean()

        const timeSinceLastAction = lastAction?.at ? now - lastAction.at : Infinity
        if (timeSinceLastAction < 60_000) {
          cycles.push({ agentId, action: 'heartbeat_beat', cooloffMs: 60_000 - timeSinceLastAction })
          continue
        }

        const ownerEvaluations = evaluatedByOwner.get(ownerId) || 0
        if (ownerEvaluations >= 1) {
          cycles.push({ agentId, action: 'heartbeat_beat', cooloffMs: 15_000, reason: 'owner_rate_limit_throttle' })
          continue
        }

        if (evaluatedThisTick >= 2) {
          cycles.push({ agentId, action: 'heartbeat_beat', cooloffMs: 15_000, reason: 'rate_limit_throttle' })
          continue
        }
        evaluatedThisTick++
        evaluatedByOwner.set(ownerId, ownerEvaluations + 1)

        // 3. Fetch market data
        const symbol = agent.instruments?.[0] || 'BTCUSDT'
        const mkt = await getRecentMarketContext(symbol, '15')

        // 4. Fetch dynamic real-time learning rules (closed-loop training)
        const learnedRules = await getActiveLearnedRules(ownerId, 3).catch(() => [])
        const learnedSection = learnedRules.length > 0
          ? `\n=== DYNAMIC CONTINUOUS LEARNING CONSTRAINTS (REAL-TIME TRAINING DATA) ===\n` +
            learnedRules.map((r, i) => `${i + 1}. [${r.category.toUpperCase()}] ${r.rule}`).join('\n') +
            `\nYou must comply strictly with these learned risk and execution constraints.\n`
          : ''

        // 5. Call AI Gateway
        const systemPrompt = version.prompts?.system ||
          'You are a quantitative trading assistant. Analyze market state and propose high-probability paper trades.'

        const userPrompt = `Live Market Snapshot:
${mkt.summary}
Symbol: ${symbol}
Time: ${new Date(now).toISOString()}
${learnedSection}
Task: You are an active quantitative algorithmic trading engine. Analyze the recent market momentum and identify the best actionable trade setup (LONG or SHORT) for ${symbol}.
Respond ONLY with a valid JSON block inside \`\`\`json markdown fences matching this exact schema:
\`\`\`json
{
  "action": "proposal",
  "symbol": "${symbol}",
  "side": "LONG" | "SHORT",
  "entry": ${mkt.lastClose},
  "sl": ${Number((mkt.lastClose * 0.99).toFixed(2))},
  "tp": ${Number((mkt.lastClose * 1.02).toFixed(2))},
  "hypothesis": "Clear concise reason for trade setup",
  "rationale": "Key evidence and indicators supporting the entry"
}
\`\`\`
Do not include any greeting, preamble, or commentary outside the markdown code block.`

        let aiReply = null
        try {
          aiReply = await chat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ], { maxTokens: 4096 })
        } catch (err) {
          log.warn(`[ai-agent-worker] chat failed for ${agentId}:`, err?.message ?? err)
          cycles.push({ agentId, action: 'llm_error', error: err?.message })
          continue
        }

        const replyText = aiReply?.text || ''
        const cleanText = replyText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
        let parsedProposal = null
        const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || cleanText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const rawCandidate = (jsonMatch[1] || jsonMatch[0]).trim()
          try {
            parsedProposal = JSON.parse(rawCandidate)
          } catch {
            const start = rawCandidate.indexOf('{')
            const end = rawCandidate.lastIndexOf('}')
            if (start !== -1 && end > start) {
              try {
                parsedProposal = JSON.parse(rawCandidate.slice(start, end + 1))
              } catch {
                parsedProposal = null
              }
            }
          }
        }

        if (!parsedProposal || parsedProposal.side === 'HOLD') {
          // Record an advice action
          const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
          const idempotencyKey = `ai_adv_${agentId}_${Math.floor(now / 60000)}`

          await m.AiAgentAction.updateOne(
            { agentId, ownerId, idempotencyKey },
            {
              $setOnInsert: {
                _id: actionId,
                actionId,
                agentId,
                ownerId,
                agentVersionId: version.versionId,
                autonomy: version.autonomy || 'A2',
                type: 'advice',
                status: 'allowed',
                code: 'OK',
                message: 'Market analysis completed: HOLD/WAIT',
                idempotencyKey,
                payload: { symbol, side: 'HOLD', summary: replyText.slice(0, 300) },
                reason: replyText.slice(0, 300),
                at: now
              }
            },
            { upsert: true }
          ).catch(() => null)

          await m.AiAgent.updateOne(
            { _id: agent._id },
            { $inc: { 'actionCounts.allowed': 1 }, $set: { lastEventAt: now } }
          ).catch(() => null)

          cycles.push({ agentId, action: 'advice_hold', text: replyText.slice(0, 100) })
          continue
        }

        // 5. Valid Proposal -> record in ai_proposals and ai_agent_actions
        const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        const idempotencyKey = `ai_prop_${agentId}_${Math.floor(now / 60000)}`

        // 6. Autonomous Risk Gate Evaluation (A2+ Autonomy)
        let proposalStatus = 'new'
        let actionStatus = 'allowed'
        let actionCode = 'OK'
        let actionMessage = `Generated trade proposal: ${parsedProposal.side} ${symbol} @ ${parsedProposal.entry}`

        if (version.autonomy === 'A2' || version.autonomy === 'A1') {
          try {
            const riskConfig = { ...loadRiskConfig(), ownerId }
            const entryPrice = Number(parsedProposal.entry)
            const slPrice = Number(parsedProposal.sl)
            const riskDist = Math.abs(entryPrice - slPrice)
            const equity = 10000
            const maxLev = riskConfig.maxLeverage || 5
            const maxLevQty = entryPrice > 0 ? (equity * maxLev * 0.9) / entryPrice : 1
            const baseQty = riskDist > 0 ? (((equity * (riskConfig.riskPerTradePct || 1)) / 100) * 0.95) / riskDist : maxLevQty
            const safeQty = Math.max(0.001, Math.min(baseQty, maxLevQty))

            // Ensure TP meets minRR (1.5x risk distance)
            const dir = parsedProposal.side === 'LONG' ? 1 : -1
            let tpPrice = Number(parsedProposal.tp)
            const currentRr = riskDist > 0 ? ((tpPrice - entryPrice) * dir) / riskDist : 0
            if (currentRr < 1.5) {
              tpPrice = Number((entryPrice + dir * riskDist * 1.6).toFixed(2))
            }

            const riskDecision = await checkOrder({
              symbol,
              dir,
              entry: entryPrice,
              entryPrice,
              sl: slPrice,
              tps: [tpPrice],
              qty: Number(safeQty.toFixed(6)),
              source: 'ai_agent'
            }, riskConfig)

            if (riskDecision.ok) {
              proposalStatus = version.autonomy === 'A2' ? 'accepted' : 'new'
              actionStatus = 'allowed'
              actionMessage = `[${version.autonomy} Risk Gate: OK] qty=${riskDecision.qty} notional=${riskDecision.notional?.toFixed(2)}: ${parsedProposal.side} ${symbol}`

              // Enqueue alert for paper execution
              if (m.Alert) {
                const alertKey = `ai_${agentId}_${Math.floor(now / 60000)}`
                await m.Alert.updateOne(
                  { alertKey, ownerId },
                  {
                    $setOnInsert: {
                      alertKey,
                      ownerId,
                      accountId: agent.accountId || 'paper-main',
                      source: 'ai_agent',
                      action: 'ENTRY',
                      side: parsedProposal.side === 'LONG' ? 'BUY' : 'SELL',
                      symbol: parsedProposal.symbol || symbol,
                      price: entryPrice,
                      sl: slPrice,
                      tps: [tpPrice],
                      status: 'received',
                      ts: new Date(now),
                      raw: JSON.stringify({ ...parsedProposal, type: 'market', qty: Number(safeQty.toFixed(6)) })
                    }
                  },
                  { upsert: true }
                ).catch(() => null)
              }
            } else {
              proposalStatus = 'rejected'
              actionStatus = 'blocked'
              actionCode = riskDecision.code || 'RISK_REJECT'
              actionMessage = `[${version.autonomy} Risk Gate: Blocked] ${riskDecision.message}`
            }
          } catch (riskErr) {
            log.warn('[ai-agent-worker] risk check error:', riskErr?.message)
          }
        }

        // Insert into ai_proposals
        await m.AiProposal.create({
          _id: proposalId,
          proposalId,
          ownerId,
          strategyVersionId: version.versionId,
          hypothesis: parsedProposal.hypothesis || `AI ${parsedProposal.side} on ${symbol}`,
          changes: [{
            symbol,
            side: parsedProposal.side,
            entry: parsedProposal.entry,
            sl: parsedProposal.sl,
            tp: parsedProposal.tp
          }],
          evidence: [{
            kind: 'ai_analysis',
            model: aiReply.model,
            rationale: parsedProposal.rationale
          }],
          risks: ['market_volatility', 'slippage'],
          status: proposalStatus
        }).catch(err => log.warn('[ai-agent-worker] proposal create failed:', err?.message))

        // Record action in ledger
        await m.AiAgentAction.updateOne(
          { agentId, ownerId, idempotencyKey },
          {
            $setOnInsert: {
              _id: actionId,
              actionId,
              agentId,
              ownerId,
              agentVersionId: version.versionId,
              autonomy: version.autonomy || 'A2',
              type: 'proposal',
              status: actionStatus,
              code: actionCode,
              message: actionMessage,
              idempotencyKey,
              payload: {
                proposalId,
                symbol,
                side: parsedProposal.side,
                entry: parsedProposal.entry,
                sl: parsedProposal.sl,
                tp: parsedProposal.tp,
                hypothesis: parsedProposal.hypothesis
              },
              reason: parsedProposal.rationale || parsedProposal.hypothesis || 'AI trade setup',
              at: now
            }
          },
          { upsert: true }
        ).catch(() => null)

        await m.AiAgent.updateOne(
          { _id: agent._id },
          {
            $inc: { [`actionCounts.${actionStatus}`]: 1 },
            $set: { lastEventAt: now }
          }
        ).catch(() => null)

        log.log(`[ai-agent-worker] Agent ${agent.name} ${actionMessage}`)
        cycles.push({ agentId, action: 'proposal_created', proposalId, side: parsedProposal.side, status: proposalStatus })
      }

      return { ok: true, activeCount: activeAgents.length, cycles }
    } catch (err) {
      log.warn('[ai-agent-worker] tick failed:', err?.message ?? err)
      return { ok: false, error: err?.message }
    } finally {
      ticking = false
    }
  }

  let timer = null

  function start() {
    if (timer) return
    stopped = false
    log.log(`[ai-agent-worker] started (interval=${Math.round(intervalMs / 1000)}s)`)
    void tick()
    timer = setInterval(() => { void tick() }, intervalMs)
  }

  function stop() {
    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    log.log('[ai-agent-worker] stopped')
  }

  return { tick, start, stop }
}
