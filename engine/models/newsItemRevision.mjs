// engine/models/newsItemRevision.mjs
// §60.11 append-only item history. One row is written the first time an item is
// seen (`kind: 'ingested'`) and again whenever a material field changes
// (`kind: 'revised'`), capturing the PREVIOUS title/excerpt/level/dir/tags —
// "what was previously known". `_id = nir_<sha1(itemId|contentHash)>` is
// DETERMINISTIC, so re-ingesting identical content never writes a new row.
//
// Rights-safe: title + excerpt only (≤240 chars), never full text. Retention
// mirrors the item envelope TTL (license matrix v1).
import mongoose from 'mongoose'
import { NEWS_RETENTION_SECONDS } from '../newsIngest.mjs'

const PrevSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    excerpt: { type: String, default: '' },
    level: { type: String, default: null },
    dir: { type: String, default: null },
    tags: { type: [String], default: [] },
    eventType: { type: String, default: null },
  },
  { _id: false },
)

const NewsItemRevisionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // nir_<sha1(itemId|contentHash)>
    itemId: { type: String, required: true, index: true },
    sourceId: { type: String, default: null },
    kind: { type: String, enum: ['ingested', 'revised'], default: 'revised', index: true },
    at: { type: Date, required: true },
    contentHash: { type: String, required: true },
    prevContentHash: { type: String, default: null },
    prev: { type: PrevSchema, default: () => ({}) },
    note: { type: String, default: '' },
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: false, collection: 'news_item_revisions' },
)

NewsItemRevisionSchema.index({ itemId: 1, at: -1 })
NewsItemRevisionSchema.index({ at: 1 }, { expireAfterSeconds: NEWS_RETENTION_SECONDS })

export const NewsItemRevision =
  mongoose.models.news_item_revisions || mongoose.model('news_item_revisions', NewsItemRevisionSchema)
