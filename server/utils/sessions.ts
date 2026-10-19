import { createError } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tradingSessionModel } from './engineModel'

// =============================================================================
//  Trading session store (V3.4 Slice C).
//
//  Every write goes through the pure guards in engine/session.mjs (D25) — this
//  module only resolves the model, applies the guarded result and reads.
//  Reads are fail-soft (empty on a store blip, never a 500); writes surface
//  failure so the UI/executor can report it.
//
//  Dynamic engine import (pathToFileURL + @vite-ignore): Nitro dev bundles
//  static relative paths out of server/ incorrectly (docs/app-inheritance.md).
// =============================================================================

interface SessionModule {
  createSession(input: Record<string, unknown>): Record<string, unknown>
  transition(doc: unknown, to: string, opts?: Record<string, unknown>): { ok: boolean; doc?: Record<string, unknown>; code?: string; message?: string }
  appendEvent(doc: unknown, event: unknown): Record<string, unknown>
  SESSION_STATES: readonly string[]
}

export class SessionError extends Error {
  statusCode: number
  statusMessage: string
  constructor(message: string, statusCode = 400, statusMessage = 'session_error') {
    super(message)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

export function sessionsHttpError(err: unknown) {
  if (err instanceof SessionError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string } | null
  if (e && typeof e.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'error' })
  }
  return createError({ statusCode: 500, statusMessage: 'session_failed', message: (e?.message) || 'session failed' })
}

let sessionModP: Promise<SessionModule> | null = null

function sessionModule(): Promise<SessionModule> {
  if (!sessionModP) {
    const href = pathToFileURL(join(process.cwd(), 'engine', 'session.mjs')).href
    sessionModP = import(/* @vite-ignore */ href) as Promise<SessionModule>
  }
  return sessionModP
}

export interface StartSessionInput {
  kind?: string
  strategyVersionId?: string | null
  botProfileId?: string | null
  accountId?: string
  instruments?: string[]
  timeframes?: string[]
  manifest?: Record<string, unknown> | null
  restartedFrom?: string | null
  createdBy?: string | null
  /** Tenancy (docs/web-app/user-tenancy-plan.md): hub user id owning the session. */
  ownerId?: string | null
}

/** Start a session: guard-built doc, persisted once (D3 id = sessionId). */
export async function startSession(input: StartSessionInput): Promise<Record<string, unknown>> {
  const Session = await tradingSessionModel()
  if (!Session) throw new SessionError('sessions store unavailable', 503, 'mongo_down')
  const mod = await sessionModule()
  let doc: Record<string, unknown>
  try {
    doc = mod.createSession({ ...input, now: Date.now() })
  } catch (err) {
    throw new SessionError(err instanceof Error ? err.message : 'invalid session', 400, 'invalid_session')
  }
  // The engine builds a fixed doc shape; ownership is stamped here, at the
  // transport boundary, so the guard contract in engine/session.mjs stays put.
  if (input.ownerId) doc.ownerId = input.ownerId
  try {
    const created = await Session.create(doc)
    return created.toObject ? created.toObject() : created
  } catch (err) {
    const code = (err as { code?: unknown })?.code
    if (code === 11000) throw new SessionError('session already exists', 409, 'session_exists')
    throw err
  }
}

/** Guarded state transition (illegal moves rejected, never forced). */
export async function moveSession(id: string, to: string, ownerId?: string): Promise<Record<string, unknown>> {
  const Session = await tradingSessionModel()
  if (!Session) throw new SessionError('sessions store unavailable', 503, 'mongo_down')
  const found = await Session.findOne({ $or: [{ _id: id }, { sessionId: id }], ...(ownerId ? { ownerId } : {}) }).lean()
  if (!found) throw new SessionError(`session not found: ${id}`, 404, 'session_not_found')
  const mod = await sessionModule()
  const res = mod.transition(found, to, { at: Date.now() })
  if (!res.ok) throw new SessionError(res.message ?? 'illegal transition', 409, res.code ?? 'illegal_transition')
  await Session.updateOne(
    { _id: found._id },
    { $set: { state: res.doc!.state, startedAt: res.doc!.startedAt ?? null, stoppedAt: res.doc!.stoppedAt ?? null, lastEventAt: res.doc!.lastEventAt, timeline: res.doc!.timeline, timelineDropped: res.doc!.timelineDropped } }
  )
  const updated = await Session.findOne({ _id: found._id }).lean()
  return (updated ?? res.doc!) as Record<string, unknown>
}

/** Append a timeline event (capped, counted overflow). */
export async function logSessionEvent(id: string, event: Record<string, unknown>, ownerId?: string): Promise<Record<string, unknown>> {
  const Session = await tradingSessionModel()
  if (!Session) throw new SessionError('sessions store unavailable', 503, 'mongo_down')
  const found = await Session.findOne({ $or: [{ _id: id }, { sessionId: id }], ...(ownerId ? { ownerId } : {}) }).lean()
  if (!found) throw new SessionError(`session not found: ${id}`, 404, 'session_not_found')
  const mod = await sessionModule()
  const doc = mod.appendEvent(found, { ...event, t: Date.now() })
  await Session.updateOne(
    { _id: found._id },
    { $set: { timeline: doc.timeline, timelineDropped: doc.timelineDropped, lastEventAt: doc.lastEventAt } }
  )
  return doc
}

export interface ListSessionsOptions {
  limit?: number
  state?: string
  kind?: string
  accountId?: string
  /** Tenancy (docs/web-app/user-tenancy-plan.md): restrict to one hub owner. */
  ownerId?: string
}

export async function listSessions(options: ListSessionsOptions = {}): Promise<Record<string, unknown>[]> {
  const Session = await tradingSessionModel()
  if (!Session) return []
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
  const filter: Record<string, unknown> = {}
  if (options.state) filter.state = options.state
  if (options.kind) filter.kind = options.kind
  if (options.accountId) filter.accountId = options.accountId
  if (options.ownerId) filter.ownerId = options.ownerId
  try {
    return (await Session.find(filter).sort({ lastEventAt: -1, _id: -1 }).limit(limit).lean()) as Record<string, unknown>[]
  } catch {
    return []
  }
}

export async function getTradingSession(id: string, ownerId?: string): Promise<Record<string, unknown> | null> {
  const Session = await tradingSessionModel()
  if (!Session) return null
  try {
    const found = await Session.findOne({ $or: [{ _id: id }, { sessionId: id }], ...(ownerId ? { ownerId } : {}) }).lean()
    return (found ?? null) as Record<string, unknown> | null
  } catch {
    return null
  }
}

