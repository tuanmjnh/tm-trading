// engine/models/tradeContext.mjs
// Trade context ledger (roadmap §26.6 — `trade_context`, "the future AI
// dataset"): one row per COMPLETED paper trade joining the position facts,
// the close result and the §26.3 snapshot ids. `_id = tc:${tradeId}` (D3) and
// writes are $setOnInsert (D4) — the first close is the recorded fact.
//
// Honest nulls (D12): strategyVersionId / indicators / regime / fundingOi /
// newsContext stay null until their producer services exist — an AI dataset
// full of guessed context is worse than one full of nulls.
import mongoose from 'mongoose'

import { TRADE_CONTEXT_SCHEMA_VERSION } from '../../exec/tradeContext.mjs'

const TradeContextSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `tc:${tradeId}`
    tradeContextId: { type: String, required: true, index: true },
    tradeId: { type: String, required: true },
    accountId: { type: String, default: null },

    strategyVersionId: { type: String, default: null },
    method: { type: String, default: null },
    stamp: { type: mongoose.Schema.Types.Mixed, default: null },
    symbol: { type: String, required: true },
    venue: { type: String, default: null },
    timeframe: { type: String, default: null },
    direction: { type: String, enum: ['long', 'short', null], default: null },

    entrySnapshotId: { type: String, default: null },
    exitSnapshotId: { type: String, default: null },

    indicators: { type: mongoose.Schema.Types.Mixed, default: null },
    marketRegime: { type: mongoose.Schema.Types.Mixed, default: null },
    fundingOi: { type: mongoose.Schema.Types.Mixed, default: null },
    newsContext: { type: mongoose.Schema.Types.Mixed, default: null },

    execution: { type: mongoose.Schema.Types.Mixed, default: {} },
    outcome: { type: mongoose.Schema.Types.Mixed, default: {} },

    recordedAt: { type: Number, default: null },
    schemaVersion: { type: String, default: TRADE_CONTEXT_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'trade_context' },
)

TradeContextSchema.index({ symbol: 1, recordedAt: -1 })
TradeContextSchema.index({ strategyVersionId: 1, recordedAt: -1 })
TradeContextSchema.index({ 'outcome.state': 1, recordedAt: -1 })

export const TradeContext =
  mongoose.models.trade_context || mongoose.model('trade_context', TradeContextSchema)