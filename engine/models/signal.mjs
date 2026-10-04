// engine/models/signal.mjs
// Su kien VSA da duoc DICH tu alert thanh tin hieu co nghia (SV/BC/ST/NS/ND).
// Tach khoi `alerts` vi mot alert co the khong phai su kien, va nguoc lai mot
// alert co the sinh nhieu su kien sau nay (Phase 10: nhieu method).
import mongoose from 'mongoose'

export const SIGNAL_TYPES = ['SV', 'BC', 'ST LONG', 'ST SHORT', 'NS', 'ND', 'EoM']

const SignalSchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true },
    symbol: { type: String, required: true },
    tf: { type: String, required: true },
    type: { type: String, enum: SIGNAL_TYPES, required: true },
    price: { type: Number, default: null },

    method: { type: String, default: 'vsa' },
    alertKey: { type: String, default: null },

    // Du lieu kem theo cua tung method (bucket, ratio, level Entry/SL/TP...)
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'signals' },
)

SignalSchema.index({ symbol: 1, ts: -1 })
SignalSchema.index({ type: 1, ts: -1 })
SignalSchema.index({ method: 1, symbol: 1, ts: -1 })

export const Signal = mongoose.models.signals || mongoose.model('signals', SignalSchema)
