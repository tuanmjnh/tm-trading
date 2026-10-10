// engine/models/strategyVersion.mjs
// Immutable strategy versions (roadmap §26.2 + §29). `_id = strategyId@version`
// (D3); the identity FINGERPRINT makes an attempted in-place change loud —
// published versions are immutable, new parameters get a new row.
import mongoose from 'mongoose'

import { VERSION_STATES, STRATEGY_SCHEMA_VERSION } from '../strategy.mjs'

const StrategyVersionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `tm-vsa@1.4.0`
    strategyVersionId: { type: String, required: true, index: true },
    strategyId: { type: String, required: true, index: true },
    version: { type: String, required: true },

    engineVersion: { type: String, default: null },
    paramsHash: { type: String, required: true, index: true },
    referenceHash: { type: String, default: null },
    indicatorVersions: { type: mongoose.Schema.Types.Mixed, default: {} },
    methodVersions: { type: mongoose.Schema.Types.Mixed, default: {} },
    parameters: { type: mongoose.Schema.Types.Mixed, default: {} },

    supersedes: { type: String, default: null },
    changes: { type: mongoose.Schema.Types.Mixed, default: [] },

    status: { type: String, enum: VERSION_STATES, default: 'draft', index: true },
    history: { type: mongoose.Schema.Types.Mixed, default: [] },
    // §29 promotion evidence — measured, never defaulted.
    backtestRunId: { type: String, default: null },
    holdoutRunId: { type: String, default: null },
    acceptedExperimentId: { type: String, default: null },
    paperTrades: { type: Number, default: null },

    createdBy: { type: String, default: null },
    createdAt: { type: Number, default: null },
    fingerprint: { type: String, default: null },
    schemaVersion: { type: String, default: STRATEGY_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'strategy_versions' },
)

StrategyVersionSchema.index({ strategyId: 1, status: 1 })

export const StrategyVersion =
  mongoose.models.strategy_versions || mongoose.model('strategy_versions', StrategyVersionSchema)