// engine/models/strategyProfile.mjs
// Strategy profiles (roadmap §26.1): the POINTER that says which strategy
// version runs live for which instruments/timeframes. A profile points at a
// version (which is immutable) — changing the pointer is cheap and auditable,
// changing the version is what §29 forbids.
import mongoose from 'mongoose'

export const PROFILE_STATUSES = Object.freeze(['draft', 'active', 'paused', 'retired'])

const StrategyProfileSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // profileId
    profileId: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    status: { type: String, enum: PROFILE_STATUSES, default: 'draft', index: true },
    strategyVersionId: { type: String, default: null, index: true },
    instruments: { type: [String], default: [] },
    timeframes: { type: [String], default: [] },
    riskProfileId: { type: String, default: null },
    history: { type: mongoose.Schema.Types.Mixed, default: [] },
    createdAt: { type: Number, default: null },
    schemaVersion: { type: String, default: 'strategyProfile.v1' },
  },
  { timestamps: true, collection: 'strategy_profiles' },
)

StrategyProfileSchema.index({ status: 1, profileId: 1 })

export const StrategyProfile =
  mongoose.models.strategy_profiles || mongoose.model('strategy_profiles', StrategyProfileSchema)