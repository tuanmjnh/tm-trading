// engine/models/aiAgentAction.mjs
// AI agent action ledger (V3.5 §59.15 Slice D). Append-only audit of EVERY
// action an agent attempted — allowed and blocked alike (§59.16: unauthorized
// actions are "blocked AND audited"). A blocked row is the record that the
// governance layer did its job; it is never deleted to make a report look clean.
//
// Idempotency (D4): unique { agentId, idempotencyKey }. A retried action
// replays the first row instead of producing a second effect.
import mongoose from 'mongoose'
import { AGENT_ACTION_SCHEMA_VERSION, AGENT_ACTIONS, AUTONOMY_LEVELS } from '../agentPolicy.mjs'

export const AGENT_ACTION_STATUSES = Object.freeze(['allowed', 'blocked'])

const AiAgentActionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // actionId
    actionId: { type: String, required: true, index: true },
    agentId: { type: String, required: true, index: true },
    // Tenancy (roadmap §61.3): inherited from the owning agent.
    ownerId: { type: String, default: null, index: true },
    agentVersionId: { type: String, default: null, index: true },
    autonomy: { type: String, enum: [...AUTONOMY_LEVELS], default: null },
    type: { type: String, enum: [...AGENT_ACTIONS], required: true, index: true },
    status: { type: String, enum: [...AGENT_ACTION_STATUSES], required: true, index: true },
    // Deny reason (policy code) — the auditable "why not".
    code: { type: String, default: 'OK' },
    message: { type: String, default: '' },
    sessionId: { type: String, default: null, index: true },
    idempotencyKey: { type: String, required: true },
    // The Risk Gate decision actually used (D7) — null for non-order actions.
    riskDecision: {
      ok: { type: Boolean, default: null },
      code: { type: String, default: null },
      at: { type: Number, default: null },
      mongoDown: { type: Boolean, default: null },
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: '' },
    at: { type: Number, default: null },
    schemaVersion: { type: String, default: AGENT_ACTION_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'ai_agent_actions' },
)

AiAgentActionSchema.index({ agentId: 1, at: -1 })
AiAgentActionSchema.index({ status: 1, at: -1 })
// Per-owner idempotency (D4 across tenants).
AiAgentActionSchema.index({ ownerId: 1, agentId: 1, idempotencyKey: 1 }, { unique: true })

export const AiAgentAction =
  mongoose.models.ai_agent_actions || mongoose.model('ai_agent_actions', AiAgentActionSchema)
