// engine/models/equity.mjs
// Anh chup duong von theo thoi gian -> dashboard ve equity curve, tinh drawdown
// thuc te (khac maxDD cua backtest).
import mongoose from 'mongoose'

const EquitySchema = new mongoose.Schema(
  {
    account: { type: String, required: true },
    ts: { type: Date, required: true },

    equity: { type: Number, required: true },
    balance: { type: Number, default: null },
    openPositions: { type: Number, default: 0 },
    openPnlAbs: { type: Number, default: 0 },

    source: { type: String, enum: ['paper', 'mt5', 'exchange'], default: 'paper' },
  },
  { timestamps: true, collection: 'equity' },
)

EquitySchema.index({ account: 1, ts: -1 })

export const Equity = mongoose.models.equity || mongoose.model('equity', EquitySchema)
