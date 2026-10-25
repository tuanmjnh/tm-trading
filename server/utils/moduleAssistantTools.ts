// server/utils/moduleAssistantTools.ts
// Phase H (§61.12) — owner-scoped READ tools for the in-module assistant.
//
// The assistant model receives these tool schemas, but the OWNER is never a
// model argument: `executeAssistantTool` injects the caller's owner id (from the
// verified hub token) into every read. The model can only choose WHICH owned
// record to read, never whose — a foreign id simply returns "not found", exactly
// like the context-bundle scopes. Tool names are gated by the A0 allowlist in
// `engine/agentPolicy.mjs` (`ASSISTANT_READ_TOOLS`); the executor set here must
// match it (asserted in tests/assistant.test.ts).

import { getTradingSession, listSessions } from './sessions'
import { listSignals } from './signals'
import { listPositions } from './positions'
import { listPaperOrders } from './paperOrders'

export interface AssistantToolCtx {
  ownerId: string
}

export interface AssistantToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ToolArgs = Record<string, unknown>
type ToolExec = (args: ToolArgs, ctx: AssistantToolCtx) => Promise<unknown>

const MAX_LIMIT = 25

function clampLimit(value: unknown, fallback = 10): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, MAX_LIMIT)
}

function str(v: unknown): string | null {
  return v == null ? null : String(v)
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function slimSession(s: any) {
  return {
    id: str(s?._id ?? s?.sessionId),
    status: str(s?.status),
    symbol: str(s?.symbol),
    method: str(s?.method),
    tf: str(s?.tf),
    direction: s?.dir === -1 ? 'short' : s?.dir === 1 ? 'long' : str(s?.direction),
    openedAt: str(s?.openedAt ?? s?.startedAt),
    lastEventAt: str(s?.lastEventAt),
    closedAt: str(s?.closedAt),
  }
}

const IMPLS: Record<string, ToolExec> = {
  async listSessions(args, ctx) {
    const rows = await listSessions({ ownerId: ctx.ownerId, limit: clampLimit(args?.limit) })
    return { count: rows.length, sessions: rows.map(slimSession) }
  },

  async getSession(args, ctx) {
    const id = str(args?.id)?.trim()
    if (!id) return { error: 'id is required' }
    const row = await getTradingSession(id, ctx.ownerId)
    return row ? { session: slimSession(row) } : { error: 'session not found for this owner' }
  },

  async listSignals(args, ctx) {
    const res = await listSignals({
      ownerId: ctx.ownerId,
      limit: clampLimit(args?.limit),
      symbol: args?.symbol ? String(args.symbol).toUpperCase() : undefined,
    })
    return {
      count: res.items.length,
      signals: res.items.map(s => ({
        id: str(s.id),
        ts: str(s.ts),
        symbol: str(s.symbol),
        tf: str(s.tf),
        action: str(s.action),
        side: str(s.side),
        price: num(s.price),
        status: str(s.status),
      })),
    }
  },

  async listPositions(args, ctx) {
    const res = await listPositions({
      ownerId: ctx.ownerId,
      limit: clampLimit(args?.limit),
      status: args?.status ? String(args.status) : undefined,
      symbol: args?.symbol ? String(args.symbol) : undefined,
    })
    return {
      count: res.items.length,
      open: res.open,
      closed: res.closed,
      positions: res.items.map(p => ({
        id: str(p.id),
        symbol: str(p.symbol),
        dir: p.dir === -1 ? 'short' : 'long',
        qty: num(p.qty),
        entryPrice: num(p.entryPrice),
        status: str(p.status),
        sl: num(p.sl),
        tps: Array.isArray(p.tps) ? p.tps : [],
        pnlAbs: num(p.pnlAbs),
        pnlPct: num(p.pnlPct),
        sessionId: str(p.sessionId),
      })),
    }
  },

  async listOrders(args, ctx) {
    const res = await listPaperOrders({
      ownerId: ctx.ownerId,
      limit: clampLimit(args?.limit),
      status: args?.status ? String(args.status) : undefined,
      symbol: args?.symbol ? String(args.symbol) : undefined,
    })
    return {
      count: res.items.length,
      orders: res.items.map(o => ({
        id: str(o.id),
        symbol: str(o.symbol),
        side: str(o.side),
        type: str(o.type),
        qty: num(o.qty),
        price: num(o.price),
        status: str(o.status),
        createdAt: str(o.createdAt),
      })),
    }
  },
}

export const ASSISTANT_TOOL_NAMES = Object.freeze(Object.keys(IMPLS))

/** Real owner-scoped executors (Mongo-backed). Tests may inject fakes instead. */
export const ASSISTANT_TOOL_EXECUTORS = IMPLS

const limitParam = {
  type: 'integer',
  description: `Maximum rows to return (1-${MAX_LIMIT}, default 10).`,
  minimum: 1,
  maximum: MAX_LIMIT,
}

export const ASSISTANT_TOOL_SPECS: AssistantToolSpec[] = [
  {
    name: 'listSessions',
    description: "The caller's most recent trading sessions (owner-scoped).",
    parameters: { type: 'object', properties: { limit: limitParam }, additionalProperties: false },
  },
  {
    name: 'getSession',
    description: "One of the caller's trading sessions by id (404/not-found if it is not theirs).",
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Session id (from a prior listSessions call or the context bundle).' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'listSignals',
    description: "The caller's most recent webhook signals (owner-scoped).",
    parameters: {
      type: 'object',
      properties: { limit: limitParam, symbol: { type: 'string', description: 'Optional symbol filter, e.g. BTCUSDT.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'listPositions',
    description: "The caller's positions, open or closed (owner-scoped).",
    parameters: {
      type: 'object',
      properties: {
        limit: limitParam,
        status: { type: 'string', description: "Optional status filter, e.g. 'open' or 'closed'." },
        symbol: { type: 'string', description: 'Optional symbol filter.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'listOrders',
    description: "The caller's most recent paper orders (owner-scoped).",
    parameters: {
      type: 'object',
      properties: {
        limit: limitParam,
        status: { type: 'string', description: 'Optional order status filter.' },
        symbol: { type: 'string', description: 'Optional symbol filter.' },
      },
      additionalProperties: false,
    },
  },
]

/** Specs for the given allowlist, in a stable order, skipping any unknown name. */
export function assistantToolSpecs(names: readonly string[]): AssistantToolSpec[] {
  return ASSISTANT_TOOL_SPECS.filter(s => names.includes(s.name))
}

/**
 * Execute one assistant tool. `name` must already have passed
 * `checkAssistantTool`; unknown names fail closed. Never throws.
 */
export async function executeAssistantTool(
  name: string,
  args: ToolArgs,
  ctx: AssistantToolCtx,
  execs: Record<string, ToolExec> = IMPLS,
): Promise<unknown> {
  const exec = execs[String(name)]
  if (!exec) return { error: `unknown tool "${name}"` }
  try {
    return await exec(args ?? {}, ctx)
  } catch (err) {
    return { error: String((err as Error)?.message ?? err).slice(0, 200) }
  }
}
