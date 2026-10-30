// engine/models/session.mjs
// Trading sessions (V3.4 §59 Slice C): the durable cross-cutting record of one
// live-paper or replay run. Orders/fills/positions carry `sessionId`
// (additive, nullable) pointing here; legacy docs without one behave exactly
// as before. Lifecycle transitions are guarded by engine/session.mjs — the
// model only defines the persisted shape.
import mongoose from 'mongoose'
import { SESSION_KINDS, SESSION_STATES } from '../session.mjs'

const TimelineEventSchema = new mongoose.Schema(
  {
    t: { type: Number, required: true },
    kind: { type: String, default: 'note' },
    message: { type: String, default: '' },
  },
  { _id: false },
)

const SessionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // sessionId
    sessionId: { type: String, required: true, index: true },
    kind: { type: String, enum: [...SESSION_KINDS], required: true, index: true },
    // Tenancy (docs/web-app/user-tenancy-plan.md): hub user id (`sub`) that owns
    // the session. One running instance per owner.
    ownerId: { type: String, default: null, index: true },
    strategyVersionId: { type: String, default: null, index: true },
    botProfileId: { type: String, default: null, index: true },
    accountId: { type: String, default: 'default', index: true },
    instruments: { type: [String], default: [] },
    timeframes: { type: [String], default: [] },
    // V3.9 execution binding (§63.5/§64.5B). Additive + nullable: legacy docs
    // without these behave exactly as before (INTERNAL_PAPER, no venue).
    executionMode: { type: String, enum: ['BACKTEST', 'REPLAY', 'INTERNAL_PAPER', 'EXCHANGE_DEMO'], default: 'INTERNAL_PAPER', index: true },
    executionVenue: { type: String, enum: ['bybit', 'binance', 'okx', null], default: null },
    exchangeConnectionId: { type: String, default: null },
    marketDataVenue: { type: String, default: null },
    state: { type: String, enum: [...SESSION_STATES], default: 'queued', index: true },
    startedAt: { type: Number, default: null },
    stoppedAt: { type: Number, default: null },
    lastEventAt: { type: Number, default: null },
    // Versioned evidence snapshot at session start (engine/params/dataset).
    manifest: { type: mongoose.Schema.Types.Mixed, default: null },
    timeline: { type: [TimelineEventSchema], default: [] },
    timelineDropped: { type: Number, default: 0 },
    counts: {
      orders: { type: Number, default: 0 },
      fills: { type: Number, default: 0 },
      positions: { type: Number, default: 0 },
    },
    orderKeys: { type: [String], default: [] },
    positionIds: { type: [String], default: [] },
    journalKeys: { type: [String], default: [] },
    // Restart recovery chain (D3): a recovered session points at its predecessor.
    restartedFrom: { type: String, default: null },
    createdBy: { type: String, default: null },
    schemaVersion: { type: String, default: 'session.v1' },
  },
  { timestamps: true, collection: 'trading_sessions' },
)

SessionSchema.index({ state: 1, lastEventAt: -1 })
SessionSchema.index({ accountId: 1, createdAt: -1 })

export const TradingSession =
  mongoose.models.trading_sessions || mongoose.model('trading_sessions', SessionSchema)
