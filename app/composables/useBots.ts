import type { BotInstance, BotProfile } from '~~/types/bots'

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

  return { profiles, profile, instances, instance }
}
