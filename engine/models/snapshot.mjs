// engine/models/snapshot.mjs
// Immutable market snapshots at DECISION points (roadmap §14 + §26.3). One row
// per approved ENTRY decision — the context the gate saw at the moment it
// decided. `_id` = snapshotId (`snap:${alertKey}`, D3) so a crash-replay can
// never duplicate the same decision; writes are $setOnInsert (D4: first
// observation wins, later runs never rewrite a decision that already happened).
//
// Honesty (D12): indicators/methods/regime/strategyVersionId stay null/[] when
// the pipeline does not produce them — the AI dataset must never guess.
import mongoose from 'mongoose'

import { SNAPSHOT_SCHEMA_VERSION } from '../../exec/snapshot.mjs'

const SnapshotSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `snap:${alertKey}`
    snapshotId: { type: String, required: true },
    snapshotHash: { type: String, required: true }, // sha256 of context
    kind: { type: String, required: true }, // 'entry-decision' | ...

    instrumentId: { type: String, default: null }, // `${venue}:${symbol}`
    venue: { type: String, required: true },
    symbol: { type: String, required: true },
    timeframe: { type: String, default: null },

    clockTime: { type: Number, required: true }, // decision time, UTC ms (D2)

    bar: { type: mongoose.Schema.Types.Mixed, default: null }, // closed 1m bar
    quote: { type: mongoose.Schema.Types.Mixed, default: null },
    indicators: { type: mongoose.Schema.Types.Mixed, default: null },
    methods: { type: [String], default: [] },
    regime: { type: mongoose.Schema.Types.Mixed, default: null },

    dataQuality: { type: mongoose.Schema.Types.Mixed, default: null },
    decision: { type: mongoose.Schema.Types.Mixed, required: true },

    alertKey: { type: String, required: true },
    strategyVersionId: { type: String, default: null }, // null today (honest)
    modelVersion: { type: String, default: SNAPSHOT_SCHEMA_VERSION }, // D1
  },
  { timestamps: true, collection: 'market_snapshots' },
)

SnapshotSchema.index({ symbol: 1, clockTime: -1 })
SnapshotSchema.index({ clockTime: -1 })
SnapshotSchema.index({ snapshotHash: 1 })
SnapshotSchema.index({ kind: 1, clockTime: -1 })

export const Snapshot = mongoose.models.market_snapshots || mongoose.model('market_snapshots', SnapshotSchema)