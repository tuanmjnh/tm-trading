// engine/models/aiProposal.mjs
// AI experiment proposals (roadmap §26 `ai_proposals`, §27.3). One row per
// structured proposal the research layer produced. `_id = proposalId` (D3),
// $setOnInsert (D4). `status` tracks the human decision — proposals are DATA
// only (D7): accepting one here creates an experiment, it never changes a
// preset or places an order.
import mongoose from 'mongoose'

import { PROPOSAL_SCHEMA_VERSION } from '../../ai/proposal.mjs'

export const AI_PROPOSAL_STATUSES = Object.freeze(['new', 'accepted', 'rejected', 'experimented'])

const AiProposalSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // proposalId
    proposalId: { type: String, required: true, index: true },
    strategyVersionId: { type: String, default: null, index: true },
    hypothesis: { type: String, required: true },
    changes: { type: mongoose.Schema.Types.Mixed, default: [] },
    evidence: { type: mongoose.Schema.Types.Mixed, default: [] },
    risks: { type: [String], default: [] },
    recommendedTest: { type: mongoose.Schema.Types.Mixed, default: {} },

    generation: { type: mongoose.Schema.Types.Mixed, default: null }, // { model, at, digestHash } when known
    status: { type: String, enum: AI_PROPOSAL_STATUSES, default: 'new', index: true },
    experimentId: { type: String, default: null },

    schemaVersion: { type: String, default: PROPOSAL_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'ai_proposals' },
)

AiProposalSchema.index({ status: 1, createdAt: -1 })

export const AiProposal =
  mongoose.models.ai_proposals || mongoose.model('ai_proposals', AiProposalSchema)