// engine/models/alertRule.mjs
// COLLECTION `alert_rules` — user-defined alert conditions (roadmap §58.5 /alerts).
//
// §58.6 boundary: an Alert Rule is a trading-domain CONDITION over the intel
// event stream (news/alert); it keeps NO delivery state. When a rule matches, the
// alertRules service routes the event through the shared notify/ router (§25) and
// the notification_logs ledger owns dedupe. `stats` is a read model for the UI.
//
// `ruleKey` (unique) is the stable definition identity (engine/alertRules.mjs) so
// re-seeding the same rule is idempotent (D4 lesson).
import mongoose from 'mongoose'

import { RULE_EVENT_KINDS, RULE_LEVELS, RULE_DIRS, RULE_PRIORITIES } from '../alertRules.mjs'

const AlertRuleSchema = new mongoose.Schema(
  {
    ruleKey: { type: String, required: true },
    // Tenancy (roadmap §61.3): alert rules are user-scoped.
    ownerId: { type: String, default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    enabled: { type: Boolean, default: true },
    kind: { type: String, required: true, enum: RULE_EVENT_KINDS, default: 'news' },
    minLevel: { type: String, enum: RULE_LEVELS, default: 'med' },
    dirs: { type: [String], enum: RULE_DIRS, default: [] },
    symbols: { type: [String], default: [] },
    sources: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    minScore: { type: Number, default: null },
    priority: { type: String, enum: RULE_PRIORITIES, default: 'normal' },
    lookbackSec: { type: Number, default: 7 * 24 * 3600 },
    stats: {
      matches: { type: Number, default: 0 },
      notified: { type: Number, default: 0 },
      lastMatchAt: { type: Date, default: null },
      lastRunAt: { type: Date, default: null },
    },
  },
  { timestamps: true, collection: 'alert_rules' },
)

AlertRuleSchema.index({ enabled: 1 })
// Per-owner rule identity: the global `ruleKey_1` unique is dropped.
AlertRuleSchema.index({ ownerId: 1, ruleKey: 1 }, { unique: true })

export const AlertRule = mongoose.models.alert_rules || mongoose.model('alert_rules', AlertRuleSchema)
