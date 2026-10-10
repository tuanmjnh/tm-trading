export interface ConfigMeta {
  key: string
  category: string
  isSecret: boolean
  isPublic: boolean
  description?: string
  updatedAt?: string
}

export interface ConfigItem extends ConfigMeta {
  value: string
}

export const useAdminConfigs = () => {
  const categoryFilter = ref('all')

  const list = useAdminList<ConfigItem>({
    limit: 50,
    fetchPage: async ({ appId, cursor, limit }) => {
      const res = await adminFetch<{ success: boolean, data: Record<string, unknown>, meta?: ConfigMeta[], nextCursor: string | null }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/configs`,
        { query: { cursor: cursor || undefined, limit } }
      )
      const metaMap = new Map((res.meta || []).map(m => [m.key, m]))
      const page: ConfigItem[] = Object.entries(res.data || {}).map(([key, value]) => {
        const meta = metaMap.get(key)
        return {
          key,
          value: String(value ?? ''),
          category: meta?.category || 'general',
          isSecret: meta?.isSecret || false,
          isPublic: meta?.isPublic ?? true,
          description: meta?.description,
          updatedAt: meta?.updatedAt
        }
      })
      return { items: page, nextCursor: res.nextCursor }
    }
  })

  const filtered = computed(() => {
    if (categoryFilter.value === 'all') return list.items.value
    return list.items.value.filter(i => i.category === categoryFilter.value)
  })

  const categories = computed(() => {
    const set = new Set(list.items.value.map(i => i.category))
    return ['all', ...Array.from(set)]
  })

  const getCategory = (key: string) => {
    if (key.startsWith('AI_')) return 'ai'
    if (key.startsWith('CLOUDINARY_')) return 'cloudinary'
    if (key.startsWith('FIREBASE_')) return 'firebase'
    if (key.startsWith('WEB_PUSH_')) return 'web_push'
    if (key.startsWith('MONGODB_') || key.startsWith('SUPABASE_')) return 'database'
    return 'general'
  }

  const isSecretKey = (key: string) => {
    return key.includes('SECRET') || key.includes('PRIVATE') || key.includes('API_KEY')
  }

  const applyLocalConfigs = (configs: Record<string, string>) => {
    const now = new Date().toISOString()
    for (const [key, value] of Object.entries(configs)) {
      const existing = list.items.value.find(i => i.key === key)
      if (existing) {
        existing.value = value
        existing.updatedAt = now
        continue
      }
      const secret = isSecretKey(key)
      list.items.value = [
        ...list.items.value,
        { key, value, category: getCategory(key), isSecret: secret, isPublic: !secret, updatedAt: now }
      ].sort((a, b) => a.key.localeCompare(b.key))
    }
  }

  const saveConfigs = async (configs: Record<string, string>, appId?: string) => {
    const targetApp = appId || list.targetAppId.value
    list.loading.value = true
    try {
      await adminFetch(`/api/v1/apps/${encodeURIComponent(targetApp)}/configs`, {
        method: 'PUT',
        body: configs
      })
      if (targetApp === list.targetAppId.value) applyLocalConfigs(configs)
    } finally {
      list.loading.value = false
    }
  }

  const saveSingleConfig = async (
    key: string,
    value: unknown,
    options?: { category?: string; isSecret?: boolean; isPublic?: boolean; description?: string },
    appId?: string
  ) => {
    const targetApp = appId || list.targetAppId.value
    list.loading.value = true
    try {
      await adminFetch(`/api/v1/apps/${encodeURIComponent(targetApp)}/configs/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: {
          value,
          category: options?.category,
          isSecret: options?.isSecret,
          isPublic: options?.isPublic,
          description: options?.description
        }
      })
      await list.refresh()
    } finally {
      list.loading.value = false
    }
  }

  const deleteConfigs = async (keys: string[]) => {
    list.loading.value = true
    try {
      await adminFetch(`/api/v1/apps/${encodeURIComponent(list.targetAppId.value)}/configs`, {
        method: 'DELETE',
        body: { keys }
      })
      list.items.value = list.items.value.filter(i => !keys.includes(i.key))
    } finally {
      list.loading.value = false
    }
  }

  return {
    items: list.items,
    filtered,
    categories,
    categoryFilter,
    nextCursor: list.nextCursor,
    hasMore: list.hasMore,
    loading: list.loading,
    initialLoading: list.initialLoading,
    targetAppId: list.targetAppId,
    load: list.load,
    refresh: list.refresh,
    loadMore: list.loadMore,
    setApp: list.setApp,
    saveConfigs,
    saveSingleConfig,
    deleteConfigs
  }
}
