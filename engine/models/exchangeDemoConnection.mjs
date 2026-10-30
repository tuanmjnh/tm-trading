import mongoose from 'mongoose'

export const EXCHANGE_DEMO_PROFILES = Object.freeze(['bybit', 'okx', 'okx-us', 'okx-eea', 'binance', 'binance-usdm'])

const ExchangeDemoConnectionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  ownerId: { type: String, required: true, index: true },
  profile: { type: String, enum: EXCHANGE_DEMO_PROFILES, required: true },
  credentialsEnc: { type: String, required: true },
  keyMask: { type: String, default: '' },
  keyFingerprint: { type: String, default: null },
  enabled: { type: Boolean, default: true },
  status: { type: String, enum: ['untested', 'up', 'down'], default: 'untested' },
  lastTestedAt: { type: Number, default: null },
  lastLatencyMs: { type: Number, default: null },
  lastErrorCode: { type: String, default: null },
  schemaVersion: { type: String, default: 'exchangeDemoConnection.v1' },
}, { timestamps: true, collection: 'exchange_demo_connections' })

ExchangeDemoConnectionSchema.index({ ownerId:  1, profile: 1 }, { unique: true })

export const ExchangeDemoConnection = mongoose.models.exchange_demo_connections
  || mongoose.model('exchange_demo_connections', ExchangeDemoConnectionSchema)
