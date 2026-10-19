import { engineModel, simulationAccount, workspaceStore } from './engineModel'
import type { LiveAccount } from '../../types/positions'
import type { LiveQuote } from './livePositions'

/**
 * §20 paper account view for the dashboard — READ-ONLY projection.
 *
 * Balance / realized / daily / drawdown are DERIVED from the persisted position
 * docs through the pure simulation core (simulation/account.mjs) — the account
 * survives refresh / reconnect / backend restart without changing history.
 * `initialBalance` is the seed the executor froze at first activity
 * (engine/models/account.mjs), falling back to RISK_EQUITY. Mongo or plane
 * down => null, the route keeps the base read fail-soft (D12).
 *
 * Tenancy (docs/web-app/user-tenancy-plan.md): every read is scoped by
 * `ownerId` (the hub user id). `account` is a sub-book INSIDE one owner, and the
 * literal 'default' is a SENTINEL meaning "the caller's active account" — the
 * executor writes its own account ids (e.g. 'paper'), so a hard-coded 'default'
 * used to read an account nobody owns and silently fall back to RISK_EQUITY.
 */
export interface PaperAccountArgs {
  /** Hub user id (`sub`) that owns the account. Required. */
  ownerId: string
  /** Explicit paper account id, or omitted/'default' to resolve the active one. */
  account?: string
  quoteFor?: (symbol: string) => LiveQuote | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model?: any
  now?: number
}

/** Sentinel: "use the caller's active account" (see the module comment). */
const AUTO_ACCOUNT = 'default'

/**
 * Resolve which paper account the caller is looking at when no explicit id is
 * given: the owner's most recently touched paper_accounts row, else the account
 * of their most recent position, else the 'default' placeholder.
 */
async function resolveAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Account: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Position: any,
  ownerId: string
): Promise<string> {
  try {
    const seed = await Account?.findOne({ ownerId }).sort({ updatedAt: -1 }).lean()
    if (seed?.accountId) return String(seed.accountId)
  } catch { /* fall through to the position book */ }
  try {
    const latest = await Position.findOne({ ownerId }).sort({ entryTime: -1 }).lean()
    if (latest?.account) return String(latest.account)
  } catch { /* fall through to the placeholder */ }
  return AUTO_ACCOUNT
}

/** One row of GET /api/v1/paper/accounts (matches app/composables/usePaperAccounts.ts). */
export interface PaperAccountSummary {
  accountId: string
  currency: string
  mode: string
  initialBalance: number
  /** Soft-removed: kept in history, skipped by the runtime + switcher (§61.17 Phase B). */
  archived: boolean
  createdAt: string | null
  updatedAt: string
}

/**
 * List the caller's paper accounts: every `paper_accounts` row they own, plus
 * any account id only seen in their positions (an executor-created book with no
 * seed row yet). Tenancy keeps this per owner — one hub account never lists
 * another's accounts.
 */
export async function listPaperAccounts(ownerId: string): Promise<PaperAccountSummary[]> {
  if (!ownerId) return []
  const [Position, Account] = await Promise.all([
    engineModel('position.mjs', 'Position'),
    engineModel('account.mjs', 'PaperAccount')
  ])
  if (!Position) return []

  const ids = new Set<string>()
  const seeds = new Map<string, { currency?: string; mode?: string; initialBalance?: number; archived?: boolean; createdAt?: Date }>()
  try {
    const rows = Account ? await Account.find({ ownerId }).lean() : []
    for (const r of rows as Array<Record<string, unknown>>) {
      const id = String(r.accountId ?? '')
      if (!id) continue
      ids.add(id)
      seeds.set(id, {
        currency: r.currency == null ? undefined : String(r.currency),
        mode: r.mode == null ? undefined : String(r.mode),
        initialBalance: typeof r.initialBalance === 'number' ? r.initialBalance : undefined,
        archived: r.archived === true,
        createdAt: r.createdAt instanceof Date ? r.createdAt : undefined
      })
    }
  } catch { /* seed read is best-effort */ }

  try {
    const seen = await Position.distinct('account', { ownerId })
    for (const a of seen as unknown[]) {
      const id = String(a ?? '')
      if (id) ids.add(id)
    }
  } catch { /* position book is best-effort */ }

  return [...ids].sort().map((accountId) => {
    const seed = seeds.get(accountId)
    return {
      accountId,
      currency: seed?.currency ?? 'USDT',
      mode: seed?.mode ?? 'LIVE_PAPER',
      initialBalance: seed?.initialBalance ?? Number(process.env.RISK_EQUITY) ?? 0,
      archived: seed?.archived ?? false,
      createdAt: seed?.createdAt instanceof Date ? seed.createdAt.toISOString() : null,
      updatedAt: new Date().toISOString()
    }
  })
}

export async function paperAccount(args: PaperAccountArgs): Promise<LiveAccount | null> {
  const { ownerId, account, quoteFor = () => null, model, now = Date.now() } = args
  if (!ownerId) return null

  const [Position, Account, sim] = await Promise.all([
    engineModel('position.mjs', 'Position'),
    engineModel('account.mjs', 'PaperAccount'),
    simulationAccount()
  ])
  if (!Position || !sim) return null

  try {
    const wanted = typeof account === 'string' && account && account !== AUTO_ACCOUNT
      ? account
      : await resolveAccount(Account, Position, ownerId)

    const [seed, positions] = Account
      ? await Promise.all([
          Account.findOne({ ownerId, accountId: wanted }).lean(),
          Position.find({ ownerId, account: wanted }).sort({ entryTime: -1 }).limit(5000).lean()
        ])
      : [null, await Position.find({ ownerId, account: wanted }).sort({ entryTime: -1 }).limit(5000).lean()]

    const fallback = Number(process.env.RISK_EQUITY)
    const base = Number(seed?.initialBalance ?? fallback) > 0
      ? Number(seed?.initialBalance ?? fallback)
      : 10000

    const view = sim.accountProjection({ accountId: wanted, base, positions, quoteFor, model, now })
    return {
      equity: view.equity,
      notional: view.notional,
      marginUsed: view.marginUsed,
      freeMargin: view.availableBalance,
      utilizationPct: view.utilizationPct,
      unrealized: view.unrealized,
      maintenance: view.maintenance,
      liquidated: view.liquidated,
      openPositions: view.openPositions,
      accountId: wanted,
      mode: view.mode as 'LIVE_PAPER' | 'REPLAY',
      currency: view.currency,
      initialBalance: view.initialBalance,
      balance: view.balance,
      realizedPnl: view.realizedPnl,
      availableBalance: view.availableBalance,
      dailyPnl: view.dailyPnl,
      maxDrawdown: view.maxDrawdown,
      maxDrawdownPct: view.maxDrawdownPct,
      drawdownBasis: view.drawdownBasis as 'realized',
      createdAt: seed?.createdAt instanceof Date ? seed.createdAt.toISOString() : null,
      updatedAt: view.updatedAt
    } satisfies LiveAccount
  } catch {
    return null
  }
}

// =============================================================================
//  Account CRUD (roadmap §61.17 Phase B — "account CRUD/switching safely").
//
//  Owner-scoped: every mutation resolves the model, then filters by `ownerId` so
//  one hub user can never create, rename, archive or delete another's book (the
//  §61.18 "account changes re-check ownership at execution time" rule). The
//  `paper_accounts` row is the durable SPEC; positions/orders/fills are the
//  book. A rename or delete that would orphan book rows is refused — archive is
//  the safe, reversible alternative.
// =============================================================================

const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{2,64}$/
const CURRENCY_RE = /^[A-Z0-9]{2,12}$/

/** Result shape the routes map to HTTP (§61.18: reject foreign ids, never 500). */
export interface PaperAccountMutation {
  ok: boolean
  /** i18n key (statusMessage) the route also uses as the HTTP status selector. */
  code?: string
  account?: PaperAccountSummary
}

/** HTTP status per mutation code — the route throws it via createError(). */
export const ACCOUNT_ERROR_STATUS: Record<string, number> = {
  'accounts.errUnauthorized': 401,
  'accounts.errInvalidId': 400,
  'accounts.errInvalidCurrency': 400,
  'accounts.errInvalidBalance': 400,
  'accounts.errNoChanges': 400,
  'accounts.errExists': 409,
  'accounts.errInUse': 409,
  'accounts.errNotFound': 404,
  'accounts.errMongoDown': 503
}

/** Summarize one seed row the same way listPaperAccounts() does. */
function summarize(row: any): PaperAccountSummary {
  return {
    accountId: String(row?.accountId ?? ''),
    currency: String(row?.currency ?? 'USDT'),
    mode: String(row?.mode ?? 'LIVE_PAPER'),
    initialBalance: typeof row?.initialBalance === 'number' ? row.initialBalance : Number(process.env.RISK_EQUITY) ?? 0,
    archived: row?.archived === true,
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date().toISOString()
  }
}

/**
 * Models the CRUD path touches. Injectable so the guards can be unit-tested
 * without Mongo (mirrors the `model?` seam of paperAccount()).
 */
export interface AccountCrudModels {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Account?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Position?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PaperOrder?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PaperFill?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RiskState?: any
  /** Test seam for the outbox emit (§61.17 Phase C) — keeps unit tests off Mongo. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit?: (input: any) => Promise<unknown>
}

async function resolveCrudAccount(injected?: AccountCrudModels): Promise<any> {
  if (injected?.Account) return injected.Account
  return engineModel('account.mjs', 'PaperAccount')
}

/**
 * Count the book rows (positions/orders/fills/risk state) an account still owns
 * for THIS owner. >0 means renaming or deleting would orphan history.
 */
async function bookSize(models: AccountCrudModels | undefined, ownerId: string, accountId: string): Promise<number> {
  const [Position, PaperOrder, PaperFill, RiskState] = await Promise.all([
    models?.Position ?? engineModel('position.mjs', 'Position'),
    models?.PaperOrder ?? engineModel('order.mjs', 'PaperOrder'),
    models?.PaperFill ?? engineModel('fill.mjs', 'PaperFill'),
    models?.RiskState ?? engineModel('riskState.mjs', 'RiskState')
  ])
  const probes: Promise<number>[] = []
  if (Position) probes.push(Position.countDocuments({ ownerId, account: accountId }).catch(() => 0))
  if (PaperOrder) probes.push(PaperOrder.countDocuments({ ownerId, accountId }).catch(() => 0))
  if (PaperFill) probes.push(PaperFill.countDocuments({ ownerId, accountId }).catch(() => 0))
  if (RiskState) probes.push(RiskState.countDocuments({ ownerId, account: accountId }).catch(() => 0))
  const counts = await Promise.all(probes)
  return counts.reduce((n, c) => n + (Number(c) || 0), 0)
}

/** Default seeding balance when neither the caller nor the env provides one. */
function defaultBalance(initialBalance?: number): number {
  if (typeof initialBalance === 'number' && Number.isFinite(initialBalance) && initialBalance > 0) return initialBalance
  const env = Number(process.env.RISK_EQUITY)
  return Number.isFinite(env) && env > 0 ? env : 10000
}

/**
 * Publish an account lifecycle event to the trading outbox (§61.17 Phase C) so
 * the other trading views reconcile without a hard refresh. Best-effort: the
 * mutation has already committed, so an outbox miss must never surface as an
 * error to the caller.
 */
async function emitAccountEvent(
  type: string,
  ownerId: string,
  accountId: string,
  data: unknown = null,
  models?: AccountCrudModels
): Promise<void> {
  try {
    if (models?.emit) {
      await models.emit({ type, entityId: accountId, ownerId, accountId, at: Date.now(), data })
      return
    }
    const ws = await workspaceStore()
    await ws.emitTradingEvent({ type, entityId: accountId, ownerId, accountId, at: Date.now(), data })
  } catch {
    /* outbox is best-effort */
  }
}

/** POST /api/v1/paper/accounts — create a new, empty paper book for the caller. */
export async function createPaperAccount(args: {
  ownerId: string
  accountId?: string
  currency?: string
  initialBalance?: number
  models?: AccountCrudModels
}): Promise<PaperAccountMutation> {
  const { ownerId } = args
  if (!ownerId) return { ok: false, code: 'accounts.errUnauthorized' }

  const accountId = String(args.accountId ?? '').trim()
  if (!ACCOUNT_ID_RE.test(accountId)) return { ok: false, code: 'accounts.errInvalidId' }
  const currency = String(args.currency ?? 'USDT').trim().toUpperCase()
  if (!CURRENCY_RE.test(currency)) return { ok: false, code: 'accounts.errInvalidCurrency' }
  if (args.initialBalance !== undefined && !(Number.isFinite(args.initialBalance) && args.initialBalance > 0)) {
    return { ok: false, code: 'accounts.errInvalidBalance' }
  }

  const Account = await resolveCrudAccount(args.models)
  if (!Account) return { ok: false, code: 'accounts.errMongoDown' }

  try {
    const existing = await Account.findOne({ ownerId, accountId }).lean()
    if (existing) return { ok: false, code: 'accounts.errExists' }
    const doc = await Account.create({
      ownerId,
      accountId,
      currency,
      mode: 'LIVE_PAPER',
      initialBalance: defaultBalance(args.initialBalance),
      archived: false
    })
    await emitAccountEvent('account.created', ownerId, accountId, { currency }, args.models)
    return { ok: true, account: summarize(doc) }
  } catch (e: any) {
    // Unique race -> treat as "already exists" (never leak a raw 11000).
    if (e?.code === 11000) return { ok: false, code: 'accounts.errExists' }
    return { ok: false, code: 'accounts.errMongoDown' }
  }
}

/**
 * PATCH /api/v1/paper/accounts/:id — rename, archive/un-archive, or adjust the
 * seed (currency / initialBalance). Renaming is refused once the account owns
 * book rows (it would orphan positions/orders/fills) — archive instead.
 */
export async function updatePaperAccount(args: {
  ownerId: string
  accountId: string
  patch: { accountId?: string; archived?: boolean; currency?: string; initialBalance?: number }
  models?: AccountCrudModels
}): Promise<PaperAccountMutation> {
  const { ownerId } = args
  const accountId = String(args.accountId ?? '').trim()
  if (!ownerId) return { ok: false, code: 'accounts.errUnauthorized' }
  if (!ACCOUNT_ID_RE.test(accountId)) return { ok: false, code: 'accounts.errInvalidId' }

  const Account = await resolveCrudAccount(args.models)
  if (!Account) return { ok: false, code: 'accounts.errMongoDown' }

  const set: Record<string, unknown> = {}
  const patch = args.patch ?? {}

  const renameTo = patch.accountId === undefined ? undefined : String(patch.accountId).trim()
  if (renameTo !== undefined) {
    if (!ACCOUNT_ID_RE.test(renameTo)) return { ok: false, code: 'accounts.errInvalidId' }
    if (renameTo !== accountId) {
      const size = await bookSize(args.models, ownerId, accountId)
      if (size > 0) return { ok: false, code: 'accounts.errInUse' }
      const clash = await Account.findOne({ ownerId, accountId: renameTo }).lean().catch(() => null)
      if (clash) return { ok: false, code: 'accounts.errExists' }
      set.accountId = renameTo
    }
  }
  if (patch.archived !== undefined) set.archived = patch.archived === true
  if (patch.currency !== undefined) {
    const currency = String(patch.currency).trim().toUpperCase()
    if (!CURRENCY_RE.test(currency)) return { ok: false, code: 'accounts.errInvalidCurrency' }
    set.currency = currency
  }
  if (patch.initialBalance !== undefined) {
    if (!(Number.isFinite(patch.initialBalance) && patch.initialBalance > 0)) return { ok: false, code: 'accounts.errInvalidBalance' }
    set.initialBalance = patch.initialBalance
  }
  if (!Object.keys(set).length) return { ok: false, code: 'accounts.errNoChanges' }

  try {
    // Upsert so an account only ever seen in positions (created by the executor
    // with no seed row) can still be archived. Only the accounted-for fields are
    // written; a fresh row inherits the derived balance.
    const res = await Account.findOneAndUpdate(
      { ownerId, accountId },
      { $set: set, $setOnInsert: { currency: 'USDT', mode: 'LIVE_PAPER', initialBalance: defaultBalance(undefined) } },
      { new: true, upsert: true, lean: true }
    )
    const account = summarize(res)
    // One event per intent (rename and archive can both ride the same PATCH).
    if (set.accountId !== undefined) await emitAccountEvent('account.renamed', ownerId, account.accountId, { from: accountId, to: account.accountId }, args.models)
    if (set.archived === true) await emitAccountEvent('account.archived', ownerId, account.accountId, null, args.models)
    if (set.archived === false) await emitAccountEvent('account.unarchived', ownerId, account.accountId, null, args.models)
    return { ok: true, account }
  } catch (e: any) {
    if (e?.code === 11000) return { ok: false, code: 'accounts.errExists' }
    return { ok: false, code: 'accounts.errMongoDown' }
  }
}

/**
 * DELETE /api/v1/paper/accounts/:id — remove an account that owns no book rows
 * (positions/orders/fills/risk state). Anything with history must be archived
 * instead; this keeps the delete honest and reversible.
 */
export async function deletePaperAccount(args: {
  ownerId: string
  accountId: string
  models?: AccountCrudModels
}): Promise<PaperAccountMutation> {
  const { ownerId } = args
  const accountId = String(args.accountId ?? '').trim()
  if (!ownerId) return { ok: false, code: 'accounts.errUnauthorized' }

  const Account = await resolveCrudAccount(args.models)
  if (!Account) return { ok: false, code: 'accounts.errMongoDown' }

  const size = await bookSize(args.models, ownerId, accountId)
  if (size > 0) return { ok: false, code: 'accounts.errInUse' }

  try {
    const res = await Account.deleteOne({ ownerId, accountId })
    if (!(res.deletedCount > 0)) return { ok: false, code: 'accounts.errNotFound' }
    await emitAccountEvent('account.deleted', ownerId, accountId, null, args.models)
    return { ok: true }
  } catch {
    return { ok: false, code: 'accounts.errMongoDown' }
  }
}
