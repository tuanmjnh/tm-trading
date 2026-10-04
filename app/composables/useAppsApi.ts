import type { App } from '~~/types'

export interface AppsApiResponse {
  success: boolean
  isConfigured: boolean
  message: string
  data: App[]
  nextCursor?: string | null
}

export interface AppsListParams {
  cursor?: string | null
  limit?: number
  q?: string
  active?: 'true' | 'false'
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface CreateAppPayload {
  id: string
  name: string
  description?: string
  allowedOrigins?: string[]
  isActive?: boolean
  configs?: Record<string, string>
}

interface MutationResponse {
  success: boolean
  message?: string
  data: App
}

export interface UpdateAppPayload {
  name?: string
  description?: string
  allowedOrigins?: string[]
  isActive?: boolean
  isPinned?: boolean
  configs?: Record<string, string>
}

export interface AppDetailResponse {
  success: boolean
  data: App & { configs: Record<string, string> }
}

export const useAppsApi = () => {
  const { hubFetch } = useHub()

  const getApps = async (params: AppsListParams = {}): Promise<AppsApiResponse> => {
    return await hubFetch<AppsApiResponse>('/api/v1/apps', {
      query: {
        limit: params.limit,
        cursor: params.cursor ?? undefined,
        q: params.q || undefined,
        active: params.active,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder
      }
    })
  }

  const getApp = async (id: string): Promise<AppDetailResponse> => {
    return await hubFetch<AppDetailResponse>(`/api/v1/apps/${encodeURIComponent(id)}`)
  }

  const createApp = async (payload: CreateAppPayload): Promise<MutationResponse> => {
    return await hubFetch<MutationResponse>('/api/v1/apps', {
      method: 'POST',
      body: payload
    })
  }

  const updateApp = async (id: string, payload: UpdateAppPayload): Promise<MutationResponse> => {
    return await hubFetch<MutationResponse>(`/api/v1/apps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload
    })
  }

  const deleteApps = async (ids: string | string[]): Promise<{ success: boolean, deletedCount: number, message?: string }> => {
    const idParam = Array.isArray(ids) ? ids.join(',') : ids
    return await hubFetch<{ success: boolean, deletedCount: number, message?: string }>(`/api/v1/apps?id=${encodeURIComponent(idParam)}`, {
      method: 'DELETE'
    })
  }

  const reorderApps = async (orderedIds: string[]): Promise<{ success: boolean, message?: string }> => {
    return await hubFetch<{ success: boolean, message?: string }>('/api/v1/apps/reorder', {
      method: 'POST',
      body: { ids: orderedIds }
    })
  }

  return {
    getApps,
    getApp,
    createApp,
    updateApp,
    deleteApps,
    reorderApps
  }
}
