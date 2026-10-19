// engine/models/newsEvaluation.mjs
// News-impact scorecard records (V3.5 §60 Slice E): one doc per
// (group, horizon, symbols, asOf) evaluation. Deterministic `_id` —
// re-running the same evaluation hits the same id (append-only history of
// distinct evaluations, never silent overwrites).
import mongoose from 'mongoose'

const ScoreRowSchema = new mongoose.Schema(
  {
    snapshotId: { type: String, required: true },
    symbol: { type: String, required: true },
    state: { type: String, required: true },
    actual: { type: String, required: true },
    hit: { type: Boolean, required: true },
    baseline: { type: Boolean, default: null },
    beatBaseline: { type: Boolean, default: null },
  },
  { _id: false },
)

const NewsEvaluationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // nsc_<sha1(group|horizon|symbols|asOf|n)>
    // Tenancy (roadmap §61.3): the scorecard belongs to the owner who ran it.
    ownerId: { type: String, default: null, index: true },
    group: { type: String, required: true, index: true },
    horizon: { type: String, required: true },
    symbols: { type: [String], default: [] },
    asOf: { type: Date, required: true },
    snapshots: { type: Number, default: 0 },
    excluded: { type: Number, default: 0 },
    hits: { type: Number, default: 0 },
    hitRate: { type: Number, default: null },
    baselineSnapshots: { type: Number, default: 0 },
    baselineHits: { type: Number, default: 0 },
    baselineHitRate: { type: Number, default: null },
    rows: { type: [ScoreRowSchema], default: [] },
    limitations: { type: [String], default: [] },
    schemaVersion: { type: String, default: '1' },
    createdBy: { type: String, default: null },
  },
  { timestamps: true, collection: 'news_model_evaluations' },
)

NewsEvaluationSchema.index({ group: 1, horizon: 1, asOf: -1 })

export const NewsEvaluation =
  mongoose.models.news_model_evaluations || mongoose.model('news_model_evaluations', NewsEvaluationSchema)
