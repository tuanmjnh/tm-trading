import type { AuthUser } from '~/types/auth'
import type { HubUser, Capability } from 'tm-hub-client'

function mapAuthUserToHubUser(user: Partial<AuthUser>): Partial<HubUser> {
  return {
    ...user,
    permissions: user.permissions as Capability[] | undefined
  }
}

export const useUsers = () => {
  const { users: usersApi } = useHub()
  const users = ref<AuthUser[]>([])
  const cursor = ref<string | null>(null)
  const canLoadMore = ref(true)
  const loading = ref(false)

  const fetchUsers = async (reset = false) => {
    if (loading.value) return
    if (!canLoadMore.value && !reset) return

    loading.value = true
    if (reset) {
      cursor.value = null
      users.value = []
      canLoadMore.value = true
    }

    try {
      const res = await usersApi.list({
        cursor: cursor.value || undefined,
        limit: 10
      })

      if (res.success && res.data) {
        if (reset) {
          users.value = res.data as AuthUser[]
        } else {
          const existingIds = new Set(users.value.map(u => u.id))
          const newItems = res.data.filter(u => !existingIds.has(u.id)) as AuthUser[]
          users.value = [...users.value, ...newItems]
        }

        cursor.value = (res.nextCursor as string | null) ?? null
        canLoadMore.value = !!res.nextCursor
      }
    } catch (err) {
      console.error('Error fetching users:', err)
    } finally {
      loading.value = false
    }
  }

  const createUser = async (user: Partial<AuthUser>) => {
    return await usersApi.create(mapAuthUserToHubUser(user))
  }

  const updateUser = async (id: string, user: Partial<AuthUser>) => {
    return await usersApi.update(id, mapAuthUserToHubUser(user))
  }

  const deleteUser = async (id: string) => {
    return await usersApi.delete(id)
  }

  return {
    users,
    cursor,
    canLoadMore,
    loading,
    fetchUsers,
    createUser,
    updateUser,
    deleteUser
  }
}
