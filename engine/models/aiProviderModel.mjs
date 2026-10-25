// engine/models/aiProviderModel.mjs
// Phase G.5 — per-connection model catalogue (mirrors tm-hub R147 ai_models,
// app-owned per D35). One row per saved model for a connection credential, so
// the desk can keep an address book of models and switch the bot's active model
// with one click.
//
// `_id` = `${connectionId}::${model}` — deterministic (D3): re-saving a
// discovered model upserts instead of appending.
// A partial unique index enforces AT MOST ONE primary model per connection.
import mongoose from 'mongoose'

import { AI_PROVIDER_SCHEMA_VERSION } from '../aiProviders.mjs'

export const AI_MODEL_SOURCES = Object.freeze(['discovered', 'manual'])

const AiProviderModelSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    connectionId: { type: String, required: true, index: true },
    ownerId: { type: String, default: null, index: true },
    model: { type: String, required: true },
    // Optional friendly label (tm-hub parity). The raw `model` string is what
    // the gateway consumes; displayName is display-only.
    displayName: {
      type: String,
      default: '',
      set: (v) => String(v ?? '').slice(0, 128),
    },
    isEnabled: { type: Boolean, default: true },
    isPrimary: { type: Boolean, default: false },
    source: { type: String, enum: AI_MODEL_SOURCES, default: 'manual' },
    schemaVersion: { type: String, default: AI_PROVIDER_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'ai_provider_models' },
)

// At most ONE primary model per connection (the bot's active model).
AiProviderModelSchema.index(
  { connectionId: 1, isPrimary: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } },
)
AiProviderModelSchema.index({ ownerId: 1, connectionId: 1 })

export const AiProviderModel =
  mongoose.models.ai_provider_models ||
  mongoose.model('ai_provider_models', AiProviderModelSchema)
