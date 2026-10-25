import { readBody } from 'h3'
import { askModuleAssistant, moduleAssistantHttpError } from '../../../utils/moduleAssistant'
import type { AssistantScope } from '../../../utils/moduleAssistant'
import { appendConversationTurn } from '../../../utils/assistantConversations'

/**
 * POST /api/v1/assistant/ask (Phase H §61.12) — READ-ONLY contextual assistant.
 *
 * Body: `{ scope: { type, id?, source?, group?, horizon? }, question, conversationId? }`.
 * The legacy `{ sessionId, question }` shape is still accepted. The server
 * re-fetches every referenced record (owner-scoped where ownership exists;
 * rights-gated for news/outlook) and answers from that bundle only.
 * With a `conversationId` (or without one — a new conversation is started), the
 * verified turn is appended to the caller's saved history (H5, fail-soft).
 * Token from tm-hub required (server/middleware/auth.ts - D10).
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidRequest', message: 'JSON body is required' })
  }
  const scope = parseScope(body.scope)
  const question = typeof body.question === 'string' ? body.question : null
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null
  try {
    const data = await askModuleAssistant({
      ownerId,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      question,
      scope,
    })
    // H5 — persist the verified turn. Fail-soft: history must never break the ask.
    let conversation: Record<string, unknown> | null = null
    try {
      conversation = await appendConversationTurn(ownerId, {
        conversationId,
        scopeType: String(scope?.type ?? 'session'),
        scopeId: scope?.id ?? (typeof body.sessionId === 'string' ? body.sessionId : null),
        question: String(question ?? ''),
        answer: String(data.answer ?? ''),
        refs: Array.isArray(data.refs) ? data.refs : [],
        model: data.model ?? null,
        toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [],
      })
    } catch {
      conversation = null
    }
    return { success: true, data: { ...data, conversation } }
  } catch (err) {
    throw moduleAssistantHttpError(err)
  }
})

function parseScope(raw: unknown): AssistantScope | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  return {
    type: typeof s.type === 'string' ? s.type as AssistantScope['type'] : 'session',
    id: typeof s.id === 'string' ? s.id : null,
    source: s.source === 'engine' ? 'engine' : s.source === 'alerts' ? 'alerts' : null,
    group: typeof s.group === 'string' ? s.group : null,
    horizon: typeof s.horizon === 'string' ? s.horizon : null,
  }
}
