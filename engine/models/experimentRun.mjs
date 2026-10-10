// engine/models/experimentRun.mjs
// Experiment run ledger (roadmap §28 — `experiment_runs`). One row per arm
// execution: baseline / candidate / random / holdout. `_id =
// `${experimentId}:${role}` (D3) with $setOnInsert (D4) — the FIRST measured
// summary for an arm is the recorded fact; a crash-resumed run never silently
// upgrades an earlier number.
import mongoose from 'mongoose'

import { ARM_NAMES } from '../experiment.mjs'

const ExperimentRunSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `${experimentId}:${role}`
    experimentId: { type: String, required: true, index: true },
    role: { type: String, enum: ARM_NAMES, required: true },

    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
    counters: { type: mongoose.Schema.Types.Mixed, default: null },
    runHash: { type: String, default: null },
    engineVersion: { type: String, default: null },
    paramsHash: { type: String, default: null },
    symbols: { type: [String], default: [] },
    timeframes: { type: [String], default: [] },
    // Backtest runId(s) that produced this arm — the join back to `runs`.
    runIds: { type: [String], default: [] },

    recordedAt: { type: Number, default: null },
    schemaVersion: { type: String, default: 'experimentRun.v1' },
  },
  { timestamps: true, collection: 'experiment_runs' },
)

ExperimentRunSchema.index({ experimentId: 1, role: 1 })

export const ExperimentRun =
  mongoose.models.experiment_runs || mongoose.model('experiment_runs', ExperimentRunSchema)