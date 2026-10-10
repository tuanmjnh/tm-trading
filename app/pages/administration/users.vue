<script setup lang="ts">
import type { AuthUser } from '~/types/auth'
import { z } from 'zod'
import { getErrorMessage } from '~/shared/utils/errors'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'
import { buildExportChildren, useModuleExport } from '~/composables/useModuleExport'

definePageMeta({
  middleware: () => {
    if (import.meta.client) {
      const a = useAuth()
      if (!a.isAuthenticated.value) return navigateTo('/login')
    }
  }
})

const { user: currentUser } = useAuth()
const { hubFetch, appId } = useHub()
const toast = useToast()
const { t } = useI18n()

// Use paginated users
const { users, loading, canLoadMore, fetchUsers } = useUsers()

const roles = ref<{ id: string, name: string }[]>([])
async function loadRoles() {
  try {
    const { data } = await hubFetch<{ success: boolean, data: { id: string, name: string }[] }>(`/api/v1/apps/${appId}/roles`)
    roles.value = data.map(r => ({ id: r.id, name: r.name }))
  } catch {
    // ignore
  }
}

onMounted(() => {
  loadRoles()
  fetchUsers(true)
})

const selected = ref<AuthUser[]>([])

const columns = computed(() => [
  { key: 'name', label: t('admin.name'), class: 'w-40' },
  { key: 'email', label: t('auth.email'), class: 'w-52' },
  { key: 'username', label: t('admin.username'), class: 'w-36' },
  { key: 'role', label: t('admin.role'), class: 'w-28' },
  { key: 'platform', label: t('admin.platform'), class: 'w-28' },
  { key: 'createdAt', label: t('admin.created'), class: 'w-48' }
])

const showModal = ref(false)
const editingUser = ref<AuthUser | null>(null)
const form = reactive({ email: '', username: '', name: '', password: '', role: 'user' })
const saving = ref(false)

const schema = computed(() => z.object({
  email: z.string().min(1, t('auth.emailRequired')).email(t('auth.emailInvalid')),
  username: z.string().optional(),
  name: z.string().min(2, t('auth.nameMin')),
  password: editingUser.value ? z.string().optional() : z.string().min(6, t('auth.passwordMin')),
  role: z.string().min(1, t('admin.roleRequired'))
}))

function openAdd() {
  editingUser.value = null
  form.email = ''
  form.username = ''
  form.name = ''
  form.password = ''
  form.role = 'user'
  showModal.value = true
}

function openEdit(u: AuthUser) {
  editingUser.value = u
  form.email = u.email
  form.username = u.username || ''
  form.name = u.name
  form.password = ''
  form.role = u.role || 'user'
  showModal.value = true
}

async function onSubmit() {
  if (saving.value) return
  saving.value = true
  try {
    if (editingUser.value) {
      const body: { email: string, username?: string, name: string, role: string, password?: string } = { email: form.email, username: form.username || undefined, name: form.name, role: form.role }
      if (form.password) body.password = form.password
      await hubFetch(`/api/v1/apps/${appId}/users?id=${editingUser.value.id}`, { method: 'PUT', body })
      toast.add({ title: t('admin.userUpdated'), icon: 'i-lucide-check', color: 'success' })
    } else {
      await hubFetch(`/api/v1/apps/${appId}/users`, { method: 'POST', body: { email: form.email, username: form.username || undefined, name: form.name, password: form.password, role: form.role } })
      toast.add({ title: t('admin.userCreated'), icon: 'i-lucide-check', color: 'success' })
    }
    showModal.value = false
    fetchUsers(true)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function confirmDelete(u: AuthUser) {
  if (u.id === currentUser.value?.id) {
    toast.add({ title: t('admin.cannotDeleteSelf'), color: 'error' })
    return
  }
  deleteTarget.value = u
  showDeleteModal.value = true
}

const deleteTarget = ref<AuthUser | null>(null)
const showDeleteModal = ref(false)
const deleting = ref(false)

const showBatchDeleteModal = ref(false)
const batchDeleting = ref(false)

async function doDelete() {
  if (deleting.value || !deleteTarget.value) return
  deleting.value = true
  try {
    await hubFetch(`/api/v1/apps/${appId}/users?id=${deleteTarget.value.id}`, { method: 'DELETE' })
    toast.add({ title: t('admin.userDeleted'), icon: 'i-lucide-check', color: 'success' })
    deleteTarget.value = null
    showDeleteModal.value = false
    fetchUsers(true)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    deleting.value = false
  }
}

async function doBatchDelete() {
  const targets = selected.value.filter(u => u.id !== currentUser.value?.id)
  if (batchDeleting.value || targets.length === 0) return
  batchDeleting.value = true
  try {
    const ids = targets.map(u => u.id).join(',')
    await hubFetch(`/api/v1/apps/${appId}/users?id=${ids}`, { method: 'DELETE' })
    toast.add({ title: t('admin.userDeleted'), icon: 'i-lucide-check', color: 'success' })
    selected.value = []
    showBatchDeleteModal.value = false
    fetchUsers(true)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    batchDeleting.value = false
  }
}

const getActionOptions = (item: AuthUser) => [
  [
    {
      label: t('global.edit'),
      icon: 'i-lucide-pencil',
      onSelect() { openEdit(item) }
    },
    {
      label: t('global.delete'),
      icon: 'i-lucide-trash',
      color: 'error' as const,
      disabled: item.id === currentUser.value?.id,
      onSelect() { confirmDelete(item) }
    }
  ]
]

function onLoadMore() {
  if (canLoadMore.value && !loading.value) {
    fetchUsers(false)
  }
}

function formatDateString(str: string) {
  if (!str) return '-'
  try {
    return new Date(str).toLocaleString()
  } catch {
    return str
  }
}
const { exporting, exportModule } = useModuleExport()

const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'import',
    icon: 'i-lucide-file-up',
    label: t('import.open'),
    overflow: true,
    onSelect: () => navigateTo({ path: '/resources/import', query: { target: 'users' } })
  },
  {
    key: 'export',
    icon: 'i-lucide-file-down',
    label: t('admin.export.action'),
    overflow: true,
    disabled: exporting.value,
    children: buildExportChildren(t, fmt => exportModule('users', fmt))
  },
  {
    key: 'delete',
    icon: 'i-lucide-trash',
    label: `${t('global.delete')} (${selected.value.length})`,
    color: 'error',
    visible: selected.value.length > 0,
    onSelect: () => { showBatchDeleteModal.value = true }
  },
  {
    key: 'add',
    icon: 'i-lucide-plus',
    label: t('admin.addUser'),
    color: 'primary',
    primary: true,
    onSelect: openAdd
  }
])
</script>

<template>
  <BasePage id="admin-users" :title="$t('admin.usersTitle')">
    <template #right>
      <div class="flex items-center gap-2">
        <BaseHeaderActions :actions="headerActions" />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="loading"
          @click="fetchUsers(true)"
        />
      </div>
    </template>

    <template #default>
  <div class="flex-1 min-h-0 relative h-full">
    <LazyGridList v-model:selected="selected" :items="users" :columns="columns" :loading="loading" item-key="id"
      selectable :can-load-more="canLoadMore" :action-options="getActionOptions" @load-more="onLoadMore"
      @refresh="fetchUsers(true)">
      <template #createdAt="{ item }">
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ formatDateString(item.createdAt) }}
        </span>
      </template>

      <template #mobile-content="{ item }">
        <div class="flex flex-col gap-3 p-1">
          <!-- Top Info: Avatar, Name, Role -->
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <UAvatar :src="item.avatar" :alt="item.name" size="lg" />
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-sm font-bold text-gray-900 dark:text-white truncate">
                    {{ item.name }}
                  </span>
                  <UBadge color="primary" variant="subtle" size="xs" class="capitalize">
                    {{ item.role }}
                  </UBadge>
                </div>
                <span class="text-[10px] text-gray-400">@{{ item.username || item.name.toLowerCase().replace(/\s+/g,
                  '') }}</span>
              </div>
            </div>
            <UBadge v-if="item.platform" color="neutral" variant="soft" size="xs" class="uppercase">
              {{ item.platform }}
            </UBadge>
          </div>

          <USeparator class="opacity-50" />

          <!-- Bottom Info: Contact & Dates -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
              <UIcon name="i-lucide-mail" class="w-3.5 h-3.5 shrink-0 text-primary-500" />
              <span class="truncate">{{ item.email }}</span>
            </div>
            <div class="flex justify-between items-center text-[10px] text-gray-400 mt-1">
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-calendar" class="w-3 h-3" />
                {{ formatDateString(item.createdAt) }}
              </span>
              <span v-if="item.lastLogin" class="flex items-center gap-1">
                <UIcon name="i-lucide-log-in" class="w-3 h-3" />
                {{ formatDateString(item.lastLogin) }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </LazyGridList>
  </div>

  <BaseFormModal v-model:open="showModal" :title="editingUser ? t('admin.editUser') : t('admin.addUser')"
    :schema="schema" :state="form" :loading="saving" @submit="onSubmit">
    <UFormField :label="t('auth.email')" name="email" required>
      <UInput v-model="form.email" type="email" class="w-full" />
    </UFormField>
    <UFormField :label="t('admin.username')" name="username">
      <UInput v-model="form.username" class="w-full" />
    </UFormField>
    <UFormField :label="t('auth.name')" name="name" required>
      <UInput v-model="form.name" class="w-full" />
    </UFormField>
    <UFormField :label="editingUser ? t('admin.newPassword') : t('admin.password')" name="password"
      :required="!editingUser">
      <BasePasswordInput v-model="form.password" class="w-full" />
    </UFormField>
    <UFormField :label="t('admin.role')" name="role" required>
      <USelect v-model="form.role" :items="roles.map(r => ({ label: r.name, value: r.id }))" class="w-full" />
    </UFormField>
  </BaseFormModal>

  <LazyBaseConfirmModal v-model:open="showDeleteModal" :title="t('admin.deleteUserConfirm')"
    :description="t('admin.deleteUserConfirmDesc', { name: deleteTarget?.name || '' })" :loading="deleting"
    @confirm="doDelete" />

  <LazyBaseConfirmModal v-model:open="showBatchDeleteModal" :title="t('admin.deleteUserConfirm')"
    :description="t('admin.deleteUserConfirmDesc', { name: selected.filter(u => u.id !== currentUser?.id).map(u => u.name).join(', ') })"
    :loading="batchDeleting" @confirm="doBatchDelete" />
</template>
</BasePage>
</template>
