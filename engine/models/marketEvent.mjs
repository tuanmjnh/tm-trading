// engine/models/marketEvent.mjs
// Canonical market-event view (V3.5 §60 Slice C): one doc per clustered story.
// `_id = 'evt_' + sha1(fingerprint)` is DETERMINISTIC (engine/newsEvents.mjs)
// so re-clustering upserts the same event — one event, many source items, all
// retained with provenance. Corrections are append-only revisions; history is
// never rewritten (reproducibility for research/PIT).
import mongoose from 'mongoose'

const EntityLinkSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    confidence: { type: Number, required: true },
    uncertain: { type: Boolean, default: true },
    matched: { type: String, enum: ['ticker', 'word'], default: 'word' },
  },
  { _id: false },
)

const RevisionSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    kind: { type: String, enum: ['correction', 'retraction', 'amendment', 'note'], required: true },
    itemId: { type: String, default: null },
    note: { type: String, default: '' },
  },
  { _id: false },
)

const MarketEventSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // evt_<sha1(fingerprint)>
    fingerprint: { type: String, required: true, index: true },
    title: { type: String, required: true }, // representative: earliest item title
    marketGroup: { type: String, default: 'crypto', index: true },
    eventType: { type: String, default: null, index: true },
    status: { type: String, enum: ['active', 'corrected', 'retracted'], default: 'active', index: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    itemIds: { type: [String], default: [] }, // every source item, provenance kept
    corroboration: {
      independentSources: { type: Number, default: 1 },
      sourceIds: { type: [String], default: [] },
      dirs: { type: [String], default: [] },
      status: {
        type: String,
        enum: ['single_source', 'multi_source', 'contradicted'],
        default: 'single_source',
      },
    },
    entities: { type: [EntityLinkSchema], default: [] },
    revisions: { type: [RevisionSchema], default: [] }, // append-only
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: false, collection: 'news_market_events' },
)

MarketEventSchema.index({ marketGroup: 1, status: 1, lastSeenAt: -1 })
MarketEventSchema.index({ 'corroboration.status': 1, lastSeenAt: -1 })

export const MarketEvent =
  mongoose.models.news_market_events || mongoose.model('news_market_events', MarketEventSchema)
