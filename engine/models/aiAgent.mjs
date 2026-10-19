// engine/models/aiAgent.mjs
// AI agent registry (V3.5 §59.15 Slice D). One row per governable agent: its
// current autonomy level, lifecycle state and the immutable version it is
// allowed to act with. Lifecycle rules live in engine/agentPolicy.mjs — the
// model only defines the persisted shape and the indexes the dashboard queries.
import mongoose from 'mongoose'
import { AGENT_SCHEMA_VERSION, AGENT_STATES } from '../agentPolicy.mjs'

const TimelineEventSchema = new mongoose.Schema(
  {
    t: { type: Number, required: true },
    kind: { type: String, default: 'note' },
    message: { type: String, default: '' },
  },
  { _id: false },
)

const AiAgentSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // agentId
    agentId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    // Autonomy level (§59.15 A0..A4). A3/A4 are policy-disabled — a row may
    // exist with them, no action may ever be authorized at them.
    autonomy: { type: String, enum: ['A0', 'A1', 'A2', 'A3', 'A4'], default: 'A0', index: true },
    accountId: { type: String, default: 'default', index: true },
    // Tenancy (roadmap §61.3): agents are user-scoped; accountId is a sub-book.
    ownerId: { type: String, default: null, index: true },
    instruments: { type: [String], default: [] },
    state: { type: String, enum: AGENT_STATES, default: 'draft', index: true },
    // The only version allowed to act (authorizeAction enforces the match).
    activeVersionId: { type: String, default: null },
    versionCount: { type: Number, default: 0 },
    startedAt: { type: Number, default: null },
    disabledAt: { type: Number, default: null },
    lastEventAt: { type: Number, default: null },
    // Liveness: set on activation and on every allowed action; never fabricated.
    lastHeartbeatAt: { type: Number, default: null },
    actionCounts: {
      allowed: { type: Number, default: 0 },
      blocked: { type: Number, default: 0 },
    },
    timeline: { type: [TimelineEventSchema], default: [] },
    timelineDropped: { type: Number, default: 0 },
    createdBy: { type: String, default: null },
    schemaVersion: { type: String, default: AGENT_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'ai_agents' },
)

AiAgentSchema.index({ state: 1, lastEventAt: -1 })
AiAgentSchema.index({ accountId: 1, createdAt: -1 })

export const AiAgent = mongoose.models.ai_agents || mongoose.model('ai_agents', AiAgentSchema)
