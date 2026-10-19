interface NotificationItem {
  id: string
  unread: boolean
  sender?: {
    name?: string
    avatar?: string | { src: string }
  }
  body: string
  date: string
  priority?: string
  type?: string
}

interface HubNotificationItem {
  id: string
  is_read: boolean
  title?: string
  body: string
  icon?: string
  created_at: string
}

// useNotify() is consumed by ~48 components (most only for the toast helpers).
// The notification FEED lives in `useNotifyFeed()` — shared app-wide through
// useState — while the toast helpers stay in `useNotify()`. The split lets the
// lifecycle run from a client plugin (`plugins/notify.client.ts`, U3) without
// dragging `useToast()` (which `inject()`s) into a plugin scope.
const notifyIcons: Record<string, string> = {
  order: 'i-lucide-shopping-cart',
  inventory: 'i-lucide-package',
  payment: 'i-lucide-credit-card',
  system: 'i-lucide-settings',
  security: 'i-lucide-shield-alert',
  user: 'i-lucide-user',
  default: 'i-lucide-bell'
}

const notifyColors: Record<string, 'neutral' | 'primary' | 'error' | 'success' | 'warning' | 'info'> = {
  low: 'neutral',
  normal: 'primary',
  high: 'error'
}

const getNotifyIcon = (type: string): string => notifyIcons[type] || notifyIcons.default!
const getNotifyColor = (priority: string) =>
  notifyColors[priority] || 'primary'

const PAGE_SIZE = 20

// Collapse concurrent feed resets (the plugin's boot fetch and the auth watcher
// can fire together) into a single hub request. Module-scoped so every
// `useNotifyFeed()` caller shares one in-flight promise.
let notifyInFlight: Promise<NotificationItem[]> | null = null

export const useNotifyFeed = () => {
  const auth = useAuth()
  const { hubFetch, appId } = useHub()

  const notify = useState<NotificationItem[]>('notify:items', () => [])
  const unreadCount = computed(() => notify.value.filter(n => n.unread).length)
  const isLoading = useState<boolean>('notify:loading', () => false)
  const isLoadingMore = useState<boolean>('notify:loadingMore', () => false)
  const nextCursor = useState<string | null>('notify:nextCursor', () => null)
  const hasMore = useState<boolean>('notify:hasMore', () => true)

  const mapItems = (list: HubNotificationItem[]): NotificationItem[] => list.map(n => ({
    id: n.id,
    unread: !n.is_read,
    body: n.body,
    date: n.created_at,
    priority: 'normal',
    type: 'system',
    sender: { name: n.title, avatar: n.icon }
  }))

  const runFetch = async (reset: boolean): Promise<NotificationItem[]> => {
    try {
      const query: Record<string, string> = { limit: String(PAGE_SIZE) }
      if (!reset && nextCursor.value) query.cursor = nextCursor.value
      const res = await hubFetch<{ success: boolean, data: HubNotificationItem[], nextCursor?: string | null }>(
        `/api/v1/apps/${appId}/notifications`,
        { query }
      )
      const page = mapItems(res.data || [])
      nextCursor.value = res.nextCursor || null
      hasMore.value = !!res.nextCursor
      notify.value = reset ? page : [...notify.value, ...page]
      return notify.value
    } catch (error) {
      // Keep the pager stopped on failure (same contract as useCursorPagination):
      // a failed page must not leave hasMore=true or the notification slideover's
      // infinite scroll re-emits load-more in a tight loop against the hub.
      hasMore.value = false
      console.error('Error fetching notifications:', error)
      return notify.value
    } finally {
      isLoading.value = false
      isLoadingMore.value = false
      notifyInFlight = null
    }
  }

  const fetchNotify = (reset = true): Promise<NotificationItem[]> => {
    if (!auth.user.value) return Promise.resolve([])
    if (!reset) {
      if (isLoadingMore.value || !hasMore.value) return Promise.resolve(notify.value)
      isLoadingMore.value = true
      return runFetch(false)
    }
    if (notifyInFlight) return notifyInFlight
    isLoading.value = true
    notifyInFlight = runFetch(true)
    return notifyInFlight
  }

  const loadMoreNotify = () => fetchNotify(false)

  const markAsRead = async (notifyId: string) => {
    try {
      const response = await hubFetch<{ success: boolean }>(`/api/v1/apps/${appId}/notifications/${notifyId}/read`, {
        method: 'POST'
      })

      if (response.success) {
        const item = notify.value.find(n => n.id === notifyId)
        if (item) {
          item.unread = false
        }
      }
      return response.success
    } catch (error) {
      console.error('Error marking notification as read:', error)
      return false
    }
  }

  const markAllAsRead = async () => {
    try {
      const response = await hubFetch<{ success: boolean }>(`/api/v1/apps/${appId}/notifications/read-all`, {
        method: 'POST'
      })

      if (response.success) {
        notify.value.forEach((n) => {
          n.unread = false
        })
      }
      return response.success
    } catch (error) {
      console.error('Error marking all notifications as read:', error)
      return false
    }
  }

  const deleteNotify = async (ids: string[]) => {
    try {
      const response = await hubFetch<{ success: boolean }>(`/api/v1/apps/${appId}/notifications`, {
        method: 'DELETE',
        query: { id: ids.join(',') }
      })

      if (response.success) {
        notify.value = notify.value.filter(n => !ids.includes(n.id))
      }
      return response.success
    } catch (error) {
      console.error('Error deleting notifications:', error)
      return false
    }
  }

  const refresh = async () => {
    await fetchNotify()
  }

  return {
    notify,
    unreadCount,
    isLoading,
    isLoadingMore,
    hasMore,
    nextCursor,
    fetchNotify,
    loadMoreNotify,
    markAsRead,
    markAllAsRead,
    deleteNotify,
    refresh
  }
}

export const useNotify = () => {
  const feed = useNotifyFeed()
  // Capture once during setup — useToast() uses inject() and must not be
  // called later from async handlers (loses currentInstance → Vue warn).
  const toast = useToast()

  const showToast = (notification: NotificationItem) => {
    toast.add({
      title: notification.sender?.name || 'System',
      description: notification.body,
      icon: getNotifyIcon(notification.type || ''),
      color: getNotifyColor(notification.priority || 'normal'),
      duration: notification.priority === 'high' ? 10000 : 5000
    })
  }

  const success = (title: string, description?: string) => {
    toast.add({ title, description, icon: 'i-lucide-check-circle-2', color: 'success', duration: 4000 })
  }

  const error = (title: string, description?: string) => {
    toast.add({ title, description, icon: 'i-lucide-alert-circle', color: 'error', duration: 6000 })
  }

  const warning = (title: string, description?: string) => {
    toast.add({ title, description, icon: 'i-lucide-alert-triangle', color: 'warning', duration: 5000 })
  }

  const info = (title: string, description?: string) => {
    toast.add({ title, description, icon: 'i-lucide-info', color: 'info', duration: 4000 })
  }

  return {
    ...feed,
    showToast,
    getNotifyIcon,
    getNotifyColor,
    success,
    error,
    warning,
    info
  }
}
