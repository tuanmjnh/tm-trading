// engine/models/indicatorRun.mjs
// Indicator run record (roadmap §30.3, D1). One row per indicator computation
// executed through POST /api/v1/indicator-runs: the canonicalized params, the
// bar window it ran over, and the aligned output series. `version` + `schemaVersion`
// stamp the definition + model schema so a re-read never mixes generations
// (D1). Default ObjectId `_id` — runs are append-only computations, not
// idempotency-critical writes, so no natural key is forced.
import mongoose from 'mongoose'

const INDICATOR_RUN_SCHEMA_VERSION = '1'

const IndicatorRunSchema = new mongoose.Schema(
  {
    // --- identity (D1) ---
    indicatorId: { type: String, required: true, index: true },
    version: { type: String, required: true }, // indicator def.version used
    schemaVersion: { type: String, default: INDICATOR_RUN_SCHEMA_VERSION },

    // --- scope ---
    symbol: { type: String, required: true },
    tf: { type: String, required: true }, // interval (1m/4m/.../1w)
    market: { type: String, enum: ['spot', 'futures'], default: 'futures' },

    // Effective canonicalized parameter set, not raw user input
    params: { type: mongoose.Schema.Types.Mixed, required: true },

    bars: { type: Number, default: 0 },
    window: {
      from: { type: Number, default: null }, // epoch ms (UTC, D2)
      to: { type: Number, default: null },
    },

    // --- result ---
    outputs: { type: mongoose.Schema.Types.Mixed, default: {} }, // { key: Array<number|null> }
    lastPoints: { type: mongoose.Schema.Types.Mixed, default: {} }, // { key: number|null }
  },
  { timestamps: true, collection: 'indicator_runs' },
)

// Dashboard "latest N runs for this indicator/symbol/timeframe" + a plain
// recency index for the list view.
IndicatorRunSchema.index({ indicatorId: 1, symbol: 1, tf: 1, createdAt: -1 })
IndicatorRunSchema.index({ createdAt: -1 })

export const IndicatorRun =
  mongoose.models.indicator_runs || mongoose.model('indicator_runs', IndicatorRunSchema)