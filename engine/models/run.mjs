// engine/models/run.mjs
// Mot lan chay backtest. Mang DAY DU danh tinh D1 -> khong bao gio tron the he engine.
// Quy uoc export y het nuxt4-cms: `mongoose.models.x || mongoose.model('x', Schema)`
// (chong OverwriteModelError khi import lai / HMR).
import mongoose from 'mongoose'

const RunSchema = new mongoose.Schema(
  {
    // --- danh tinh (D1) ---
    engineVersion: { type: String, required: true },
    // KHONG dat `index: true` o day: index tong hop (paramsHash, engineVersion)
    // ben duoi da phuc vu duoc truy van theo paramsHash (tien to), them index
    // don le chi ton them chi phi ghi ma khong tang ich loi truy van.
    paramsHash: { type: String, required: true },
    dataHash: { type: String, default: null },
    gitRev: { type: String, default: null },
    universeSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    // --- pham vi ---
    method: { type: String, default: 'vsa' },
    symbol: { type: String, required: true },
    tf: { type: String, required: true },
    market: { type: String, enum: ['fapi', 'spot'], default: 'fapi' },
    from: { type: Date, default: null },
    to: { type: Date, default: null },
    bars: { type: Number, default: 0 },

    // Effective canonicalized parameter set, not raw user input
    params: { type: mongoose.Schema.Types.Mixed, required: true },

    // --- ket qua ---
    stats: {
      trades: { type: Number, default: 0 },
      winRate: { type: Number, default: 0 },
      profitFactor: { type: Number, default: 0 },
      netPct: { type: Number, default: 0 },
      maxDrawdownPct: { type: Number, default: 0 },
      avgRr: { type: Number, default: 0 },
      expectancy: { type: Number, default: 0 },
    },
    note: { type: String, default: '' },
  },
  { timestamps: true, collection: 'runs' },
)

// Truy van nong nhat cua dashboard: "run moi nhat theo symbol x TF"
RunSchema.index({ symbol: 1, tf: 1, createdAt: -1 })
// Truy van cua Phase 5: gom nhom theo cau hinh + the he engine
RunSchema.index({ paramsHash: 1, engineVersion: 1 })
RunSchema.index({ createdAt: -1 })

export const Run = mongoose.models.runs || mongoose.model('runs', RunSchema)
