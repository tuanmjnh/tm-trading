// engine/models/fill.mjs
// Paper FILL — the factual execution ledger (roadmap v3 §18.5/§18.6/§26.5).
// One row per executed fill (entry open + each A2 remainder execution), keyed
// by a unique `fillId`. Rows are append-only historical facts (D12) recorded
// by the executor when a state transition ACTUALLY happened — never derived,
// never $inc'd retroactively. The AI research layer (§26.6/§27.1) reads these
// for execution-quality metrics (latency, spread, slippage, fee rates).
import mongoose from 'mongoose'

const PaperFillSchema = new mongoose.Schema(
  {
    // Ledger anchors: unique fill, order it belongs to (D3), alert back-ref.
    fillId: { type: String, required: true, unique: true },
    orderId: { type: String, required: true },
    alertKey: { type: String, default: null },

    accountId: { type: String, default: 'default' },
    source: { type: String, default: 'paper' },
    symbol: { type: String, required: true },
    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    type: { type: String, enum: ['market', 'limit', 'stop'], default: 'market' },
    qty: { type: Number, default: null }, // order intent qty (audit context)

    // Measured execution (never the signal price).
    fillPrice: { type: Number, default: null },
    fillQty: { type: Number, required: true },
    feeRateBps: { type: Number, default: null }, // rate used, role-based (§18.5)
    feeAmount: { type: Number, default: null },
    spreadAbs: { type: Number, default: null },
    slippageBps: { type: Number, default: null },
    latencyMs: { type: Number, default: 0 }, // quote age + simulated latency
    simLatencyMs: { type: Number, default: 0 },

    // §18.6 latency chain (epoch ms; null when the source did not supply it).
    signalTime: { type: Number, default: null },
    decisionTime: { type: Number, default: null },
    eventTime: { type: Number, default: null },

    simulateOnly: { type: Boolean, default: false }, // replay vs live paper
    modelVersion: { type: String, default: null }, // D1 simulation stamp
    // §34: execution fidelity level (F0..F4) — the precision tier of the fill
    // model that produced this fill. null = not recorded (legacy).
    fidelity: { type: String, default: null },
  },
  { timestamps: true, collection: 'paper_fills' },
)

PaperFillSchema.index({ orderId: 1, eventTime: -1 })
PaperFillSchema.index({ symbol: 1, eventTime: -1 })
PaperFillSchema.index({ eventTime: -1 })

export const PaperFill = mongoose.models.paper_fills || mongoose.model('paper_fills', PaperFillSchema)