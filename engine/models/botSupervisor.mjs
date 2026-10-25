// engine/models/botSupervisor.mjs
// One logical supervisor lease per owner (roadmap §61.7 / §61.17 Phase E).
//
// WHY A COLLECTION: the lease is what makes "one runtime per authenticated
// user" enforceable across processes/hosts. A worker may only touch instances
// while it holds an unexpired lease for that owner. A crashed worker's lease
// simply expires; the next boot claims it and runs recoverOnBoot().
import mongoose from 'mongoose'

const BotSupervisorSchema = new mongoose.Schema(
  {
    // Deterministic per-owner key: `sup_<hash(ownerId)>` (engine/botSupervisor.mjs).
    _id: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    // Current holder. Two processes of the same owner use different nonces.
    supervisorId: { type: String, required: true },
    claimedAt: { type: Number, default: null },
    beatAt: { type: Number, default: null },
    expiresAt: { type: Number, default: null, index: true },
    engineVersion: { type: String, default: null },
    schemaVersion: { type: String, default: 'botSupervisor.v1' },
  },
  { timestamps: true, collection: 'bot_supervisors' },
)

export const BotSupervisor =
  mongoose.models.bot_supervisors || mongoose.model('bot_supervisors', BotSupervisorSchema)
