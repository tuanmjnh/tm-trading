// engine/models/newsDomainEvent.mjs
// Durable news/macro domain events (V3.5 §60.12): the audit trail that makes a
// correction reach the views derived from it.
//
// The §60.12 envelope is mandatory and stored in full: durable event id, schema
// version, entity reference, UTC occurred-at AND emitted-at, idempotency key,
// correlation id and audit data. `_id` is DETERMINISTIC (engine/newsDomainEvents.mjs)
// so a re-clustered window emits the same events instead of appending duplicates.
//
// Retention: 30 days. Longer than the 7-day NewsItem TTL on purpose — an event is
// the record that a correction HAPPENED, and it must outlive the article it
// refers to so an operator can still explain why a view was invalidated.
import mongoose from 'mongoose'

export const NEWS_DOMAIN_EVENT_RETENTION_SECONDS = 30 * 24 * 3600

const NewsDomainEventSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // nde_<sha1(type|entityId|occurredAt|key)>
    eventId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    schemaVersion: { type: String, required: true },
    entityRef: {
      kind: { type: String, required: true },
      id: { type: String, required: true, index: true },
    },
    occurredAt: { type: Date, required: true, index: true }, // event time (UTC)
    emittedAt: { type: Date, required: true }, // emission time (UTC)
    idempotencyKey: { type: String, required: true },
    correlationId: { type: String, default: null }, // ingest run / job correlation
    data: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: false, collection: 'news_domain_events' },
)

NewsDomainEventSchema.index({ type: 1, occurredAt: -1 })
NewsDomainEventSchema.index({ emittedAt: 1 }, { expireAfterSeconds: NEWS_DOMAIN_EVENT_RETENTION_SECONDS })

export const NewsDomainEvent =
  mongoose.models.news_domain_events || mongoose.model('news_domain_events', NewsDomainEventSchema)
