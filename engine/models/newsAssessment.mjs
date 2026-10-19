// engine/models/newsAssessment.mjs
// Versioned NLP/rule extraction per NewsItem (V3.5 §60 Slice D, §60.6 shape).
// `_id = itemId|extractorVersion` — versions coexist, never overwrite.
// rule-v1 rows are deterministic (engine/newsAssess.mjs); a future model
// extractor writes its own version alongside.
import mongoose from 'mongoose'

const ClaimSchema = new mongoose.Schema(
  {
    claimId: { type: String, required: true },
    claimType: {
      type: String,
      enum: ['fact', 'quote', 'estimate', 'opinion', 'rumor', 'correction'],
      required: true,
    },
    claimText: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    confidence: { type: Number, required: true },
    verification: {
      type: String,
      enum: ['primary_confirmed', 'multi_source', 'single_source', 'unverified', 'contradicted'],
      required: true,
    },
  },
  { _id: false },
)

const EntitySchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true },
    sourceText: { type: String, required: true },
    normalizedId: { type: String, default: null },
    confidence: { type: Number, default: 0 },
  },
  { _id: false },
)

const NewsAssessmentSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // itemId|extractorVersion
    sourceItemId: { type: String, required: true, index: true },
    eventId: { type: String, default: null, index: true },
    extractorModelVersion: { type: String, required: true, index: true },
    schemaVersion: { type: Number, required: true },
    normalizedHeadline: { type: String, required: true },
    claims: { type: [ClaimSchema], default: [] },
    entities: { type: [EntitySchema], default: [] },
    eventType: { type: String, default: null },
    affectedMarkets: { type: [String], default: [] },
    potentialDrivers: { type: [String], default: [] },
    impactConfidence: { type: Number, default: 0 },
    counterEvidenceNeeded: { type: [String], default: [] },
    humanReviewRequired: { type: Boolean, default: false, index: true },
    assessedAt: { type: Date, required: true },
  },
  { timestamps: false, collection: 'news_assessments' },
)

export const NewsAssessment =
  mongoose.models.news_assessments || mongoose.model('news_assessments', NewsAssessmentSchema)
