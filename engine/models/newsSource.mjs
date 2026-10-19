// engine/models/newsSource.mjs
// News source registry (V3.5 §60 Slice B): policy-backed, not a hardcoded
// list. `_id = sourceId` is DETERMINISTIC — the seeder upserts policy fields
// with $setOnInsert, so an operator edit is never overwritten. Health fields
// are $set on every ingest run. Secrets (API tokens) are NEVER stored here.
import mongoose from 'mongoose'

const RightsSchema = new mongoose.Schema(
  {
    allowedStoreMetadata: { type: Boolean, default: false },
    allowedDisplay: { type: Boolean, default: false },
    allowedSummarize: { type: Boolean, default: false },
    allowedTraining: { type: Boolean, default: false },
  },
  { _id: false },
)

const HealthSchema = new mongoose.Schema(
  {
    state: { type: String, enum: ['ok', 'degraded', 'down', 'unknown'], default: 'unknown' },
    lastFetchAt: { type: Date, default: null },
    lastOkAt: { type: Date, default: null },
    lastItemAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    consecutiveErrors: { type: Number, default: 0 },
  },
  { _id: false },
)

const NewsSourceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // sourceId: coindesk | cointelegraph | decrypt | cryptopanic
    sourceId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    provider: { type: String, default: null },
    transport: { type: String, enum: ['rss', 'api', 'licensed', 'manual'], required: true },
    feedUrl: { type: String, default: null }, // public endpoint only — never a tokenized URL
    trustTier: {
      type: String,
      enum: ['T0_PRIMARY', 'T1_LICENSED_NEWS', 'T2_SECONDARY', 'T3_UNVERIFIED_SOCIAL'],
      default: 'T2_SECONDARY',
      index: true,
    },
    marketGroups: { type: [String], default: ['crypto'] },
    languages: { type: [String], default: ['en'] },
    licenseStatus: { type: String, enum: ['ok', 'unknown', 'revoked'], default: 'unknown', index: true },
    rights: { type: RightsSchema, default: () => ({}) },
    /** Operator switch (§60.2 registry): disabled sources are neither fetched nor displayed. */
    enabled: { type: Boolean, default: true, index: true },
    pollIntervalSec: { type: Number, default: 600 },
    retentionDays: { type: Number, default: 7 },
    /**
     * §60.12 manual reprocessing. An operator retry stamps this; the runner
     * polls the source immediately (cadence bypass) and clears it on the next
     * successful fetch. It is the durable request id — no separate queue.
     */
    retryRequestedAt: { type: Date, default: null },
    health: { type: HealthSchema, default: () => ({}) },
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: true, collection: 'news_sources' },
)

export const NewsSource =
  mongoose.models.news_sources || mongoose.model('news_sources', NewsSourceSchema)
