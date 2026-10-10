// engine/models/account.mjs
// PaperAccount — the durable §20 account SPEC: accountId, currency, mode, and
// the initialBalance seed fixed at first activity (RISK_EQUITY at that moment).
// Every other §20 number is a READ-derived projection (simulation/account.mjs)
// of the persisted positions — there is NO second money ledger to drift (D12).
import mongoose from 'mongoose'

const PaperAccountSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, unique: true },
    currency: { type: String, default: 'USDT' },
    mode: { type: String, enum: ['LIVE_PAPER', 'REPLAY'], default: 'LIVE_PAPER' },
    // Frozen when the row is first touched — a later config change cannot rewrite history.
    initialBalance: { type: Number, required: true },
  },
  { timestamps: true, collection: 'paper_accounts' },
)

export const PaperAccount = mongoose.models.paper_accounts || mongoose.model('paper_accounts', PaperAccountSchema)