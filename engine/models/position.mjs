// engine/models/position.mjs
// Vi the THAT (paper / MT5 / san / tay). La nguon chan ly ve "dang giu gi" -
// moi thu khac (dashboard, risk gate, journal) doc tu day.
import mongoose from 'mongoose'

const PositionSchema = new mongoose.Schema(
  {
    account: { type: String, required: true },
    source: { type: String, enum: ['paper', 'mt5', 'exchange', 'manual'], default: 'paper' },

    // Id phia san/MT5 (ticket). Dung de doi chieu khi bo phan sync lech trang thai.
    externalId: { type: String, default: null },

    symbol: { type: String, required: true },
    dir: { type: Number, enum: [1, -1], required: true },
    qty: { type: Number, required: true },

    entryPrice: { type: Number, required: true },
    entryTime: { type: Date, required: true },

    sl: { type: Number, default: null },
    tps: { type: [Number], default: undefined },

    exitPrice: { type: Number, default: null },
    exitTime: { type: Date, default: null },

    status: { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open' },
    pnlPct: { type: Number, default: null },
    pnlAbs: { type: Number, default: null },

    // Truy vet: vi the nay sinh ra tu tin hieu nao, bo tham so nao
    method: { type: String, default: null },
    paramsHash: { type: String, default: null },
    signalKey: { type: String, default: null },
  },
  { timestamps: true, collection: 'positions' },
)

PositionSchema.index({ account: 1, status: 1 })
PositionSchema.index({ symbol: 1, entryTime: -1 })
// externalId phai duy nhat TRONG mot account+nguon, nhung cho phep null (lenh tay)
PositionSchema.index({ account: 1, source: 1, externalId: 1 }, { unique: true, sparse: true })

export const Position = mongoose.models.positions || mongoose.model('positions', PositionSchema)
