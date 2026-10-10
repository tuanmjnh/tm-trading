// engine/models/order.mjs
// Paper ORDER (roadmap v3 §17.2 / §26.4) — first-class execution-intent doc
// for the LIVE paper path. It records every state of the §17.2 machine
// (created/riskChecked/pending/partiallyFilled/filled/cancelled/expired/
// rejected) and rides a `clientOrderId` unique index (D3/D4): the same alert
// retries its cycle and UPSERTS on that key, so a crash never duplicates an
// order and the ORDER id stays the idempotency anchor for fills.
import mongoose from 'mongoose'
import { ORDER_STATES } from '../../simulation/order.mjs'

const PaperOrderSchema = new mongoose.Schema(
  {
    // Idempotency anchors (D3/D4) — unique per account/source.
    orderId: { type: String, required: true, unique: true },
    clientOrderId: { type: String, required: true, unique: true },
    alertKey: { type: String, default: null }, // dedupe back-reference (alerts)

    accountId: { type: String, default: 'default' },
    source: { type: String, default: 'paper' },
    symbol: { type: String, required: true },
    tf: { type: String, default: null },
    side: { type: String, enum: ['BUY', 'SELL'], required: true },
    type: { type: String, enum: ['market', 'limit', 'stop'], default: 'market' },
    qty: { type: Number, required: true },
    // limit/stop reference level (market orders keep the signal price for audit).
    price: { type: Number, default: null },
    sl: { type: Number, default: null },
    tps: { type: [Number], default: undefined },

    status: { type: String, enum: ORDER_STATES, default: 'created' },
    rejectReason: { type: String, default: null },
    cancelReason: { type: String, default: null },
    cancelBy: { type: String, default: null },

    riskCheckedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    filledAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },

    // Fill measurements (measured, never fabricated — D12).
    fillPrice: { type: Number, default: null },
    filledQty: { type: Number, default: 0 },
    fee: { type: Number, default: null },
    slippageBps: { type: Number, default: null },

    simulationVersion: { type: String, default: null }, // order.mjs model version
    engineVersion: { type: String, default: null }, // D1 stamp
  },
  { timestamps: true, collection: 'paper_orders' },
)

PaperOrderSchema.index({ status: 1, createdAt: -1 })
PaperOrderSchema.index({ symbol: 1, createdAt: -1 })

export const PaperOrder = mongoose.models.paper_orders || mongoose.model('paper_orders', PaperOrderSchema)