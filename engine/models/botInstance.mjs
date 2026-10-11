// engine/models/botInstance.mjs
// Bot instances (roadmap §57.4 H / §58.6): one concrete running or completed
// session tied to one bot profile + immutable strategy version. Lifecycle
// transitions must be server validated and persisted (§57.4 H) — the model only
// defines the persisted shape; the supervisor owns transitions.
import mongoose from 'mongoose'

/** Lifecycle states (§57.4 H). Order is informational, not a chain. */
export const BOT_INSTANCE_STATES = Object.freeze([
  'queued', 'starting', 'running', 'paused', 'stopping', 'completed', 'failed', 'halted',
])

/** Terminal states — a manager must not resume these. */
export const BOT_INSTANCE_TERMINAL_STATES = Object.freeze(['completed', 'failed', 'halted'])

const BotInstanceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // instanceId
    instanceId: { type: String, required: true, index: true },
    botProfileId: { type: String, default: null, index: true },
    // Exact immutable strategy version + fingerprint for traceability (§57.4 H).
    strategyVersionId: { type: String, default: null },
    strategyFingerprint: { type: String, default: null },
    mode: { type: String, default: 'BACKTEST' },
    // Concrete input: a dataset id, a recording session id or a live source.
    source: { type: mongoose.Schema.Types.Mixed, default: {} },
    instruments: { type: [String], default: [] },
    timeframes: { type: [String], default: [] },
    state: { type: String, enum: BOT_INSTANCE_STATES, default: 'queued', index: true },
    startedAt: { type: Number, default: null },
    stoppedAt: { type: Number, default: null },
    lastEventAt: { type: Number, default: null },
    eventLagMs: { type: Number, default: null },
    counts: {
      signals: { type: Number, default: 0 },
      orders: { type: Number, default: 0 },
      trades: { type: Number, default: 0 },
    },
    paperEquity: { type: Number, default: null },
    paperPnl: { type: Number, default: null },
    riskState: { type: mongoose.Schema.Types.Mixed, default: {} },
    health: { type: String, default: 'unknown' },
    lastError: { type: String, default: null },
    createdBy: { type: String, default: null },
    createdAt: { type: Number, default: null },
    schemaVersion: { type: String, default: 'botInstance.v1' },
  },
  { timestamps: true, collection: 'bot_instances' },
)

BotInstanceSchema.index({ state: 1, botProfileId: 1 })

export const BotInstance =
  mongoose.models.bot_instances || mongoose.model('bot_instances', BotInstanceSchema)
