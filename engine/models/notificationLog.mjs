// engine/models/notificationLog.mjs
// Notification log (roadmap §25 + §26 collection `notification_logs`): the
// audit trail of the Notification Router — every event gets a row recording
// what was routed, where, and what ACTUALLY happened per channel.
//
// `_id = ${notifyId}:${at}` (D3/D4): the same event replayed with the same
// event-time can never be recorded twice, and `delivered: []` rows are kept
// ON PURPOSE — a silent notification system is indistinguishable from a dead
// one (D12), so failures are part of the record, not noise.
import mongoose from 'mongoose'

import { ROUTER_VERSION } from '../../notify/router.mjs'

const NotificationLogSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `${notifyId}:${at}`
    notifyId: { type: String, required: true }, // hash identity
    dedupeKey: { type: String, default: null },
    kind: { type: String, required: true }, // market|signal|risk|order|position|service
    priority: { type: String, required: true }, // critical|important|normal|info
    preset: { type: String, default: null },
    name: { type: String, default: null },
    symbol: { type: String, default: null },
    title: { type: String, default: null },
    body: { type: String, default: null },

    at: { type: Number, required: true }, // event time (D17)
    sentAt: { type: Number, required: true }, // delivery-attempt time (D17)

    attempts: { type: mongoose.Schema.Types.Mixed, default: [] }, // [{channel, ok, error?}]
    delivered: { type: [String], default: [] },
    deduped: { type: Boolean, default: false },
    routerVersion: { type: String, default: ROUTER_VERSION }, // D1
  },
  { timestamps: true, collection: 'notification_logs' },
)

NotificationLogSchema.index({ notifyId: 1, sentAt: -1 })
NotificationLogSchema.index({ kind: 1, sentAt: -1 })
NotificationLogSchema.index({ priority: 1, sentAt: -1 })
NotificationLogSchema.index({ symbol: 1, sentAt: -1 })

export const NotificationLog =
  mongoose.models.notification_logs || mongoose.model('notification_logs', NotificationLogSchema)