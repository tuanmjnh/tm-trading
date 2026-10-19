// engine/models/newsEvidenceSet.mjs
// Frozen news evidence for research runs (V3.5 §60 Slice E): the exact list
// of news/event/macro rows available to one evaluation, with vintage-pinned
// macro observations and PIT flags. `_id` is DETERMINISTIC (engine/
// newsEvidenceSet.mjs) — refreezing the same query hits the same id and
// cannot fork a second version of the same truth. Contents are covered by
// `hash`; the store never updates them. The only permitted mutation is the
// append-only `usedByExperimentIds` back-reference list.
//
// `itemRefs`/`eventRefs`/`observationRefs` are the §60.11 retention exception:
// the cited rows' rights-safe references are COPIED at freeze time, so the
// 7-day `NewsItem` TTL cannot erode a frozen set into dangling citations.
import mongoose from 'mongoose'

const NewsEvidenceSetSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // nev_<sha1(sorted ids|asOf|purpose)>
    setId: { type: String, required: true, index: true },
    // Tenancy (roadmap §61.3): the frozen set belongs to the owner who froze it.
    ownerId: { type: String, default: null, index: true },
    purpose: { type: String, required: true }, // evaluation | agent-packet | outlook
    group: { type: String, default: 'crypto' },
    symbols: { type: [String], default: [] },
    horizon: { type: String, default: null },
    asOf: { type: Date, required: true }, // PIT cutoff (information-available time)
    itemIds: { type: [String], default: [] },
    eventIds: { type: [String], default: [] },
    observationIds: { type: [String], default: [] }, // vintage-pinned macro rows
    // Frozen citations (rights-safe: id, title, source, url, times, hash — no text).
    itemRefs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    eventRefs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    observationRefs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    refPolicy: { type: mongoose.Schema.Types.Mixed, default: {} },
    pitFlags: { type: mongoose.Schema.Types.Mixed, default: {} },
    rights: { type: mongoose.Schema.Types.Mixed, default: {} },
    hash: { type: String, required: true, index: true },
    frozen: { type: Boolean, default: true },
    immutable: { type: Boolean, default: true },
    usedByExperimentIds: { type: [String], default: [] },
    createdBy: { type: String, default: null },
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: true, collection: 'news_evidence_sets' },
)

NewsEvidenceSetSchema.index({ purpose: 1, createdAt: -1 })

export const NewsEvidenceSet =
  mongoose.models.news_evidence_sets || mongoose.model('news_evidence_sets', NewsEvidenceSetSchema)
