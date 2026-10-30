import mongoose from 'mongoose'

// =============================================================================
//  ExchangeOrderMapping (roadmap §63.12/§63.5/§64.6) — internal order intent ↔
//  venue order identity for crypto exchange DEMO execution. This is the anchor
//  that makes "one logical order intent produces at most one venue order after
//  retry/reconciliation" enforceable: the clientOrderId is our idempotency key,
//  the externalOrderId is the venue's, and both are scoped by venue+account so
//  identical ids from different exchanges never collide.
// =============================================================================

const ExchangeOrderMappingSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${ownerId}:${venue}:${accountId}:${clientOrderId}`
  ownerId: { type: String, required: true, index: true },
  exchangeConnectionId: { type: String, default: null },
  venue: { type: String, required: true },
  environment: { type: String, enum: ['DEMO'], default: 'DEMO' },
  accountId: { type: String, default: 'default' },
  sessionId: { type: String, default: null, index: true },
  botInstanceId: { type: String, default: null },
  agentId: { type: String, default: null },

  clientOrderId: { type: String, required: true },
  externalOrderId: { type: String, default: null }, // filled on venue ack
  canonicalInstrumentId: { type: String, default: null },
  venueInstrumentId: { type: String, default: null },
  productCategory: { type: String, default: null },
  side: { type: String, enum: ['BUY', 'SELL'], default: null },
  type: { type: String, default: 'market' },
  qty: { type: Number, default: null },

  status: { type: String, default: 'submitted' }, // submitted|accepted|uncertain|filled|cancelled|rejected|reconciled
  strategyVersionId: { type: String, default: null },
  riskDecisionId: { type: String, default: null },
  submittedAt: { type: Number, default: null },
  ackAt: { type: Number, default: null },
  schemaVersion: { type: String, default: 'exchangeOrderMapping.v1' },
}, { timestamps: true, collection: 'exchange_order_mappings' })

ExchangeOrderMappingSchema.index({ ownerId: 1, venue: 1, accountId: 1, clientOrderId: 1 }, { unique: true })
ExchangeOrderMappingSchema.index({ ownerId: 1, venue: 1, accountId: 1, externalOrderId: 1 })

export const ExchangeOrderMapping = mongoose.models.exchange_order_mappings
  || mongoose.model('exchange_order_mappings', ExchangeOrderMappingSchema)
