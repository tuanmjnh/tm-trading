// engine/models/evidenceSet.mjs
// Research Evidence Sets (V3.5 §59.11 / §59.15 Slice E): the frozen bundle of
// facts an AI conclusion was drawn from. `_id = setId` is DETERMINISTIC from the
// source (engine/evidence.mjs evidenceSetIdFor), so re-freezing a session hits
// the same id and cannot fork a second version of the same truth. Contents are
// covered by `hash`; the store never updates them (verifyEvidenceSet re-detects
// any edit). The only permitted mutation is the append-only
// `usedByExperimentIds` list — which experiments cited this set.
import mongoose from 'mongoose'
import { EVIDENCE_KINDS, EVIDENCE_SCHEMA_VERSION } from '../evidence.mjs'

const EvidenceSetSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // ev_<kind>_<sourceId>
    setId: { type: String, required: true, index: true },
    kind: { type: String, enum: [...EVIDENCE_KINDS], required: true, index: true },
    sourceId: { type: String, required: true, index: true },
    sessionId: { type: String, default: null, index: true },
    state: { type: String, default: null },
    // A set that is not sealed (session still running) must be labelled as such.
    sealed: { type: Boolean, default: false },
    accountId: { type: String, default: null, index: true },
    // Tenancy (roadmap §61.3): evidence sets are user-scoped.
    ownerId: { type: String, default: null, index: true },
    strategyVersionId: { type: String, default: null, index: true },
    instruments: { type: [String], default: [] },
    timeframes: { type: [String], default: [] },
    // Versioned evidence snapshot (engine/params/data identity, D1).
    manifest: { type: mongoose.Schema.Types.Mixed, default: null },
    counts: { type: mongoose.Schema.Types.Mixed, default: null },
    keys: { type: mongoose.Schema.Types.Mixed, default: null },
    trades: { type: mongoose.Schema.Types.Mixed, default: [] },
    metrics: { type: mongoose.Schema.Types.Mixed, default: null },
    dataQuality: { type: mongoose.Schema.Types.Mixed, default: null },
    // Every reason a reader could NOT conclude something from this set.
    limitations: { type: [String], default: [] },
    pointInTime: { type: mongoose.Schema.Types.Mixed, default: null },
    hash: { type: String, required: true, index: true },
    frozen: { type: Boolean, default: true },
    immutable: { type: Boolean, default: true },
    // Append-only back-references (experiments that cited this set).
    usedByExperimentIds: { type: [String], default: [] },
    createdBy: { type: String, default: null },
    schemaVersion: { type: String, default: EVIDENCE_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'research_evidence_sets' },
)

EvidenceSetSchema.index({ kind: 1, createdAt: -1 })
EvidenceSetSchema.index({ strategyVersionId: 1, createdAt: -1 })

export const EvidenceSet =
  mongoose.models.research_evidence_sets || mongoose.model('research_evidence_sets', EvidenceSetSchema)
