// engine/models/newsItem.mjs
// Normalized news envelope (V3.5 §60 Slice B): one doc per story URL.
// `_id = 'news_' + sha1(canonicalUrl)` is DETERMINISTIC (engine/newsIngest.mjs)
// so re-ingest/replay/retry upserts the same id — duplicates are impossible by
// construction. Retention: TTL on `ingestedAt` (7 days, license matrix v1).
// Rights-safe by design: title + excerpt (<=240 chars) only, original language
// preserved (no translation at rest — rights-gated, roadmap §60.5 decision
// 2026-10-17), no full text stored anywhere. Material changes append a
// `news_item_revisions` row before the envelope is updated (§60.11).
import mongoose from 'mongoose'
import { NEWS_RETENTION_SECONDS } from '../newsIngest.mjs'

const NewsItemSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // news_<sha1(canonicalUrl)>
    sourceId: { type: String, required: true, index: true },
    url: { type: String, required: true }, // canonical (identity)
    originUrl: { type: String, required: true }, // as seen (citation/link-out)
    title: { type: String, required: true }, // original language, untranslated
    excerpt: { type: String, default: '' }, // <=240 chars, rights-safe
    language: { type: String, default: 'en' },
    publishedAt: { type: Date, default: null }, // provider timestamp (may be null)
    firstSeenAt: { type: Date, required: true }, // ingestion observation time
    ingestedAt: { type: Date, required: true }, // TTL base — never rewrite on re-ingest
    marketGroup: { type: String, default: 'crypto', index: true },
    eventType: { type: String, default: null }, // Slice C fills this
    tags: { type: [String], default: [] },
    level: { type: String, enum: ['high', 'med', 'low'], default: 'med', index: true },
    score: { type: Number, default: 0 },
    dir: { type: String, enum: ['pos', 'neg', 'flat'], default: 'flat' },
    rights: {
      allowedDisplay: { type: Boolean, default: true },
      allowedSummarize: { type: Boolean, default: false },
    },
    hash: { type: String, default: null }, // sha1(title|canonicalUrl), change detection
    // §60.11 material-change fingerprint (title|excerpt|level|dir|tags|eventType).
    // A change appends a `news_item_revisions` row before the envelope is updated.
    contentHash: { type: String, default: null },
    updatedAt: { type: Date, default: null }, // last material update; ingestedAt stays frozen
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: false, collection: 'news_items' },
)

// Retention ceiling (license matrix v1): Mongo prunes ~7 days after ingest.
NewsItemSchema.index({ ingestedAt: 1 }, { expireAfterSeconds: NEWS_RETENTION_SECONDS })
NewsItemSchema.index({ sourceId: 1, ingestedAt: -1 })
NewsItemSchema.index({ marketGroup: 1, level: 1, ingestedAt: -1 })

export const NewsItem =
  mongoose.models.news_items || mongoose.model('news_items', NewsItemSchema)
