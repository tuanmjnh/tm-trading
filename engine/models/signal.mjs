// engine/models/signal.mjs
// Su kien VSA da duoc DICH tu alert thanh tin hieu co nghia (SV/BC/ST/NS/ND).
// Tach khoi `alerts` vi mot alert co the khong phai su kien, va nguoc lai mot
// alert co the sinh nhieu su kien sau nay (Phase 10: nhieu method).
//
// ATTRIBUTION (roadmap §61.17 Phase D): a signal must say WHICH method/indicator/
// strategy/engine version produced it. Legacy rows (written by the TradingView
// webhook) carry no attribution and no `signalKey`; native rows
// (engine/signalEngine.mjs) carry the full `attribution` subdocument and a
// deterministic `signalKey`. The unique index below is PARTIAL so it only applies
// to rows that actually have a `signalKey` — legacy rows (null) are never
// blocked against each other.
import mongoose from 'mongoose'

export const SIGNAL_TYPES = ['SV', 'BC', 'ST LONG', 'ST SHORT', 'NS', 'ND', 'EoM']

const SignalSchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true },
    symbol: { type: String, required: true },
    tf: { type: String, required: true },
    type: { type: String, enum: SIGNAL_TYPES, required: true },
    price: { type: Number, default: null },

    // Tenancy (roadmap §61.3): user-scoped per product decision; shared market
    // reference data is what stays global, generated signals are not.
    ownerId: { type: String, default: null, index: true },
    // Sub-book inside one owner (registry §61.3) — never the tenancy axis.
    accountId: { type: String, default: null, index: true },

    method: { type: String, default: 'vsa' },
    alertKey: { type: String, default: null },

    // Durable identity of a native signal + the contract version that produced it
    // (engine/signalContract.mjs). Null on legacy webhook rows.
    signalKey: { type: String, default: null },
    schemaVersion: { type: String, default: null },

    // Full attribution object produced by engine/signalContract.mjs
    // ({ method, methodVersion, strategyVersion, engineVersion, paramsHash,
    //    indicatorRefs }). Mixed so the contract is stored verbatim and stays
    // queryable (e.g. 'attribution.strategyVersion').
    attribution: { type: mongoose.Schema.Types.Mixed, default: null },

    // Du lieu kem theo cua tung method (bucket, ratio, level Entry/SL/TP...)
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'signals' },
)

SignalSchema.index({ symbol: 1, ts: -1 })
SignalSchema.index({ type: 1, ts: -1 })
SignalSchema.index({ method: 1, symbol: 1, ts: -1 })
// Per-owner idempotency (Phase D): re-emitting the same fixture/bar event upserts
// the same row instead of appending a duplicate. Partial so legacy rows without a
// `signalKey` are excluded (they would otherwise all collide on null).
SignalSchema.index(
  { ownerId: 1, signalKey: 1 },
  { unique: true, partialFilterExpression: { signalKey: { $type: 'string' } } },
)
// Version is queryable without scanning: "which strategy version produced this?".
SignalSchema.index({ 'attribution.strategyVersion': 1 })

export const Signal = mongoose.models.signals || mongoose.model('signals', SignalSchema)
