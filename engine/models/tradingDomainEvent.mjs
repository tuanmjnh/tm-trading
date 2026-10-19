// engine/models/tradingDomainEvent.mjs
// COLLECTION `trading_domain_events` — the durable trading outbox (roadmap
// §61.17 Phase C "Add durable outbox or adapt the existing queue; add consumer
// retry/dead-letter reporting as needed").
//
// Every trading fact (account/order/fill/position/signal) is appended here by its
// writer via services/workspaceStore.mjs. `_id` is DETERMINISTIC
// (engine/tradingDomainEvents.mjs) so re-emitting the same fact upserts the same
// row instead of duplicating it — that is what makes the outbox idempotent and
// "restart does not lose the update" true rather than aspirational.
//
// `status`/`attempts`/`lastError` carry the delivery state, so the workspace can
// report how many events are still pending and which failed (retry/dead-letter
// reporting). `invalidates` is copied from the pure contract so a reader does not
// have to re-derive which views to refresh.
//
// Tenancy (§61.3): `ownerId` is required and indexed — the reconciliation read
// is per user, so one owner's events can never be served to another.
//
// Retention: delivered events expire after 30 days; `deliveredAt` stays null on
// an undelivered event, and a null TTL field never expires, so nothing pending is
// ever silently dropped.
import mongoose from 'mongoose'

export const TRADING_DOMAIN_EVENT_RETENTION_SECONDS = 30 * 24 * 3600

export const TRADING_EVENT_STATUSES = Object.freeze(['pending', 'delivered', 'failed'])

const TradingDomainEventSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // tde_<sha1(type|entityId|occurredAt|key)>
    eventId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    schemaVersion: { type: String, required: true },
    entityRef: {
      kind: { type: String, required: true },
      id: { type: String, required: true, index: true },
    },
    // Tenancy (§61.3): the owning user. Required — a trading event without an
    // owner is a bug (engine/tradingDomainEvents.mjs enforces this too).
    ownerId: { type: String, required: true, index: true },
    accountId: { type: String, default: null, index: true },
    occurredAt: { type: Date, required: true, index: true }, // event time (UTC)
    emittedAt: { type: Date, required: true }, // emission time (UTC)
    idempotencyKey: { type: String, required: true },
    correlationId: { type: String, default: null },
    invalidates: { type: [String], default: [] }, // workspace view ids to refresh
    status: { type: String, enum: TRADING_EVENT_STATUSES, default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    deliveredAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: false, collection: 'trading_domain_events' },
)

TradingDomainEventSchema.index({ ownerId: 1, emittedAt: -1 })
TradingDomainEventSchema.index({ ownerId: 1, status: 1, emittedAt: 1 })
TradingDomainEventSchema.index({ type: 1, occurredAt: -1 })
// Expire only AFTER delivery; a pending event (deliveredAt null) never expires.
TradingDomainEventSchema.index({ deliveredAt: 1 }, { expireAfterSeconds: TRADING_DOMAIN_EVENT_RETENTION_SECONDS })

export const TradingDomainEvent =
  mongoose.models.trading_domain_events || mongoose.model('trading_domain_events', TradingDomainEventSchema)
