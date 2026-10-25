// server/utils/assistantConversations.ts
// Phase H (§61.12 H5) — persisted assistant conversations, OWNER-SCOPED.
//
// The ask endpoint appends one turn per verified question; the model never sees
// or chooses the owner. Messages are capped (drop oldest, count the drops) and
// the document carries a sliding `expiresAt` purged by the Mongo TTL index —
// retention (H5) is config, not a manual cleanup job. Every read filters by
// ownerId, so a conversation id from another user is simply "not found".
//
// IO is injected (`opts.Model`) so the tests run without Mongo; the pure helpers
// (turn shape, capping, retention, public projection) carry the real contract.

import { engineModel } from './engineModel'

export const CONVERSATION_SCHEMA_VERSION = 'assistant-conversation.v1'
export const CONVERSATION_MAX_MESSAGES = 100
export const CONVERSATION_TITLE_MAX = 80

type AnyDoc = Record<string, any>

export interface ConversationTurnInput {
  /** Existing conversation to append to; omitted/unknown → a new one is created. */
  conversationId?: string | null
  scopeType: string
  scopeId?: string | null
  question: string
  answer: string
  refs?: AnyDoc[] | null
  model?: string | null
  toolCalls?: string[] | null
}

export function conversationTtlDays(env: AnyDoc = process.env): number {
  const n = Number(env.ASSISTANT_CONVERSATION_TTL_DAYS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30
}

/** Unique conversation id (D3 style): time-ordered + random suffix, Mongo `_id` safe. */
export function conversationIdFor(nowMs = Date.now()): string {
  const t = Number(nowMs)
  if (!Number.isFinite(t) || t <= 0) throw new Error('conversation: now must be a positive epoch ms')
  return `cnv_${t.toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function titleFrom(question: string): string {
  const q = String(question ?? '').replace(/\s+/g, ' ').trim()
  return q.length > CONVERSATION_TITLE_MAX ? `${q.slice(0, CONVERSATION_TITLE_MAX - 1)}…` : q
}

function expiresAtFor(nowMs: number, ttlDays: number): Date {
  return new Date(nowMs + Math.max(1, ttlDays) * 86_400_000)
}

/** True when the retention window has passed (belt-and-braces beside the TTL index). */
export function isConversationExpired(doc: AnyDoc | null, nowMs = Date.now()): boolean {
  const exp = doc?.expiresAt
  if (!exp) return false
  const t = exp instanceof Date ? exp.getTime() : new Date(exp).getTime()
  return Number.isFinite(t) && t <= nowMs
}

/** The two messages one ask produces. Pure — the IO layer just appends them. */
export function turnMessages(input: ConversationTurnInput, nowMs: number): AnyDoc[] {
  const base = {
    at: nowMs,
    model: input.model ?? null,
    toolCalls: Array.isArray(input.toolCalls) ? input.toolCalls.map(String) : [],
    refs: Array.isArray(input.refs) ? input.refs : [],
  }
  return [
    { role: 'user', content: String(input.question ?? ''), ...base },
    { role: 'assistant', content: String(input.answer ?? ''), ...base },
  ]
}

/**
 * The Mongo patch for one appended turn. Creates the document on first turn
 * (`$setOnInsert` carries `_id`); caps messages on every append.
 */
export function conversationPatch(input: {
  existing: AnyDoc | null
  ownerId: string
  turn: ConversationTurnInput
  nowMs: number
  ttlDays?: number
  maxMessages?: number
}): { id: string, title: string, set: AnyDoc } {
  const ttlDays = input.ttlDays ?? conversationTtlDays()
  const maxMessages = input.maxMessages ?? CONVERSATION_MAX_MESSAGES
  const id = input.existing ? String(input.existing._id) : conversationIdFor(input.nowMs)
  const scopeType = String(input.existing?.scopeType ?? input.turn.scopeType ?? 'session')
  const scopeId = input.existing ? (input.existing.scopeId ?? null) : (input.turn.scopeId ?? null)

  const messages = [
    ...((input.existing?.messages as AnyDoc[]) ?? []),
    ...turnMessages(input.turn, input.nowMs),
  ]
  const dropped = ((input.existing?.droppedMessages as number) ?? 0)
    + Math.max(0, messages.length - maxMessages)
  const capped = messages.length > maxMessages ? messages.slice(-maxMessages) : messages

  return {
    id,
    title: input.existing?.title ? String(input.existing.title) : titleFrom(input.turn.question),
    set: {
      ownerId: input.ownerId,
      scopeType,
      scopeId,
      title: input.existing?.title ? String(input.existing.title) : titleFrom(input.turn.question),
      messages: capped,
      messageCount: capped.length,
      droppedMessages: dropped,
      lastMessageAt: input.nowMs,
      expiresAt: expiresAtFor(input.nowMs, ttlDays),
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
    },
  }
}

/** Browser-safe projection: never carries `ownerId` or Mongo internals. */
export function publicConversation(doc: AnyDoc | null): AnyDoc | null {
  if (!doc) return null
  return {
    id: String(doc._id),
    scopeType: String(doc.scopeType ?? ''),
    scopeId: doc.scopeId ?? null,
    title: String(doc.title ?? ''),
    messageCount: Number(doc.messageCount ?? 0),
    droppedMessages: Number(doc.droppedMessages ?? 0),
    lastMessageAt: Number(doc.lastMessageAt ?? 0) || null,
    expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    messages: (Array.isArray(doc.messages) ? doc.messages : []).map((m: AnyDoc) => ({
      role: String(m.role ?? 'user'),
      content: String(m.content ?? ''),
      at: Number(m.at ?? 0) || null,
      model: m.model ?? null,
      toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls : [],
      refs: Array.isArray(m.refs) ? m.refs : [],
    })),
  }
}

async function resolveModel(Model?: AnyDoc | null): Promise<AnyDoc | null> {
  if (Model) return Model
  return engineModel('aiAssistantConversation.mjs', 'AiAssistantConversation')
}

/** Newest-first conversations for one owner (expired rows are hidden). */
export async function listConversations(
  ownerId: string,
  { limit = 20, Model, now = Date.now }: { limit?: number, Model?: AnyDoc | null, now?: () => number } = {},
): Promise<AnyDoc[]> {
  const M = await resolveModel(Model)
  if (!M || !ownerId) return []
  const nowMs = now()
  const rows = await (M as AnyDoc).find({ ownerId }).sort({ lastMessageAt: -1, _id: -1 })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100)).lean()
  return (rows as AnyDoc[])
    .filter(doc => !isConversationExpired(doc, nowMs))
    .map(doc => publicConversation(doc) as AnyDoc)
}

export async function getConversation(
  ownerId: string,
  id: string,
  { Model, now = Date.now }: { Model?: AnyDoc | null, now?: () => number } = {},
): Promise<AnyDoc | null> {
  const M = await resolveModel(Model)
  if (!M || !ownerId || !id) return null
  const doc = await (M as AnyDoc).findOne({ _id: String(id), ownerId }).lean()
  return isConversationExpired(doc, now()) ? null : publicConversation(doc)
}

/**
 * Append one verified turn (or create the conversation on the first). Returns
 * the public projection, or null when Mongo is unavailable (fail-soft: the ask
 * itself must never fail because history could not be written).
 */
export async function appendConversationTurn(
  ownerId: string,
  turn: ConversationTurnInput,
  { Model, now = Date.now, ttlDays }: { Model?: AnyDoc | null, now?: () => number, ttlDays?: number } = {},
): Promise<AnyDoc | null> {
  const M = await resolveModel(Model)
  if (!M || !ownerId) return null
  const nowMs = now()
  const existingId = turn.conversationId ? String(turn.conversationId).trim() : ''
  const existing = existingId
    ? await (M as AnyDoc).findOne({ _id: existingId, ownerId }).lean()
    : null
  if (existingId && !existing) return null // foreign or gone — never hijack it
  const { id, set } = conversationPatch({ existing, ownerId, turn, nowMs, ttlDays })
  const saved = await (M as AnyDoc).findOneAndUpdate(
    { _id: id, ownerId },
    { $set: set, $setOnInsert: { _id: id } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
  return publicConversation(saved)
}

export async function deleteConversation(
  ownerId: string,
  id: string,
  { Model }: { Model?: AnyDoc | null } = {},
): Promise<boolean> {
  const M = await resolveModel(Model)
  if (!M || !ownerId || !id) return false
  const removed = await (M as AnyDoc).findOneAndDelete({ _id: String(id), ownerId }).lean()
  return Boolean(removed)
}
