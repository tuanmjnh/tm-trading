// engine/models/aiProviderAudit.mjs
// Append-only audit for provider configuration and health actions. Inference
// requests keep their own NDJSON audit (logs/ai.ndjson); this collection records
// who changed/tested a connection, without secrets.
import mongoose from 'mongoose'

const AiProviderAuditSchema = new mongoose.Schema(
  {
    at: { type: Number, required: true, index: true },
    action: { type: String, required: true, index: true }, // create | update | delete | test | enable | disable
    connectionId: { type: String, default: null, index: true },
    provider: { type: String, default: null },
    actor: { type: String, default: null },
    ok: { type: Boolean, default: true },
    code: { type: String, default: null },
    detail: { type: String, default: null },
  },
  { collection: 'ai_provider_audit' },
)

AiProviderAuditSchema.index({ connectionId: 1, at: -1 })

export const AiProviderAudit =
  mongoose.models.ai_provider_audit || mongoose.model('ai_provider_audit', AiProviderAuditSchema)
