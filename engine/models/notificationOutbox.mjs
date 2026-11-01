// engine/models/notificationOutbox.mjs
// COLLECTION `notification_outbox` — the DURABLE delivery queue (roadmap §7.3).
//
// Why a second collection next to `notification_logs`: the ledger is an immutable
// audit trail (`_id = notifyId:at`, D4 first-wins), while a retry needs MUTABLE
// state (attempts, next attempt time, last error, provider message id). Keeping
// the queue separate means the audit of "what we tried" is never rewritten by a
// retry, and the queue can be queried/indexed for "what is due".
//
// `_id = ${notifyId}:${channel}`: one row per event per channel, so a replay of
// the same event (same event time, D17) can never queue a duplicate message.
import mongoose from 'mongoose'

import { OUTBOX_STATES, OUTBOX_VERSION } from '../../notify/outbox.mjs'

const NotificationOutboxSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `${notifyId}:${channel}`
    outboxVersion: { type: String, default: OUTBOX_VERSION }, // D1
    notifyId: { type: String, required: true },
    dedupeKey: { type: String, default: null },
    channel: { type: String, required: true }, // telegram | webPush | electron
    ownerId: { type: String, default: null, index: true }, // tenancy (§61.3)
    category: { type: String, default: null }, // §7.1 alert category
    kind: { type: String, required: true },
    priority: { type: String, required: true },
    preset: { type: String, default: null },
    name: { type: String, default: null },
    symbol: { type: String, default: null },
    title: { type: String, default: null },
    body: { type: String, default: null },

    at: { type: Number, required: true }, // event time (D17)
    state: { type: String, enum: OUTBOX_STATES, default: 'queued', index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Number, default: null },
    lastError: { type: String, default: null },
    messageId: { type: String, default: null }, // provider acknowledgement (§7.3)
    dead: { type: Boolean, default: false, index: true },
    outcomeAt: { type: Number, default: null },
  },
  { timestamps: true, collection: 'notification_outbox' },
)

// "What is due": the drain query. Partial-ish compound keeps it index-only.
NotificationOutboxSchema.index({ state: 1, nextAttemptAt: 1 })
NotificationOutboxSchema.index({ channel: 1, state: 1 })
NotificationOutboxSchema.index({ notifyId: 1 })

export const NotificationOutbox =
  mongoose.models.notification_outbox || mongoose.model('notification_outbox', NotificationOutboxSchema)
