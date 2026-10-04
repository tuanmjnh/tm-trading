// engine/models/alert.mjs
// Alert THO nhan tu TradingView + noi luu DEDUPE BEN VUNG (roadmap D4).
//
// VI SAO collection nay quan trong: `server/webhook.mjs` hien khu trung bang
// `const seen = new Map()` TRONG RAM -> restart/deploy la mat sach trang thai,
// TradingView retry se tao lenh thu hai THAT. Unique index tren `alertKey`
// bien viec khu trung thanh thuoc tinh cua DU LIEU, khong phu thuoc tien trinh.
import mongoose from 'mongoose'

const AlertSchema = new mongoose.Schema(
  {
    // Khoa khu trung - sinh boi engine/keys.mjs (xem D3/D4)
    alertKey: { type: String, required: true, unique: true },

    source: { type: String, default: 'tradingview' },
    v: { type: Number, default: 1 },

    ts: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },

    symbol: { type: String, default: null },
    tf: { type: String, default: null },
    mode: { type: String, default: null },
    action: { type: String, default: null },
    level: { type: Number, default: null },
    side: { type: String, default: null },
    price: { type: Number, default: null },
    sl: { type: Number, default: null },
    tps: { type: [Number], default: undefined },
    atr: { type: Number, default: null },
    conf: { type: Number, default: null },

    // Ket qua xu ly - de biet alert nao da di tiep, alert nao bi chan.
    // Paper executor (Phase 6) them 'opened'/'closed': ENTRY da mo vi the /
    // follow-up TP/SL/TIME da dung de dong vi the.
    status: { type: String, enum: ['received', 'rejected', 'forwarded', 'opened', 'closed'], default: 'received' },
    rejectReason: { type: String, default: '' },
    forwarded: {
      telegram: { type: Boolean, default: false },
      discord: { type: Boolean, default: false },
    },
    raw: { type: String, default: '' },
  },
  { timestamps: true, collection: 'alerts' },
)

AlertSchema.index({ symbol: 1, ts: -1 })
AlertSchema.index({ action: 1, ts: -1 })

export const Alert = mongoose.models.alerts || mongoose.model('alerts', AlertSchema)
