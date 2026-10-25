// engine/models/aiAssistantConversation.mjs
// Phase H (§61.12 H5) — persisted assistant conversations.
//
// One document per conversation, owned by the hub user (`ownerId` = JWT `sub`).
// Every turn is appended server-side from the verified ask (never from client
// "trusted facts"), messages are capped (drop oldest, count the drops — same
// discipline as sessions/agents) and the document expires via a Mongo TTL index
// on `expiresAt` (sliding: every append re-arms it).
import mongoose from 'mongoose'

export const ASSISTANT_CONVERSATION_SCHEMA_VERSION = 'assistant-conversation.v1'
export const ASSISTANT_CONVERSATION_MAX_MESSAGES = 100
export const ASSISTANT_CONVERSATION_DEFAULT_TTL_DAYS = 30

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    at: { type: Number, required: true },
    model: { type: String, default: null },
    toolCalls: { type: [String], default: [] },
    refs: { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  { _id: false },
)

const AiAssistantConversationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    scopeType: { type: String, required: true },
    scopeId: { type: String, default: null },
    /** First user question (truncated) — list label. */
    title: { type: String, default: '' },
    messages: { type: [messageSchema], default: [] },
    messageCount: { type: Number, default: 0 },
    droppedMessages: { type: Number, default: 0 },
    lastMessageAt: { type: Number, default: null },
    /** Sliding retention: re-armed on every append; Mongo TTL purges after it. */
    expiresAt: { type: Date, default: null },
    schemaVersion: { type: String, default: ASSISTANT_CONVERSATION_SCHEMA_VERSION },
  },
  { timestamps: true, collection: 'ai_assistant_conversations' },
)

AiAssistantConversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
AiAssistantConversationSchema.index({ ownerId: 1, lastMessageAt: -1 })

export const AiAssistantConversation =
  mongoose.models.ai_assistant_conversations ||
  mongoose.model('ai_assistant_conversations', AiAssistantConversationSchema)
