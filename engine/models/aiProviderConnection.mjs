// engine/models/aiProviderConnection.mjs
// Phase G / D35: AI provider connections are app-owned. One row per credential
// the local app may use. Secrets are AES-256-GCM envelopes (engine/aiProviderCrypto.mjs)
// and are never included in API responses.
import mongoose from 'mongoose'

import { AI_PROVIDER_SCHEMA_VERSION } from '../aiProviders.mjs'

export const AI_PROVIDER_STATUSES = Object.freeze(['untested', 'ok', 'error', 'disabled'])

const AiProviderConnectionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, default: 'default' },
    provider: { type: String, required: true, index: true },
    adapter: { type: String, required: true },
    baseUrl: { type: String, required: true },
    model: { type: String, required: true },
    secretEnc: { type: String, default: null },
    secretMask: { type: String, default: '' },
    secretFingerprint: { type: String, default: null },
    enabled: { type: Boolean, default: true, index: true },
    capabilities: { type: mongoose.Schema.Types.Mixed, default: {} },
    privacy: { type: String, default: 'deployment' },
    status: { type: String, enum: AI_PROVIDER_STATUSES, default: 'untested', index: true },
    lastTestedAt: { type: Number, default: null },
    lastError: { type: String, default: null },
    lastErrorCode: { type: String, default: null },
    testLatencyMs: { type: Number, default: null },
    budgets: { type: mongoose.Schema.Types.Mixed, default: {} },
    // TM Hub relay linkage. Null for locally-credentialed connections; hub rows
    // carry the hub-side connection id so relay calls can address it.
    hubConnectionId: { type: String, default: null, index: true },
    hubProvider: { type: String, default: null },
    hubSyncedAt: { type: Number, default: null },
    ownerId: { type: String, default: null, index: true },
    schemaVersion: { type: String, default: AI_PROVIDER_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'ai_provider_connections' },
)

AiProviderConnectionSchema.index({ enabled: 1, provider: 1 })

export const AiProviderConnection =
  mongoose.models.ai_provider_connections ||
  mongoose.model('ai_provider_connections', AiProviderConnectionSchema)
