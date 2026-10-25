// engine/models/botCommand.mjs
// Durable command inbox for bot instances (roadmap §61.7 / §61.17 Phase E).
//
// WHY A COLLECTION: "start/pause/resume/stop" must survive an API process
// restart and must be safe to retry. The caller supplies a `commandId`; the
// unique (ownerId, commandId) index makes delivery at-least-once while the
// effect stays at-most-once. The supervisor — not the API — performs the
// transition and records the outcome here.
import mongoose from 'mongoose'

/** Command types the supervisor knows how to apply. */
export const BOT_COMMAND_TYPES = Object.freeze(['start', 'pause', 'resume', 'stop'])

/** Command lifecycle: pending -> applied | rejected. */
export const BOT_COMMAND_STATES = Object.freeze(['pending', 'applied', 'rejected'])

const BotCommandSchema = new mongoose.Schema(
  {
    // Caller-supplied idempotency key (UI/CLI). Unique per owner below.
    commandId: { type: String, required: true },
    // Tenancy (roadmap §61.3): the command belongs to the instance's owner.
    ownerId: { type: String, default: null, index: true },
    instanceId: { type: String, required: true, index: true },
    botProfileId: { type: String, default: null },
    accountId: { type: String, default: null },
    type: { type: String, enum: [...BOT_COMMAND_TYPES], required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: [...BOT_COMMAND_STATES], default: 'pending', index: true },
    // Stable English reason code from engine/botSupervisor.mjs validateCommand().
    reasonCode: { type: String, default: null },
    message: { type: String, default: null },
    // Which supervisor claimed/applied it (audit + duplicate-worker detection).
    supervisorId: { type: String, default: null },
    requestedAt: { type: Number, default: null },
    appliedAt: { type: Number, default: null },
    schemaVersion: { type: String, default: 'botCommand.v1' },
  },
  { timestamps: true, collection: 'bot_commands' },
)

// One command id per owner (retry-safe). Not global: two tenants may reuse a
// client-generated uuid without blocking each other.
BotCommandSchema.index({ ownerId: 1, commandId: 1 }, { unique: true })
BotCommandSchema.index({ instanceId: 1, status: 1, requestedAt: 1 })

export const BotCommand = mongoose.models.bot_commands || mongoose.model('bot_commands', BotCommandSchema)
