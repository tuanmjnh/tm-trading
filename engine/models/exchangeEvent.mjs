import mongoose from 'mongoose'

// =============================================================================
//  ExchangeEvent (roadmap §63.12/§64.6) — the durable evidence ledger for crypto
//  exchange DEMO activity. One row per normalized external fact: order/fill/
//  position/account transitions, fee records, funding observations vs settlement
//  cashflows, reconciliation outcomes, market-source switches and session/switch
//  audits. Raw payloads are stored only AFTER secret/header redaction.
//
//  Identity (§64.6): every row carries owner/connection/venue/environment/account
//  /session and the venue's own ids + event time, kept separate from local ingest
//  time (D17). The `_id` is a venue+account-scoped idempotency key, so an
//  identical order/exec id from two different exchanges can NEVER collide, and a
//  retry/reconnect re-delivering the same event UPSERTS instead of duplicating.
// =============================================================================

export const EXCHANGE_EVENT_KINDS = Object.freeze([
  'order', 'execution', 'position', 'account', 'fee',
  'funding_observation', 'funding_cashflow', 'reconciliation',
  'market_source_switched', 'session', 'venue_switch', 'risk_decision',
])

export const ACCOUNTING_STATES = Object.freeze([
  'VERIFIED_VENUE', 'RECONCILED', 'PARTIAL', 'ESTIMATED', 'MISSING', 'STALE', 'UNRECONCILED',
])

const ExchangeEventSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // idempotency key (venue+account scoped)
  ownerId: { type: String, required: true, index: true },
  exchangeConnectionId: { type: String, default: null },
  venue: { type: String, required: true, index: true }, // bybit|binance|okx
  environment: { type: String, enum: ['DEMO'], default: 'DEMO' },
  accountId: { type: String, default: 'default', index: true },
  sessionId: { type: String, default: null, index: true },
  botInstanceId: { type: String, default: null },
  agentId: { type: String, default: null },

  kind: { type: String, enum: [...EXCHANGE_EVENT_KINDS], required: true, index: true },

  // Venue-native identifiers (never merged across venues).
  externalOrderId: { type: String, default: null },
  clientOrderId: { type: String, default: null },
  execId: { type: String, default: null },

  canonicalInstrumentId: { type: String, default: null },
  venueInstrumentId: { type: String, default: null },
  productCategory: { type: String, default: null },
  contractSpecVersion: { type: String, default: null },

  // Accounting label for fee/funding/pnl-bearing events (§63.11).
  accountingState: { type: String, enum: [...ACCOUNTING_STATES], default: null },

  // Sanitized normalized payload + optional raw reference/hash (secrets stripped).
  data: { type: mongoose.Schema.Types.Mixed, default: null },
  rawHash: { type: String, default: null },

  eventTime: { type: Number, default: null }, // venue event/transaction time
  ingestTime: { type: Number, default: null }, // local ingest time (D17)
  correlationId: { type: String, default: null },

  strategyVersionId: { type: String, default: null },
  schemaVersion: { type: String, default: 'exchangeEvent.v1' },
}, { timestamps: true, collection: 'exchange_events' })

ExchangeEventSchema.index({ ownerId: 1, venue: 1, accountId: 1, kind: 1, eventTime: -1 })
ExchangeEventSchema.index({ ownerId: 1, sessionId: 1, kind: 1 })
ExchangeEventSchema.index({ venue: 1, accountId: 1, execId: 1 })

export const ExchangeEvent = mongoose.models.exchange_events
  || mongoose.model('exchange_events', ExchangeEventSchema)
