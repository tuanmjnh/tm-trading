// engine/models/riskState.mjs
// Bo dem RUI RO THEO NGAY (roadmap D7b). Phai BEN VUNG: "daily loss cap" la bo dem
// theo ngay, neu restart luc 23:50 ma mat bo dem thi cap vo hieu dung luc can nhat.
import mongoose from 'mongoose'

const RiskStateSchema = new mongoose.Schema(
  {
    // Tenancy (docs/web-app/user-tenancy-plan.md): hub user id (`sub`) that owns
    // the row. Counters are per owner AND per account.
    ownerId: { type: String, default: null, index: true },

    account: { type: String, required: true },

    // 'YYYY-MM-DD' theo UTC (roadmap D2: moi thu luu UTC). Dung string thay vi Date
    // de khoa ngay la RO RANG, khong phu thuoc mui gio cua may chay.
    utcDay: { type: String, required: true },

    realizedPnlAbs: { type: Number, default: 0 },
    realizedPnlPct: { type: Number, default: 0 },
    tradesOpened: { type: Number, default: 0 },
    tradesClosed: { type: Number, default: 0 },
    consecutiveLosses: { type: Number, default: 0 },

    // Kill-switch (D7c): khi bat, MOI lenh moi bi chan cho toi khi mo lai bang tay
    halted: { type: Boolean, default: false },
    haltReason: { type: String, default: '' },
    haltedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'risk_state' },
)

// Mot ban ghi cho moi (owner, account, ngay UTC) - upsert theo khoa nay.
// ownerId trong khoa (roadmap §61.3): bo dem daily-loss la cua tung tenant.
RiskStateSchema.index({ ownerId: 1, account: 1, utcDay: 1 }, { unique: true })

export const RiskState = mongoose.models.risk_state || mongoose.model('risk_state', RiskStateSchema)
