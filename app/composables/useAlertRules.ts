import type {
  AlertRule,
  AlertRuleInput,
  AlertRuleListResponse,
  AlertRuleResponse
} from '~~/types/alertRules'

// =============================================================================
//  useAlertRules — alert rule definitions client (roadmap §58.5 /alerts).
//
//  Wraps /api/v1/alert-rules. Reads are fail-soft (empty list + mongo:'down' on a
//  store blip, the page shows an empty/down state, never a stack trace). Writes
//  surface failure to the caller so the editor can report it.
//
//  §58.6 boundary: this client only writes rule DEFINITIONS. Delivery/history is
//  a separate capability (alerts/history, inbox) backed by the notify ledger.
// =============================================================================

export interface AlertRuleListResult {
  items: AlertRule[]
  total: number
  mongo: 'up' | 'down'
}

export const useAlertRules = () => {
  async function list(options: { enabled?: boolean; limit?: number } = {}): Promise<AlertRuleListResult> {
    try {
      const res = await $fetch<AlertRuleListResponse>('/api/v1/alert-rules', {
        params: { limit: options.limit ?? 200, enabled: options.enabled }
      })
      return {
        items: res.data ?? [],
        total: res.meta?.total ?? res.data?.length ?? 0,
        mongo: res.meta?.mongo ?? 'down'
      }
    } catch {
      return { items: [], total: 0, mongo: 'down' }
    }
  }

  async function create(body: AlertRuleInput): Promise<AlertRule> {
    const res = await $fetch<AlertRuleResponse & { error?: string }>('/api/v1/alert-rules', {
      method: 'POST',
      body
    })
    if (!res.success || !res.data) throw new Error(res.error || 'create-failed')
    return res.data
  }

  async function update(id: string, body: Partial<AlertRuleInput>): Promise<AlertRule> {
    const res = await $fetch<AlertRuleResponse & { error?: string }>(
      `/api/v1/alert-rules/${encodeURIComponent(id)}`,
      { method: 'PATCH', body }
    )
    if (!res.success || !res.data) throw new Error(res.error || 'update-failed')
    return res.data
  }

  async function remove(id: string): Promise<void> {
    const res = await $fetch<{ success: boolean; error?: string }>(
      `/api/v1/alert-rules/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    if (!res.success) throw new Error(res.error || 'delete-failed')
  }

  return { list, create, update, remove }
}
