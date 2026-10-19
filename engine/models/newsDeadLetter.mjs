// engine/models/newsDeadLetter.mjs
// Dead-letter / review queue for malformed connector payloads (V3.5 §60.5,
// §60.16 Slice F): a feed that answers 200 with something that is not a feed, or
// a 2xx body that yields zero usable items, must be visible to an operator
// instead of looking like a quiet empty cycle.
//
// Rights-safe by construction: the body is never stored — `payloadHash`, `bytes`
// and `contentType` prove what failed without keeping a copy of licensed text.
// `_id` is deterministic per (sourceId, url, reason) so a repeated failure
// updates one row (`fails` increments) instead of flooding the queue.
import mongoose from 'mongoose'
import { NEWS_RETENTION_SECONDS } from '../newsIngest.mjs'

const NewsDeadLetterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // ndl_<sha1(sourceId|url|reason)>
    sourceId: { type: String, required: true, index: true },
    url: { type: String, required: true },
    reason: { type: String, required: true, index: true }, // malformed_payload | empty_feed | permanent_error | exhausted
    httpStatus: { type: Number, default: null },
    attempts: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    contentType: { type: String, default: null },
    payloadHash: { type: String, default: null }, // proof of what failed, never the body
    firstFailedAt: { type: Date, required: true },
    lastFailedAt: { type: Date, required: true },
    fails: { type: Number, default: 1 },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: null },
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: false, collection: 'news_dead_letters' },
)

// Same retention ceiling as the items the queue is about (license matrix v1):
// a review item nobody looked at in a week is not evidence, it is noise.
NewsDeadLetterSchema.index({ lastFailedAt: 1 }, { expireAfterSeconds: NEWS_RETENTION_SECONDS })
NewsDeadLetterSchema.index({ sourceId: 1, lastFailedAt: -1 })

export const NewsDeadLetter =
  mongoose.models.news_dead_letters || mongoose.model('news_dead_letters', NewsDeadLetterSchema)
