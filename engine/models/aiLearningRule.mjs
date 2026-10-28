// engine/models/aiLearningRule.mjs
// Real-time Learned Rules from Continuous AI Journal Reviews (roadmap Phase 13 / ADR-004)
//
// These represent the closed feedback loop: rules and risk constraints
// synthesized from trade outcomes and errors (against-regime, sl-too-wide, etc.)
// that are dynamically injected into active AI trading agents during real-time analysis.
import mongoose from 'mongoose'

const AiLearningRuleSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    ruleId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: ['against-regime', 'sl-too-wide', 'entry-too-late', 'rr-too-low', 'exit-too-early', 'timing', 'sizing', 'other'],
      default: 'other',
      index: true
    },
    rule: { type: String, required: true },
    reasoning: { type: String, default: '' },
    confidence: { type: Number, default: 0.8 },
    sampleSize: { type: Number, default: 0 },
    evidence: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ['active', 'paused', 'archived'],
      default: 'active',
      index: true
    },
    source: { type: String, default: 'continuous_review' },
    model: { type: String, default: null },
    symbol: { type: String, default: null },
    timeframe: { type: String, default: null },
    schemaVersion: { type: String, default: 'aiLearningRule.v1' }
  },
  { timestamps: true, collection: 'ai_learning_rules' }
)

AiLearningRuleSchema.index({ ownerId: 1, status: 1, createdAt: -1 })

export const AiLearningRule =
  mongoose.models.ai_learning_rules || mongoose.model('ai_learning_rules', AiLearningRuleSchema)
