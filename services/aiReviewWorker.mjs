// services/aiReviewWorker.mjs
// =============================================================================
//  CONTINUOUS AI REVIEW & CLOSED-LOOP TRAINING WORKER (roadmap Phase 13 / ADR-004)
//
//  Autonomously runs periodic trade journal analysis:
//    1. Projects closed positions into the trade journal (`syncJournal`),
//    2. Evaluates performance statistics and error patterns (`reviewDigest`),
//    3. Analyzes failure modes with AI optimizer agent (`runReview`),
//    4. Persists synthesized learning constraints into `ai_learning_rules`,
//    5. Beats service heartbeat (`ai-review`),
//    6. Provides dynamic rule injection for active AI trading agents.
// =============================================================================

import { loadEnv } from '../exec/env.mjs'
import { connectMongo } from '../engine/db.mjs'
import { loadJournal, syncJournal } from '../engine/journal.mjs'
import { runReview, reviewDigest } from '../ai/review.mjs'
import { beat } from './heartbeat.mjs'

loadEnv()

let modelsMemo = null

async function getModels() {
  if (modelsMemo) return modelsMemo
  const mg = await connectMongo()
  if (!mg) return null
  const { AiLearningRule, Journal } = await import('../engine/models/index.mjs')
  modelsMemo = { AiLearningRule, Journal }
  return modelsMemo
}

/**
 * Fetch active learned constraints for an owner or global.
 * Injected into AI agent prompts during realtime analysis.
 */
export async function getActiveLearnedRules(ownerId, limit = 5) {
  try {
    const m = await getModels()
    if (!m) return []
    const q = { status: 'active' }
    if (ownerId) {
      q.$or = [{ ownerId }, { ownerId: 'global' }]
    }
    const rules = await m.AiLearningRule.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
    return rules
  } catch {
    return []
  }
}

export function createAiReviewWorker({
  intervalMs = 300_000, // 5 minutes default
  log = console,
} = {}) {
  let stopped = false
  let ticking = false
  let beatCount = 0

  async function tick({ force = false } = {}) {
    if (stopped || ticking) return { ok: true, skipped: true }
    ticking = true

    try {
      const m = await getModels()
      if (!m) {
        await beat('ai-review', { lastErrorAt: new Date().toISOString(), lastError: 'mongo_down' })
        return { ok: false, code: 'mongo_down' }
      }

      // 1. Sync positions into journal
      try {
        await syncJournal({ mongo: true })
      } catch (err) {
        log.warn('[ai-review-worker] syncJournal warning:', err?.message ?? err)
      }

      // 2. Load recent journal entries
      const { entries = [] } = await loadJournal({ mongo: true, limit: 100 })
      const digest = reviewDigest(entries, { minTrades: 5 })

      // If no closed trades and not forced, record idle beat
      if (!entries.length && !force) {
        beatCount++
        await beat('ai-review', {
          intervalSec: Math.round(intervalMs / 1000),
          lastOkAt: new Date().toISOString(),
          lastSummary: 'journal=0 closed trades; awaiting executions',
          count: beatCount,
        })
        return { ok: true, skipped: true, reason: 'no_journal_entries' }
      }

      log.log(`[ai-review-worker] running review on ${entries.length} trade(s) (rSamples=${digest.overall.rSamples})`)

      // 3. Run AI Review
      const reviewResult = await runReview({
        digest,
        force: true, // Review available trades even if below threshold
        tag: '[ai:review-worker]',
      }).catch((err) => {
        log.warn('[ai-review-worker] runReview failed:', err?.message ?? err)
        return { ok: false, error: err?.message, proposals: [] }
      })

      const proposals = reviewResult?.proposals || []
      const learned = []

      // 4. Save learned rules to database
      if (proposals.length > 0) {
        for (const p of proposals) {
          const ruleId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
          const doc = {
            _id: ruleId,
            ruleId,
            ownerId: '821c0885-6db5-484a-9d8e-f266c71715c4', // Root tenant
            category: p.kind || 'other',
            rule: p.rule || p.proposal || 'Tighten risk parameters based on review',
            reasoning: p.rationale || p.reason || '',
            confidence: 0.85,
            sampleSize: digest.overall.closed || 0,
            evidence: {
              winRate: digest.overall.winRate,
              expectancyR: digest.overall.expectancyR,
              medianR: digest.overall.medianR,
              worstTrade: digest.worstClosed?.[0] || null,
            },
            status: 'active',
            source: 'continuous_review',
            model: reviewResult.model || 'ai-optimizer',
          }

          await m.AiLearningRule.create(doc).catch(() => null)
          learned.push(doc)
        }
        log.log(`[ai-review-worker] Synthesized ${learned.length} active learning rule(s) from journal`)
      }

      beatCount++
      await beat('ai-review', {
        intervalSec: Math.round(intervalMs / 1000),
        lastOkAt: new Date().toISOString(),
        lastSummary: `journal=${entries.length} trades, rulesCreated=${learned.length}`,
        count: beatCount,
      })

      return {
        ok: true,
        tradesReviewed: entries.length,
        proposalsCreated: learned.length,
        rules: learned,
      }
    } catch (err) {
      log.warn('[ai-review-worker] tick failed:', err?.message ?? err)
      await beat('ai-review', {
        lastErrorAt: new Date().toISOString(),
        lastError: String(err?.message ?? err).slice(0, 200),
      })
      return { ok: false, error: err?.message }
    } finally {
      ticking = false
    }
  }

  let timer = null

  function start() {
    if (timer) return
    stopped = false
    log.log(`[ai-review-worker] started (interval=${Math.round(intervalMs / 1000)}s)`)
    void tick()
    timer = setInterval(() => { void tick() }, intervalMs)
  }

  function stop() {
    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    log.log('[ai-review-worker] stopped')
  }

  return { tick, start, stop }
}
