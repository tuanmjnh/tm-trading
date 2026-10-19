import { reactive, computed } from 'vue'

// =============================================================================
//  useTradingWorkspace — ONE workspace context for the trading screens
//  (roadmap §61.17 Phase C "shared workspace invalidation", §61.5).
//
//  The server appends every trading fact (account / order / fill / position /
//  signal) to the `trading_domain_events` outbox. This composable is the client
//  half: it DRAINS that outbox on a short, visibility-aware poll and bumps a
//  per-view version counter. A screen watches ONLY the views it renders and
//  refetches when one is bumped — so "one manual paper order changes the same
//  state everywhere without a manual hard refresh".
//
//  Scoping: the counters are module-level (one workspace per browser session),
//  but an event only bumps when it is RELEVANT to the selected account
//  (`useAccountScope`) — an event for another book never reloads this view.
//  Owner scoping is the server's job (`pendingForOwner`); the client can never
//  see another user's events.
//
//  Budget: the poll pauses while the tab is hidden (useVisibleInterval) and the
//  batch is acked immediately, so an idle visible tab costs one small request
//  per interval and a background tab costs none.
// =============================================================================

export const WORKSPACE_VIEWS = ['accounts', 'orders', 'positions', 'paper', 'signals'] as const
export type WorkspaceView = typeof WORKSPACE_VIEWS[number]

export interface TradingWorkspaceEvent {
  _id: string
  type: string
  entityRef?: { kind?: string, id?: string }
  ownerId?: string
  accountId?: string | null
  occurredAt?: string | Date
  invalidates?: string[]
  data?: unknown
}

interface WorkspaceEventsResponse {
  success: boolean
  data: { events: TradingWorkspaceEvent[], views: string[], count: number }
}

// One shared counter per view, across every screen (a single browser workspace).
const counters = reactive<Record<string, number>>(
  Object.fromEntries(WORKSPACE_VIEWS.map((v) => [v, 0]))
)

/** Bump every view an event invalidates (used by the poll and by local mutations). */
export function bumpWorkspaceViews(views: string[]): void {
  for (const v of views) counters[v] = (counters[v] ?? 0) + 1
}

const POLL_MS = 5000

export function useTradingWorkspace() {
  const { account } = useAccountScope()
  const { isAuthenticated } = useAuth()

  let inFlight = false

  // Only the per-book views are account-scoped. The accounts list is the set of
  // ALL the owner's books, the paper overview is account-level and a signal is
  // not tied to a book — those always refresh, whatever the terminal is scoped
  // to. An order/position/fill for another book never reloads this view.
  const SCOPED_VIEWS = new Set(['orders', 'positions'])

  function viewsToBump(e: TradingWorkspaceEvent): string[] {
    const views = e.invalidates ?? []
    const scope = account.value
    if (!e.accountId || !scope) return views
    return views.filter((v) => !SCOPED_VIEWS.has(v) || e.accountId === scope)
  }

  /** Drain the outbox once: bump relevant views, then ack the whole batch. */
  async function poll(): Promise<void> {
    if (inFlight || !isAuthenticated.value) return
    inFlight = true
    try {
      const res = await $fetch<WorkspaceEventsResponse>('/api/v1/workspace/events', { query: { limit: 200 } })
      const events = res?.data?.events ?? []
      if (!events.length) return
      const ack: string[] = []
      for (const e of events) {
        ack.push(e._id)
        bumpWorkspaceViews(viewsToBump(e))
      }
      if (ack.length) {
        await $fetch('/api/v1/workspace/events/ack', { method: 'POST', body: { ids: ack } }).catch(() => {})
      }
    } catch {
      /* fail-soft: the outbox is durable, the next tick retries */
    } finally {
      inFlight = false
    }
  }

  // A reactive counter a screen can watch: `watch(version('orders'), refresh)`.
  const version = (view: WorkspaceView) => computed(() => counters[view] ?? 0)

  useVisibleInterval(() => { void poll() }, POLL_MS, { immediate: true, canRun: () => isAuthenticated.value })

  return { version, refresh: poll }
}
