<script setup lang="ts">
import { useModuleExport, buildExportChildren } from '~/composables/admin/useModuleExport'
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { Role } from '~/types/rbac'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'
import { isFullAccessRole, hasAllRoutes } from '#shared/rbac'
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({
  middleware: () => {
    if (import.meta.client) {
      const a = useAuth()
      if (!a.isAuthenticated.value) return navigateTo('/login')
    }
  }
})

const { t } = useI18n()
const notify = useNotify()
const auth = useAuth()
const { appId } = useHub()
const roles = useAdminRoles()
const { viewMode } = useAdminGridView('roles-view-mode')
const { title, description } = useAdminPageChrome({
  titleKey: 'admin.rolesTitle',
  descKey: 'admin.rolesDesc'
})
const { buildRowActions } = useAdminRowActions()
const { exporting: exportingRoles, exportModule: exportRoles } = useModuleExport()

const isCreateOpen = ref(false)
const copySource = ref<{ name?: string, description?: string, permissions?: string[] } | null>(null)
const isEditOpen = ref(false)
const isDeleteOpen = ref(false)
const editingRole = ref<Role | null>(null)
const deletingIds = ref<string[]>([])
const selected = ref<Role[]>([])
const searchQuery = ref('')

const isRoot = computed(() => auth.user.value?.permissions?.includes('*') || auth.user.value?.role === 'root')

watch(() => appId, async (id) => {
  if (!id) return
  await roles.setApp(id)
  await roles.fetchRoutes(id).catch(() => { })
}, { immediate: true })

const filteredRoles = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return roles.items.value
  return roles.items.value.filter(r =>
    r.name.toLowerCase().includes(q)
    || (r.description || '').toLowerCase().includes(q)
    || r.id.toLowerCase().includes(q)
  )
})

const openEdit = (role: Role) => {
  editingRole.value = role
  isEditOpen.value = true
}

const openCreate = () => {
  copySource.value = null
  isCreateOpen.value = true
}

const openCopy = (role: Role) => {
  copySource.value = {
    name: `${role.name} (${t('common.copy')})`,
    description: role.description || '',
    permissions: role.permissions.flatMap(p => p.actions.map(a => `${p.module}.${a}`))
  }
  isCreateOpen.value = true
}

const confirmDelete = (ids: string[]) => {
  deletingIds.value = ids
  isDeleteOpen.value = true
}

const deletingNames = computed(() =>
  deletingIds.value
    .map(id => roles.items.value.find(r => r.id === id)?.name || id)
    .join(', ')
)

const handleDelete = async () => {
  if (!deletingIds.value.length || !appId) return
  try {
    await roles.deleteRole(appId, deletingIds.value)
    notify.success(t('admin.roleDeleted'))
    isDeleteOpen.value = false
    deletingIds.value = []
    selected.value = []
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

const rowActions = (role: Role) => buildRowActions([
  { type: 'edit', onSelect: () => openEdit(role) },
  { type: 'copy', onSelect: () => openCopy(role) },
  { type: 'delete', visible: isRoot.value && !role.isSystem, onSelect: () => confirmDelete([role.id]) }
])

const columns = computed<GridColumn[]>(() => [
  { key: 'name', label: t('common.name'), class: 'w-44' },
  { key: 'description', label: t('common.description') },
  { key: 'permissions', label: t('admin.permissions.title'), class: 'w-48' },
  { key: 'allowedRoutes', label: t('admin.accessibleRoutes'), class: 'w-32' },
  { key: 'isSystem', label: t('admin.system'), class: 'w-24' }
])

const moduleLabel = (key: string) => {
  const label = t(`admin.modules.${key}`)
  return label === `admin.modules.${key}` ? key : label
}

const mobileBar = useMobileBar()
const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'export',
    icon: 'i-lucide-file-down',
    label: t('admin.export.action'),
    overflow: true,
    disabled: exportingRoles.value,
    children: buildExportChildren(t, fmt => exportRoles(appId, 'roles', fmt))
  },
  {
    key: 'delete',
    icon: 'i-lucide-trash',
    label: `${t('common.delete')} (${selected.value.length})`,
    color: 'error',
    visible: isRoot.value && selected.value.length > 0,
    onSelect: () => confirmDelete(selected.value.filter(r => !r.isSystem).map(r => r.id))
  },
  {
    key: 'create',
    icon: 'i-lucide-plus',
    label: t('admin.addRole'),
    color: 'primary',
    primary: true,
    onSelect: openCreate
  }
])

mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value),
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: () => roles.refresh()
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: filteredRoles.value.length,
  hasMore: roles.hasMore.value,
  loading: roles.loading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="roles" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <BaseHeaderActions :actions="headerActions" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" size="sm" :loading="roles.loading.value"
          @click="roles.refresh()" />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <UInput v-model="searchQuery" icon="i-lucide-search" :placeholder="t('common.search')" size="sm"
              class="w-full sm:w-64" />
          </div>
        </template>
        <template #right>
          <AdminViewModeToggle v-model="viewMode" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter :count="filteredRoles.length" :has-more="roles.hasMore.value" :loading="roles.loading.value" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <LazyGridList :items="filteredRoles" :columns="columns"
        :loading="roles.initialLoading.value || roles.loading.value" :can-load-more="roles.hasMore.value"
        :action-options="rowActions" :selectable="isRoot" v-model:selected="selected" v-model:view-mode="viewMode"
        item-key="id" storage-key="roles-view-mode" @load-more="roles.loadMore()" @refresh="roles.refresh()"
        @click="openEdit">
        <template #name="{ item }">
          <div class="min-w-0">
            <span class="font-medium text-xs text-highlighted truncate block">{{ item.name }}</span>
            <p class="text-[11px] text-muted truncate md:hidden">{{ item.description || '—' }}</p>
          </div>
        </template>

        <template #description="{ item }">
          <span class="text-[11px] text-muted truncate">{{ item.description || '—' }}</span>
        </template>

        <template #permissions="{ item }">
          <div class="flex flex-wrap gap-1">
            <UBadge v-if="isFullAccessRole(item.permissions)" :label="t('admin.fullAccess')" color="success"
              variant="subtle" size="xs" icon="i-lucide-crown" />
            <template v-else>
              <UBadge v-for="p in (item.permissions || []).slice(0, 3)" :key="p.module" :label="moduleLabel(p.module)"
                variant="subtle" size="xs" />
              <span v-if="(item.permissions || []).length > 3" class="text-xs text-muted">
                +{{ item.permissions.length - 3 }}
              </span>
            </template>
          </div>
        </template>

        <template #allowedRoutes="{ item }">
          <UBadge v-if="hasAllRoutes(item.allowedRoutes)" :label="t('admin.allRoutes')" color="info" variant="subtle"
            size="xs" />
          <span v-else class="text-xs text-muted">
            {{ t('admin.routesCount', { n: (item.allowedRoutes || []).length }) }}
          </span>
        </template>

        <template #isSystem="{ item }">
          <AdminStatusBadge v-if="item.isSystem" :label="t('admin.system')" color="warning" />
          <span v-else class="text-xs text-muted">—</span>
        </template>

        <template #mobile-content="{ item }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="font-semibold text-xs truncate">{{ item.name }}</p>
                <AdminStatusBadge v-if="item.isSystem" :label="t('admin.system')" color="warning" />
              </div>
              <p class="text-[11px] text-muted mt-0.5 line-clamp-2">{{ item.description || '—' }}</p>
              <div class="flex flex-wrap gap-1 mt-2">
                <UBadge v-if="isFullAccessRole(item.permissions)" :label="t('admin.fullAccess')" color="success"
                  variant="subtle" size="xs" icon="i-lucide-crown" />
                <template v-else>
                  <UBadge v-for="p in (item.permissions || []).slice(0, 4)" :key="p.module"
                    :label="moduleLabel(p.module)" variant="subtle" size="xs" />
                </template>
                <UBadge v-if="hasAllRoutes(item.allowedRoutes)" :label="t('admin.allRoutes')" color="info"
                  variant="subtle" size="xs" />
              </div>
            </div>
            <AdminRowActions :items="rowActions(item)" />
          </div>
        </template>

        <template #empty>
          <AdminEmptyState :title="t('common.no_results')" />
        </template>
      </LazyGridList>
    </div>

    <RolesCreateModal v-model:open="isCreateOpen" :app-id="appId" :routes="roles.routes.value"
      :initial-data="copySource" :route-tree="roles.routeTree.value" @created="roles.refresh()" />
    <RolesEditModal v-model:open="isEditOpen" :role="editingRole" :app-id="appId" :routes="roles.routes.value"
      :route-tree="roles.routeTree.value" @updated="roles.refresh()" />
    <BaseConfirmModal v-model:open="isDeleteOpen" :title="t('admin.deleteRoleConfirm')"
      :description="t('admin.deleteRoleConfirmDesc', { name: deletingNames })" :confirm-label="t('common.delete')"
      :cancel-label="t('common.cancel')" color="error" icon="i-lucide-alert-triangle" :loading="roles.mutating.value"
      @confirm="handleDelete" />
  </BasePage>
</template>
