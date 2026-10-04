// engine/models/trade.mjs
// Mot lenh cua mot run. Tach collection (khong nhung vao run) vi mot run co the
// co hang nghin lenh - nhung se cham tran 16MB cua MongoDB va kho truy van.
import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

const TradeSchema = new mongoose.Schema(
  {
    runId: { type: ObjectId, ref: 'runs', required: true, index: true },

    // Mang theo danh tinh de loc duoc ca khi khong join sang runs
    paramsHash: { type: String, required: true },
    engineVersion: { type: String, required: true },
    method: { type: String, default: 'vsa' },

    symbol: { type: String, required: true },
    tf: { type: String, required: true },

    dir: { type: Number, enum: [1, -1], required: true }, // 1 = long, -1 = short
    entryTime: { type: Date, required: true },
    entryPrice: { type: Number, required: true },
    exitTime: { type: Date, default: null },
    exitPrice: { type: Number, default: null },

    sl: { type: Number, default: null },
    tp: { type: Number, default: null },

    // 'OPEN' = lenh chua dong khi het du lieu (phai dem rieng, khong tinh vao WR)
    result: { type: String, enum: ['TP', 'SL', 'TIME', 'OPEN'], default: 'OPEN' },
    barsHeld: { type: Number, default: 0 },
    pnlPct: { type: Number, default: 0 },
    rMultiple: { type: Number, default: 0 },

    // Co phan giai duoc thu tu TP/SL bang sub-bar 1m hay phai doan bao thu (D6)
    resolvedBy1m: { type: Boolean, default: null },
  },
  { timestamps: true, collection: 'trades' },
)

TradeSchema.index({ runId: 1, entryTime: 1 })
TradeSchema.index({ symbol: 1, tf: 1, entryTime: -1 })
TradeSchema.index({ paramsHash: 1, result: 1 })

export const Trade = mongoose.models.trades || mongoose.model('trades', TradeSchema)
