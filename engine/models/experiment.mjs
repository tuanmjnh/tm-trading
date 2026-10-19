// engine/models/experiment.mjs
// Experiment ledger (roadmap §28.1 — `experiments`). One row per proposed
// strategy change; `status` walks the lifecycle and `history` records every
// move (who/when/from/to). `_id = experimentId` (D3) and the doc is written
// $setOnInsert (D4) — a re-created proposal never rewrites the live state.
import mongoose from 'mongoose'

import { EXPERIMENT_STATES, EXPERIMENT_SCHEMA_VERSION } from '../experiment.mjs'

const ExperimentSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `exp:...`
    experimentId: { type: String, required: true, index: true },
    proposalId: { type: String, required: true, index: true },
    // Tenancy (roadmap §61.3): experiments are user-scoped.
    ownerId: { type: String, default: null, index: true },
    strategyVersionId: { type: String, default: null },
    // §59.15 Slice E: the frozen evidence set this experiment was derived from —
    // the answer to "which facts produced this hypothesis" (D31: evidence, not
    // vibes, and never a silent promotion).
    evidenceSetId: { type: String, default: null, index: true },
    // §59.15 Slice E: the version this candidate must beat, frozen at proposal
    // time. Never re-derived from the live pointer — that pointer is what a
    // promotion changes (D31).
    baselineVersionId: { type: String, default: null },
    // §59.15 Slice E: the paper-validation sessions launched for this candidate.
    // Validation runs the CANDIDATE while the baseline stays live, so the two
    // are never conflated.
    hypothesis: { type: String, default: '' },
    changes: { type: mongoose.Schema.Types.Mixed, default: [] },
    evidence: { type: mongoose.Schema.Types.Mixed, default: [] },
    risks: { type: [String], default: [] },
    recommendedTest: { type: mongoose.Schema.Types.Mixed, default: {} },

    arms: { type: mongoose.Schema.Types.Mixed, default: {} },
    // §59.15 Slice E: paper-validation sessions launched for this candidate
    // (the baseline stays untouched — D31).
    paperSessionIds: { type: [String], default: [] },
    status: { type: String, enum: EXPERIMENT_STATES, default: 'proposed', index: true },
    history: { type: mongoose.Schema.Types.Mixed, default: [] },

    createdAt: { type: Number, default: null },
    schemaVersion: { type: String, default: EXPERIMENT_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'experiments' },
)

ExperimentSchema.index({ status: 1, updatedAt: -1 })

export const Experiment =
  mongoose.models.experiments || mongoose.model('experiments', ExperimentSchema)