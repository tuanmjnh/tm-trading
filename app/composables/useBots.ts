import type { BotInstance, BotProfile } from '#shared/types/bots'

// =============================================================================
//  useBots — read-only bot contracts (§57.4 G/H, §58.6, roadmap §58.9 Slice 2).
//  Bot Profile != Bot Instance: a profile is reusable config pointing at an
//  immutable strategy version; an instance is one concrete session. The
//  dashboard only reads; the supervisor owns lifecycle writes. Fail-soft.
// =============================================================================

export interface ListBotOptions {
  limit?: number
  status?: string
  mode?: string
  q?: string
  state?: string
  botProfileId?: string
}

export const useBots = () => {
  async function profiles(options: ListBotOptions = {}): Promise<BotProfile[]> {
    try {
      const res = await $fetch<{ success: boolean; data: BotProfile[] }>('/api/v1/bots/profiles', {
        params: {
          limit: options.limit,
          status: options.status || undefined,
          mode: options.mode || undefined,
          q: options.q || undefined
        }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function profile(id: string): Promise<BotProfile | null> {
    try {
      const res = await $fetch<{ success: boolean; data: BotProfile | null }>(
        `/api/v1/bots/profiles/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  async function instances(options: ListBotOptions = {}): Promise<BotInstance[]> {
    try {
      const res = await $fetch<{ success: boolean; data: BotInstance[] }>('/api/v1/bots/instances', {
        params: {
          limit: options.limit,
          state: options.state || undefined,
          botProfileId: options.botProfileId || undefined,
          mode: options.mode || undefined
        }
      })
      return res.data ?? []
    } catch {
      return []
    }
  }

  async function instance(id: string): Promise<BotInstance | null> {
    try {
      const res = await $fetch<{ success: boolean; data: BotInstance | null }>(
        `/api/v1/bots/instances/${encodeURIComponent(id)}`
      )
      return res.data ?? null
    } catch {
      return null
    }
  }

  /** Operational profile edits (rename / enable / status) — params change via
   *  a NEW immutable strategy version (launch flow), never in place. */
  async function updateProfile(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await $fetch<{ success: boolean }>(`/api/v1/bots/profiles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body
      })
      return res.success
    } catch {
      return false
    }
  }

  async function deleteProfile(id: string): Promise<boolean> {
    try {
      const res = await $fetch<{ success: boolean }>(`/api/v1/bots/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
      return res.success
    } catch {
      return false
    }
  }

  /** Soft-hide a TERMINAL instance — the run data stays (D1), list drops it. */
  async function archiveInstance(id: string, archived = true): Promise<boolean> {
    try {
      const res = await $fetch<{ success: boolean }>(`/api/v1/bots/instances/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { archived }
      })
      return res.success
    } catch {
      return false
    }
  }

  /** Enqueue a supervisor command (start/pause/resume/stop) for an instance. */
  async function enqueueCommand(instanceId: string, type: 'start' | 'pause' | 'resume' | 'stop'): Promise<{ success: boolean; data?: any; error?: string; code?: string }> {
    try {
      const res = await $fetch<{ success: boolean; data?: any; error?: string; code?: string }>(
        `/api/v1/bots/instances/${encodeURIComponent(instanceId)}/commands`,
        {
          method: 'POST',
          body: { type }
        }
      )
      return res
    } catch (e: any) {
      return { success: false, error: e?.data?.message || e?.message, code: e?.data?.code }
    }
  }

  /** Rerun a terminal instance (creates a new instance from the same profile). */
  async function rerunInstance(instanceId: string): Promise<{ success: boolean; data?: any; error?: string; code?: string }> {
    try {
      const res = await $fetch<{ success: boolean; data?: any; error?: string; code?: string }>(
        `/api/v1/bots/instances/${encodeURIComponent(instanceId)}/rerun`,
        { method: 'POST' }
      )
      return res
    } catch (e: any) {
      return { success: false, error: e?.data?.message || e?.message, code: e?.data?.code }
    }
  }

  return { profiles, profile, instances, instance, updateProfile, deleteProfile, archiveInstance, enqueueCommand, rerunInstance }
}
