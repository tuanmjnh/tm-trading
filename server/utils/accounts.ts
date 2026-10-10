import type { AccountItem } from '../../types/accounts'
import { engineModel } from './engineModel'

// =============================================================================
//  Aggregation + merge logic for GET /api/v1/accounts — the data rules live in
//  types/accounts.ts; this module only reads engine collections (D1).
// =============================================================================

export interface AccountsResult {
  items: AccountItem[]
  total: number
  mongo: 'up' | 'down'
}

function toIso(d: unknown): string | null {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString()
  if (d == null) return null
  const t = new Date(d as string | number)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function toAccount(row: any, eq: { equity: number | null; ts: string | null }): AccountItem {
  const lastExit = toIso(row.lastExit)
  const lastEntry = toIso(row.lastEntry)
  return {
    account: String(row._id ?? 'default'),
    sources: Array.isArray(row.sources) ? row.sources.map((s: unknown) => String(s)) : [],
    open: Number(row.open) || 0,
    closed: Number(row.closed) || 0,
    cancelled: Number(row.cancelled) || 0,
    realizedPnlAbs: row.realizedN > 0 ? Number(row.realizedSum) : null,
    lastActivityAt: lastExit && lastEntry ? (lastExit > lastEntry ? lastExit : lastEntry) : (lastExit ?? lastEntry ?? null),
    firstEntryAt: toIso(row.firstEntry),
    latestEquity: eq.equity,
    latestEquityAt: eq.ts
  }
}

export async function listAccounts(): Promise<AccountsResult> {
  const Position = await engineModel('position.mjs', 'Position')
  if (!Position) return { items: [], total: 0, mongo: 'down' }
  const Equity = await engineModel('equity.mjs', 'Equity')

  try {
    const rows = await Position.aggregate([
      {
        $group: {
          _id: '$account',
          sources: { $addToSet: '$source' },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          realizedSum: {
            $sum: { $cond: [{ $and: [{ $eq: ['$status', 'closed'] }, { $ne: ['$pnlAbs', null] }] }, '$pnlAbs', 0] }
          },
          realizedN: {
            $sum: { $cond: [{ $and: [{ $eq: ['$status', 'closed'] }, { $ne: ['$pnlAbs', null] }] }, 1, 0] }
          },
          firstEntry: { $min: '$entryTime' },
          lastEntry: { $max: '$entryTime' },
          lastExit: { $max: '$exitTime' }
        }
      },
      { $sort: { _id: 1 } }
    ])

    // Latest equity snapshot per account — fail-soft when the collection is empty.
    const byAccount = new Map<string, { equity: number | null; ts: string | null }>()
    if (Equity) {
      try {
        const eq = await Equity.aggregate([
          { $sort: { ts: -1 } },
          { $group: { _id: '$account', latest: { $first: '$$ROOT' } } }
        ])
        for (const r of eq) {
          byAccount.set(String(r._id), {
            equity: typeof r.latest?.equity === 'number' ? r.latest.equity : null,
            ts: toIso(r.latest?.ts)
          })
        }
      } catch {
        // equity unreadable -> treat as no snapshots (honest null)
      }
    }

    const items = rows.map((row: any) => toAccount(row, byAccount.get(String(row._id)) ?? { equity: null, ts: null }))
    // Accounts that only exist in `equity` (no positions yet) still belong here.
    for (const [account, eq] of byAccount) {
      if (!items.some(i => i.account === account)) {
        items.push({
          account,
          sources: [],
          open: 0,
          closed: 0,
          cancelled: 0,
          realizedPnlAbs: null,
          lastActivityAt: null,
          firstEntryAt: null,
          latestEquity: eq.equity,
          latestEquityAt: eq.ts
        })
      }
    }
    items.sort((a, b) => a.account.localeCompare(b.account))

    return { items, total: items.length, mongo: 'up' }
  } catch {
    return { items: [], total: 0, mongo: 'down' }
  }
}
