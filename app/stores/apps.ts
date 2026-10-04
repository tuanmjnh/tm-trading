import { defineStore } from 'pinia'
import type { App } from '~~/types'
import { getErrorMessage } from '~/shared/utils/errors'

const PAGE_SIZE = 20

const mapAppItem = (item: any): App => ({
  id: item.id,
  name: item.name,
  description: item.description || '',
  secretKey: item.secret_key || item.secretKey || '',
  allowedOrigins: item.allowed_origins || item.allowedOrigins || [],
  isActive: item.is_active ?? item.isActive ?? true,
  isPinned: item.is_pinned ?? item.isPinned ?? false,
  isSystem: item.is_system ?? item.isSystem ?? false,
  sort: item.sort ?? 0,
  createdAt: item.created_at || item.createdAt || '',
  updatedAt: item.updated_at || item.updatedAt || ''
})

export const useAppsStore = defineStore('apps', () => {
  const appsApi = useAppsApi()

  const apps = ref<App[]>([])
  const activeAppId = ref<string | null>(null)
  const isLoading = ref(false)
  const isConfigured = ref(true)
  const errorMessage = ref('')
  const nextCursor = ref<string | null>(null)
  const hasMore = ref(false)
  const searchQuery = ref('')
  const statusFilter = ref<'all' | 'active' | 'inactive'>('all')

  const activeApp = computed(() => {
    if (!activeAppId.value) return apps.value[0] || null
    return apps.value.find(a => a.id === activeAppId.value) || apps.value[0] || null
  })

  const totalApps = computed(() => apps.value.length)
  const activeAppsCount = computed(() => apps.value.filter(a => a.isActive).length)

  const buildListParams = () => ({
    limit: PAGE_SIZE,
    q: searchQuery.value.trim() || undefined,
    active: statusFilter.value === 'all'
      ? undefined
      : (statusFilter.value === 'active' ? 'true' as const : 'false' as const),
    sortBy: 'sort' as const,
    sortOrder: 'asc' as const
  })

  const setFilters = (opts: { q?: string, status?: 'all' | 'active' | 'inactive' }) => {
    if (opts.q !== undefined) searchQuery.value = opts.q
    if (opts.status !== undefined) statusFilter.value = opts.status
  }

  const fetchApps = async (force = false) => {
    if (isLoading.value) return
    if (!force && apps.value.length > 0) return

    isLoading.value = true
    errorMessage.value = ''

    try {
      const res = await appsApi.getApps({ ...buildListParams(), cursor: null })
      isConfigured.value = res.isConfigured
      if (res.success && Array.isArray(res.data)) {
        apps.value = res.data.map(mapAppItem)
        nextCursor.value = res.nextCursor || null
        hasMore.value = !!res.nextCursor
        if (!activeAppId.value && apps.value.length > 0 && apps.value[0]) {
          activeAppId.value = apps.value[0].id
        }
      } else {
        errorMessage.value = res.message || ''
      }
    } catch (err: any) {
      errorMessage.value = getErrorMessage(err, key => key)
      if (err.statusCode === 503 || /supabase/i.test(String(errorMessage.value))) {
        isConfigured.value = false
      }
    } finally {
      isLoading.value = false
    }
  }

  const loadMoreApps = async () => {
    if (isLoading.value || !hasMore.value) return

    isLoading.value = true
    try {
      const res = await appsApi.getApps({ ...buildListParams(), cursor: nextCursor.value })
      if (res.success && Array.isArray(res.data)) {
        const existing = new Set(apps.value.map(a => a.id))
        const mapped = res.data.map(mapAppItem).filter(a => !existing.has(a.id))
        apps.value = [...apps.value, ...mapped]
        nextCursor.value = res.nextCursor || null
        hasMore.value = !!res.nextCursor
      } else {
        errorMessage.value = res.message || ''
        hasMore.value = false
      }
    } catch (err: any) {
      errorMessage.value = getErrorMessage(err, key => key)
      hasMore.value = false
    } finally {
      isLoading.value = false
    }
  }

  const createApp = async (payload: Parameters<typeof appsApi.createApp>[0]) => {
    const res = await appsApi.createApp(payload)
    if (res.success && res.data) {
      const newApp = mapAppItem(res.data)
      apps.value.unshift(newApp)
      activeAppId.value = newApp.id
      return newApp
    }
    throw new Error(res.message || 'error.unexpected')
  }

  const deleteApps = async (ids: string | string[]) => {
    const idList = Array.isArray(ids) ? ids : [ids]
    const res = await appsApi.deleteApps(idList)
    if (res.success) {
      apps.value = apps.value.filter(app => !idList.includes(app.id))
      if (activeAppId.value && idList.includes(activeAppId.value)) {
        activeAppId.value = apps.value[0]?.id || null
      }
      return res.deletedCount
    }
    throw new Error(res.message || 'error.unexpected')
  }

  const updateApp = async (id: string, payload: Parameters<typeof appsApi.updateApp>[1]) => {
    const res = await appsApi.updateApp(id, payload)
    if (res.success && res.data) {
      const idx = apps.value.findIndex(a => a.id === id)
      if (idx !== -1 && apps.value[idx]) {
        apps.value[idx] = {
          ...apps.value[idx],
          ...mapAppItem(res.data)
        }
      }
      return res.data
    }
    throw new Error(res.message || 'error.unexpected')
  }

  const toggleStatus = async (id: string, nextStatus: boolean) => {
    return await updateApp(id, { isActive: nextStatus })
  }

  const togglePin = async (id: string, nextPin: boolean) => {
    return await updateApp(id, { isPinned: nextPin })
  }

  // Reorder apps by updating sort values
  const reorderApps = async (orderedIds: string[]) => {
    // Update sort values locally first for immediate UI feedback
    const updates = orderedIds.map((id, index) => ({ id, sort: index }))
    for (const { id, sort } of updates) {
      const idx = apps.value.findIndex(a => a.id === id)
      if (idx !== -1 && apps.value[idx]) {
        apps.value[idx].sort = sort
      }
    }

    // Then sync with server
    const res = await appsApi.reorderApps(orderedIds)
    if (!res.success) {
      // Revert on failure - refetch
      await fetchApps(true)
      throw new Error(res.message || 'error.unexpected')
    }
    return res
  }

  const setActiveApp = (id: string) => {
    activeAppId.value = id
  }

  return {
    apps,
    activeAppId,
    isLoading,
    isConfigured,
    errorMessage,
    nextCursor,
    hasMore,
    searchQuery,
    statusFilter,
    activeApp,
    totalApps,
    activeAppsCount,
    setFilters,
    fetchApps,
    loadMoreApps,
    createApp,
    updateApp,
    toggleStatus,
    togglePin,
    deleteApps,
    reorderApps,
    setActiveApp
  }
})
