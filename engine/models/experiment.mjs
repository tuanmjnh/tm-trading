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
    strategyVersionId: { type: String, default: null },
    hypothesis: { type: String, default: '' },
    changes: { type: mongoose.Schema.Types.Mixed, default: [] },
    evidence: { type: mongoose.Schema.Types.Mixed, default: [] },
    risks: { type: [String], default: [] },
    recommendedTest: { type: mongoose.Schema.Types.Mixed, default: {} },

    arms: { type: mongoose.Schema.Types.Mixed, default: {} },
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