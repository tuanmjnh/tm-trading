<script setup lang="ts">
import { useModuleExport, buildExportChildren } from '~/composables/admin/useModuleExport'
import type { Role } from '~/types/rbac'
import type { SystemRoute } from '~~/types'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'
import { hasAllRoutes } from '#shared/rbac'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const routesAdmin = useAdminRoutes()
const { translateRouteLabel } = useNavMenu()
const { title, description } = useAdminPageChrome({
  titleKey: 'routes.title',
  descKey: 'routes.description'
})
const { buildRowActions } = useAdminRowActions()
const { exporting: exportingRoutes, exportModule: exportRoutes } = useModuleExport()

const targetApp = ref('')
const isCreateOpen = ref(false)
const copySource = ref<{
  id?: string
  path?: string
  name?: string
  label?: string
  icon?: string
  sort?: number
  isVisible?: boolean
  parentId?: string
  requiredPermission?: string
} | null>(null)
const isEditOpen = ref(false)
const isDeleteOpen = ref(false)
const editingRoute = ref<SystemRoute | null>(null)
const deletingId = ref('')
const searchQuery = ref('')
const treeRef = ref()
const allRoles = ref<Role[]>([])

const tree = ref<SystemRoute[]>([])
const selectedRoutes = ref<Set<string>>(new Set())

watchEffect(() => {
  if (!targetApp.value && useAppsStore().apps.length) {
    const store = useAppsStore()
    targetApp.value = store.activeAppId || store.apps[0]?.id || ''
  }
})

watch(targetApp, async (v) => {
  if (!v) return
  try {
    await routesAdmin.setApp(v)
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
  try {
    const res = await adminFetch<{ success: boolean, data: Role[] }>(
      `/api/v1/apps/${encodeURIComponent(v)}/roles`,
      { query: { limit: 100 } }
    )
    allRoles.value = res.data || []
  } catch {
    allRoles.value = []
  }
}, { immediate: true })

const rolesForRoute = (routeId: string): Role[] =>
  allRoles.value.filter(r => hasAllRoutes(r.allowedRoutes) || (r.allowedRoutes || []).includes(routeId))

watch(() => routesAdmin.tree.value, (newVal) => {
  tree.value = (newVal || []) as unknown as SystemRoute[]
}, { deep: true, immediate: true })

const filteredTree = computed<SystemRoute[]>(() => {
  if (!searchQuery.value) return tree.value

  const query = searchQuery.value.trim().toLowerCase()
  const filter = (nodes: SystemRoute[]): SystemRoute[] => {
    return nodes.reduce((acc: SystemRoute[], node) => {
      const match = (node.label || '').toLowerCase().includes(query)
        || translateRouteLabel(node.label, node.name).toLowerCase().includes(query)
        || (node.name || '').toLowerCase().includes(query)
        || (node.path || '').toLowerCase().includes(query)
      const children = node.children ? filter(node.children) : []
      if (match || children.length > 0) {
        acc.push({ ...node, children })
      }
      return acc
    }, [])
  }
  return filter(tree.value)
})

const saveOrder = async (val: SystemRoute[]) => {
  const updates: Array<{ id: string, sort: number, parentId: string | null }> = []
  const walk = (nodes: SystemRoute[], parentId: string | null = null) => {
    let index = 0
    nodes.forEach((n) => {
      if (!n?.id) return
      updates.push({ id: n.id, sort: index, parentId })
      index++
      if (n.children?.length) walk(n.children, n.id)
    })
  }
  walk(val)

  try {
    await routesAdmin.reorderRoutes(updates)
    notify.success(t('routes.reordered'))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

const onTreeUpdate = (val: SystemRoute[]) => {
  tree.value = val
  if (!searchQuery.value && val?.length) saveOrder(val)
}

const openEdit = (route: SystemRoute) => {
  editingRoute.value = route
  isEditOpen.value = true
}

const openCreate = () => {
  copySource.value = null
  isCreateOpen.value = true
}

const openCopy = (route: SystemRoute) => {
  copySource.value = {
    id: `${route.id}_copy`,
    path: route.path === '/' ? '/copy' : `${route.path.replace(/\/$/, '')}-copy`,
    name: `${route.name}_copy`,
    label: '',
    icon: route.icon || 'i-lucide-circle',
    sort: flat.value.length,
    isVisible: route.isVisible !== false,
    parentId: route.parentId || '',
    requiredPermission: route.requiredPermission || ''
  }
  isCreateOpen.value = true
}

const confirmDelete = (id: string) => {
  deletingId.value = id
  isDeleteOpen.value = true
}

const handleDelete = async () => {
  if (!deletingId.value) return
  try {
    await routesAdmin.deleteRoute(deletingId.value)
    notify.success(t('routes.deleted'))
    isDeleteOpen.value = false
    deletingId.value = ''
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

const rowActions = (route: SystemRoute) => buildRowActions([
  { type: 'edit', onSelect: () => openEdit(route) },
  { type: 'copy', onSelect: () => openCopy(route) },
  { type: 'delete', onSelect: () => confirmDelete(route.id) }
])

const onNodeSelect = ({ node, isSelected }: { node: SystemRoute, isSelected: boolean }) => {
  if (isSelected) selectedRoutes.value.add(node.id)
  else selectedRoutes.value.delete(node.id)
}

const flat = computed(() => routesAdmin.flat.value)

const accessLabel = (routeId: string): string => {
  const list = rolesForRoute(routeId)
  if (!list.length) return `${t('admin.accessedBy')}: ${t('admin.noRolesAccess')}`
  return `${t('admin.accessedBy')}: ${list.map(r => r.name).join(', ')}`
}

const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'import',
    icon: 'i-lucide-file-up',
    label: t('import.open'),
    overflow: true,
    onSelect: () => navigateTo({ path: '/resources/import', query: { target: 'routes' } })
  },
  {
    key: 'export',
    icon: 'i-lucide-file-down',
    label: t('admin.export.action'),
    overflow: true,
    disabled: exportingRoutes.value,
    children: buildExportChildren(t, fmt => exportRoutes(targetApp.value, 'routes', fmt))
  },
  {
    key: 'create',
    icon: 'i-lucide-plus',
    label: t('routes.new'),
    color: 'primary',
    primary: true,
    onSelect: openCreate
  }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value),
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: () => routesAdmin.refresh()
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: flat.value.length,
  loading: routesAdmin.loading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="routes" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <BaseHeaderActions :actions="headerActions" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" size="sm" :loading="routesAdmin.loading.value"
          @click="routesAdmin.refresh()" />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <AdminAppSwitcher v-model="targetApp" />
            <UInput v-model="searchQuery" icon="i-lucide-search" :placeholder="t('common.search')"
              class="w-full sm:w-64" size="sm" />
          </div>
        </template>
        <template #right>
          <UButton :icon="treeRef?.isAllExpanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" variant="soft"
            color="neutral" size="sm" @click="treeRef?.toggleAll()" />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter :count="flat.length" :has-more="false" :loading="routesAdmin.loading.value" />
    </template>

    <div class="flex flex-col gap-4 w-full h-full min-h-0 pb-24 lg:pb-6">
      <div v-if="routesAdmin.initialLoading.value" class="space-y-2 pr-1">
        <USkeleton v-for="i in 6" :key="i" class="h-16 w-full rounded-lg" />
      </div>

      <template v-else>
        <div class="text-xs text-muted px-1">{{ t('routes.dragHint') }}</div>

        <div v-if="flat.length === 0" class="py-8">
          <AdminEmptyState :title="t('routes.empty')" icon="i-lucide-menu" />
        </div>

        <div v-else class="flex-1 min-h-0 overflow-auto pe-1">
          <SharedHeTreeMenu ref="treeRef" :model-value="searchQuery ? filteredTree : tree" class="w-full"
            :field-names="{ id: 'id', label: 'label', children: 'children' }" :selected-keys="selectedRoutes"
            :default-expand-all="!!searchQuery" :draggable="!searchQuery"
            :action-options="(node: SystemRoute) => rowActions(node)"
            @update:model-value="onTreeUpdate" @node:select="onNodeSelect"
            @node:click="(node: SystemRoute) => openEdit(node)">
            <template #title="{ node }">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium truncate">{{ translateRouteLabel(node.label, node.name) }}</span>
                <code class="text-[11px] text-primary bg-primary/10 px-1.5 rounded">{{ node.path }}</code>
              </div>
            </template>

            <template #description="{ node }">
              <span class="text-[11px] text-muted truncate">
                {{ node.name }} · #{{ node.sort }}
                <code v-if="node.requiredPermission"
                  class="text-primary bg-primary/10 px-1 rounded">{{ node.requiredPermission }}</code>
              </span>
            </template>

            <template #right-text="{ node }">
              <AdminStatusBadge :label="node.isVisible ? t('common.active') : t('common.inactive')"
                :color="node.isVisible ? 'success' : 'neutral'" />
              <UTooltip v-if="allRoles.length" :text="accessLabel(node.id)">
                <UBadge :label="`${rolesForRoute(node.id).length}`" color="secondary" variant="subtle" size="xs"
                  icon="i-lucide-users" />
              </UTooltip>
            </template>

            <template #actions="{ node }">
              <AdminRowActions :items="rowActions(node)" />
            </template>
          </SharedHeTreeMenu>
        </div>
      </template>
    </div>

    <RoutesCreateModal v-model:open="isCreateOpen" :app-id="targetApp" :routes="flat" :initial-data="copySource" />
    <RoutesEditModal v-model:open="isEditOpen" :route="editingRoute" :app-id="targetApp" :routes="flat" />
    <BaseConfirmModal v-model:open="isDeleteOpen" :title="t('routes.deleteConfirm')"
      :description="t('routes.deleteConfirmDesc', { id: deletingId })" :confirm-label="t('common.delete')"
      :cancel-label="t('common.cancel')" color="error" icon="i-lucide-alert-triangle" @confirm="handleDelete" />
  </BasePage>
</template>
