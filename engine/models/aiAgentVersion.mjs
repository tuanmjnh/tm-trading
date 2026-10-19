// engine/models/aiAgentVersion.mjs
// Immutable AI agent versions (V3.5 §59.15 Slice D): model + system prompt +
// tool allowlist + autonomy snapshot, identified by a content hash
// (engine/agentPolicy.mjs versionHash). Store code never updates the behavioural
// fields — the single documented exception is the append-once
// `riskIntegration` evidence block that unblocks A2, guarded by
// riskIntegrationEdge().
import mongoose from 'mongoose'
import { AGENT_VERSION_SCHEMA_VERSION, AUTONOMY_LEVELS } from '../agentPolicy.mjs'

const AiAgentVersionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // versionId
    versionId: { type: String, required: true, index: true },
    agentId: { type: String, required: true, index: true },
    // Tenancy (roadmap §61.3): inherited from the owning agent.
    ownerId: { type: String, default: null, index: true },
    version: { type: Number, required: true },
    autonomy: { type: String, enum: [...AUTONOMY_LEVELS], required: true },
    model: { type: mongoose.Schema.Types.Mixed, default: null }, // { provider, model, temperature? }
    prompts: {
      system: { type: String, required: true },
    },
    tools: { type: [String], default: [] },
    // Frozen copy of the policy that governed this version (so a later policy
    // change is visible as a difference, not a silent retro-edit).
    policy: { type: mongoose.Schema.Types.Mixed, default: null },
    // A2 gate: write-once evidence that the risk-integration tests passed.
    riskIntegration: {
      passed: { type: Boolean, default: false },
      at: { type: Number, default: null },
      evidence: { type: String, default: null },
      tests: { type: [String], default: [] },
    },
    note: { type: String, default: '' },
    hash: { type: String, required: true },
    immutable: { type: Boolean, default: true },
    createdBy: { type: String, default: null },
    schemaVersion: { type: String, default: AGENT_VERSION_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'ai_agent_versions' },
)

AiAgentVersionSchema.index({ agentId: 1, version: -1 })
AiAgentVersionSchema.index({ hash: 1 })

export const AiAgentVersion =
  mongoose.models.ai_agent_versions || mongoose.model('ai_agent_versions', AiAgentVersionSchema)
