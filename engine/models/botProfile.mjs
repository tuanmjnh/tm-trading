// engine/models/botProfile.mjs
// Bot profiles (roadmap §57.4 G / §58.6): a REUSABLE execution profile that
// references an immutable strategy version. A profile is not a running bot —
// runs create bot instances (engine/models/botInstance.mjs). Profile != strategy
// version: the version holds the code/parameter contract, the profile holds the
// operational config (mode, instruments, timeframes, risk, session rules).
import mongoose from 'mongoose'

/** Default run mode of a profile (§57.4 G). */
export const BOT_PROFILE_MODES = Object.freeze(['BACKTEST', 'REPLAY', 'LIVE_ANALYSIS', 'LIVE_PAPER'])

export const BOT_PROFILE_STATUSES = Object.freeze(['draft', 'enabled', 'disabled', 'archived'])

const BotProfileSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // profileId
    profileId: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    description: { type: String, default: '' },
    // Tenancy (roadmap §61.3): bots are user-scoped.
    ownerId: { type: String, default: null, index: true },
    // Exact immutable strategy version this profile runs (§29/§57.5). Not copied.
    strategyVersionId: { type: String, default: null, index: true },
    mode: { type: String, enum: BOT_PROFILE_MODES, default: 'BACKTEST', index: true },
    instruments: { type: [String], default: [] },
    timeframes: { type: [String], default: [] },
    riskProfileId: { type: String, default: null },
    simulatedAccountId: { type: String, default: null },
    maxConcurrentPositions: { type: Number, default: 1 },
    // Parameter overrides are permitted only when explicitly allowed; the
    // resulting effective config is fingerprinted (D1: unique config => hash).
    paramOverrides: { type: mongoose.Schema.Types.Mixed, default: null },
    // Per-bot stop management (breakeven / ATR trailing) — consumed by the
    // paper executor via the instance. Mixed so new options stay additive.
    execution: { type: mongoose.Schema.Types.Mixed, default: null },
    effectiveParamsHash: { type: String, default: null },
    sessionRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    notificationPolicy: { type: mongoose.Schema.Types.Mixed, default: {} },
    enabled: { type: Boolean, default: false, index: true },
    status: { type: String, enum: BOT_PROFILE_STATUSES, default: 'draft', index: true },
    history: { type: mongoose.Schema.Types.Mixed, default: [] },
    createdBy: { type: String, default: null },
    createdAt: { type: Number, default: null },
    schemaVersion: { type: String, default: 'botProfile.v1' },
  },
  { timestamps: true, collection: 'bot_profiles' },
)

BotProfileSchema.index({ status: 1, profileId: 1 })

export const BotProfile =
  mongoose.models.bot_profiles || mongoose.model('bot_profiles', BotProfileSchema)
