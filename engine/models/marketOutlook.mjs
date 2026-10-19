// engine/models/marketOutlook.mjs
// Market outlook snapshots (V3.5 §60 Slice D): one doc per (group, horizon,
// UTC day). Deterministic builder (engine/outlook.mjs) — same evidence in,
// same `_id` and hash out. Expired snapshots stay readable but must render as
// stale; readers check expiresAt.
import mongoose from 'mongoose'

const EvidenceRefSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['event', 'item'], required: true },
    id: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String, default: null },
    corroboration: { type: String, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
)

const MarketOutlookSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // outlook_<group>_<horizon>_<YYYY-MM-DD>
    marketGroup: { type: String, required: true, index: true },
    horizon: { type: String, enum: ['short_term', 'swing', 'long_term'], required: true, index: true },
    horizonDays: { type: Number, required: true },
    extractorModelVersion: { type: String, required: true },
    schemaVersion: { type: String, default: '1' },
    generatedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    evidenceHash: { type: String, default: '' },
    state: {
      type: String,
      enum: ['bullish', 'bearish', 'neutral', 'mixed', 'insufficient_evidence'],
      required: true,
    },
    supporting: { type: [EvidenceRefSchema], default: [] },
    counterEvidence: { type: [EvidenceRefSchema], default: [] },
    contradictionCount: { type: Number, default: 0 },
    multiSourceCount: { type: Number, default: 0 },
    singleSourceCount: { type: Number, default: 0 },
    limitations: { type: [String], default: [] },
    invalidation: { type: String, default: '' },
    // §60.12 propagation: a correction/retraction behind this snapshot stamps it
    // so readers stop presenting it as current. Distinct from `invalidation`
    // (the builder's own refusal reason) — this is an external event.
    invalidatedAt: { type: Date, default: null, index: true },
    staleReason: { type: String, default: null },
  },
  { timestamps: false, collection: 'news_market_outlooks' },
)

MarketOutlookSchema.index({ marketGroup: 1, horizon: 1, generatedAt: -1 })

export const MarketOutlook =
  mongoose.models.news_market_outlooks || mongoose.model('news_market_outlooks', MarketOutlookSchema)
