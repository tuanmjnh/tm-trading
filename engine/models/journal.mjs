// engine/models/journal.mjs
// COLLECTION `journal` — one row per EXECUTED trade (roadmap Phase 13 item 1).
//
// This is a DERIVED read model, not a second source of truth: every row points
// back at the upstream fill identity (`source` + `sourceId` = positions.externalId
// or positions._id) and `key` is derived from it in engine/journal.mjs
// (`journalKey`). Re-syncing therefore cannot create a second row for the same
// fill — the unique index is the dedupe (D4), not a Set in RAM.
import mongoose from 'mongoose'

const JournalSchema = new mongoose.Schema(
  {
    // Dedupe key derived from the upstream identity — NOT a new order-id scheme.
    key: { type: String, required: true, unique: true },
    schema: { type: Number, default: 1 },

    source: { type: String, required: true }, // paper | mt5 | exchange | manual | unknown
    account: { type: String, default: 'unknown' },
    sourceId: { type: String, default: null },

    symbol: { type: String, required: true },
    tf: { type: String, default: 'unknown' },
    dir: { type: Number, enum: [1, -1], required: true },

    entryPrice: { type: Number, default: null },
    exitPrice: { type: Number, default: null },
    sl: { type: Number, default: null },
    tps: { type: [Number], default: undefined },
    qty: { type: Number, default: null },

    // TP | SL | TIME | OPEN | unknown — 'unknown' means the reason is not
    // derivable from what the executor persisted (e.g. a gap fill), not "flat".
    result: { type: String, default: 'unknown' },
    rMultiple: { type: Number, default: null },
    pnlAbs: { type: Number, default: null },
    pnlPct: { type: Number, default: null },

    // null = UNKNOWN. Paper PnL is fee-free by design, so 0 would be a claim
    // that fees were measured and were zero.
    fees: { type: Number, default: null },

    method: { type: String, default: 'unknown' },
    regime: { type: String, default: 'unknown' }, // point-in-time intel snapshot
    engineVersion: { type: String, default: 'unknown' },
    paramsHash: { type: String, default: 'unknown' },
    status: { type: String, default: 'unknown' },

    entryTime: { type: Date, required: true }, // UTC (D2)
    exitTime: { type: Date, default: null },
    recordedAt: { type: Date, default: Date.now },
    signalKey: { type: String, default: null },

    // Every tracked field this row could not derive — queryable, so "we do not
    // know" is visible in the data instead of looking like a real value.
    unknown: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'journal' },
)

JournalSchema.index({ entryTime: -1 }) // the journal is read newest-first
JournalSchema.index({ source: 1, entryTime: -1 })
JournalSchema.index({ method: 1, regime: 1, entryTime: -1 })
JournalSchema.index({ symbol: 1, tf: 1, entryTime: -1 })
// Item 3 (preset drift) groups by the version stamp — same shape as runs/trades.
JournalSchema.index({ engineVersion: 1, paramsHash: 1, entryTime: -1 })

export const Journal = mongoose.models.journal || mongoose.model('journal', JournalSchema)
