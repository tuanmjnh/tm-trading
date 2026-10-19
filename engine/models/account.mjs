// engine/models/account.mjs
// PaperAccount — the durable §20 account SPEC: accountId, currency, mode, and
// the initialBalance seed fixed at first activity (RISK_EQUITY at that moment).
// Every other §20 number is a READ-derived projection (simulation/account.mjs)
// of the persisted positions — there is NO second money ledger to drift (D12).
import mongoose from 'mongoose'

const PaperAccountSchema = new mongoose.Schema(
  {
    // Tenancy (docs/web-app/user-tenancy-plan.md): hub user id (`sub`) that owns
    // the account row. The global `accountId` unique index is a compound
    // `{ ownerId, accountId }` index (roadmap §61.3).
    ownerId: { type: String, default: null, index: true },

    accountId: { type: String, required: true },
    currency: { type: String, default: 'USDT' },
    mode: { type: String, enum: ['LIVE_PAPER', 'REPLAY'], default: 'LIVE_PAPER' },
    // Frozen when the row is first touched — a later config change cannot rewrite history.
    initialBalance: { type: Number, required: true },
    // Soft removal (roadmap §61.17 Phase B "account CRUD/switching"): an
    // archived account keeps its history but is skipped by the paper runtime
    // (exec/paper.mjs listPaperDesks) and the switcher. Never a hard delete of a
    // book that has positions — archive is the safe, reversible path.
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: 'paper_accounts' },
)

// Per-owner account identity: two tenants may both own an account named
// `paper-main` without colliding.
PaperAccountSchema.index({ ownerId: 1, accountId: 1 }, { unique: true })

export const PaperAccount = mongoose.models.paper_accounts || mongoose.model('paper_accounts', PaperAccountSchema)