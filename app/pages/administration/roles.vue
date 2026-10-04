<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Role } from '~/types/rbac'
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

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const toast = useToast()
const { t } = useI18n()
const { hubFetch, appId } = useHub()

const { data: rolesRes, status, refresh } = await useAsyncData('hub-roles', () =>
  hubFetch<{ success: boolean, data: Role[] }>(`/api/v1/apps/${appId}/roles`), {
  default: () => ({ success: true, data: [] })
})
const defaultModules = [
  { module: 'users', actions: ['read', 'write', 'delete'] },
  { module: 'roles', actions: ['read', 'write', 'delete'] },
  { module: 'media', actions: ['read', 'write', 'delete'] },
  { module: 'notifications', actions: ['read', 'write', 'delete'] },
  { module: 'system', actions: ['read', 'write'] },
  { module: 'chat', actions: ['read', 'write'] }
]
const modulesRes = ref({ success: true, data: defaultModules })
const { data: routesRes } = await useAsyncData('hub-routes', () =>
  hubFetch<{ success: boolean, data: { routes: any[], tree: any[] } }>(`/api/v1/apps/${appId}/routes`), {
  default: () => ({ success: true, data: { routes: [], tree: [] } })
})

const modules = computed(() => modulesRes.value?.data || [])
const routeTree = computed(() => routesRes.value?.data?.tree || [])

const showModal = ref(false)
const editingRole = ref<Role | null>(null)
const form = reactive({
  name: '',
  description: '',
  allowedRoutes: [] as string[],
  permissions: [] as { module: string, actions: string[] }[]
})
const saving = ref(false)
const searchQuery = ref('')
const treeRef = ref()

const schema = computed(() => z.object({
  name: z.string().min(2, t('admin.nameMin')),
  description: z.string().optional(),
  allowedRoutes: z.array(z.string()).optional(),
  permissions: z.array(z.object({
    module: z.string(),
    actions: z.array(z.string())
  })).optional()
}))

const getAllRouteIds = (nodes: any[]): string[] => {
  let ids: string[] = []
  nodes.forEach((node) => {
    if (node.id) ids.push(node.id)
    if (node.children) ids = ids.concat(getAllRouteIds(node.children))
  })
  return ids
}

const findParentIds = (nodes: any[], targetId: string, parents: string[] = []): string[] | null => {
  for (const node of nodes) {
    if (node.id === targetId) return parents
    if (node.children) {
      const result = findParentIds(node.children, targetId, [...parents, node.id])
      if (result) return result
    }
  }
  return null
}

const homeRouteId = computed(() => routeTree.value.find((n: any) => n.path === '/')?.id)

const allowedRoutesProxy = computed({
  get: () => {
    const current = form.allowedRoutes || []
    const result = [...current]
    if (homeRouteId.value && !result.includes(homeRouteId.value)) {
      result.push(homeRouteId.value)
    }
    return result
  },
  set: (val) => {
    const newVal = [...val]
    if (homeRouteId.value && !newVal.includes(homeRouteId.value)) {
      newVal.push(homeRouteId.value)
    }
    form.allowedRoutes = newVal
  }
})

const allRouteIds = computed(() => getAllRouteIds(routeTree.value))
const isAllSelected = computed(() => {
  return allRouteIds.value.length > 0 && allowedRoutesProxy.value.length === allRouteIds.value.length
})

const handleToggleAll = () => {
  if (isAllSelected.value) {
    const keepIds: string[] = []
    if (homeRouteId.value) keepIds.push(homeRouteId.value)
    allowedRoutesProxy.value = keepIds
  } else {
    allowedRoutesProxy.value = [...allRouteIds.value]
  }
}

const onNodeSelect = ({ node, isSelected }: { node: any, isSelected: boolean }) => {
  if (node.path === '/') return

  if (isSelected) {
    const parentIds = findParentIds(routeTree.value, node.id) || []
    const childIds = getAllRouteIds(node.children || [])
    const newIds = new Set([...allowedRoutesProxy.value, node.id, ...parentIds, ...childIds])
    allowedRoutesProxy.value = Array.from(newIds)
  } else {
    const childIds = getAllRouteIds(node.children || [])
    const removeIds = new Set([node.id, ...childIds])
    allowedRoutesProxy.value = allowedRoutesProxy.value.filter((id: string) => !removeIds.has(id))
  }
}

const filterNodes = (nodes: any[], query: string): any[] => {
  if (!query) return nodes
  return nodes.reduce((acc, node) => {
    const matches = node.label.toLowerCase().includes(query.toLowerCase()) || node.path.toLowerCase().includes(query.toLowerCase())
    const children = node.children ? filterNodes(node.children, query) : []

    if (matches || children.length > 0) {
      acc.push({ ...node, children })
    }
    return acc
  }, [] as any[])
}

const filteredRoutes = computed(() => filterNodes(routeTree.value, searchQuery.value))

function openAdd() {
  editingRole.value = null
  form.name = ''
  form.description = ''
  form.allowedRoutes = homeRouteId.value ? [homeRouteId.value] : []
  form.permissions = modules.value.map((m: any) => ({ module: m.key, actions: [] }))
  showModal.value = true
}

function openEdit(r: Role) {
  editingRole.value = r
  form.name = r.name
  form.description = r.description
  form.allowedRoutes = [...(r.allowedRoutes || [])]
  form.permissions = modules.value.map((m: any) => {
    const existing = r.permissions.find(p => p.module === m.key)
    return { module: m.key, actions: existing ? [...existing.actions] : [] }
  })
  showModal.value = true
}

function toggleAction(moduleKey: string, action: string) {
  const perm = form.permissions.find(p => p.module === moduleKey)
  if (!perm) return
  const idx = perm.actions.indexOf(action)
  if (idx >= 0) perm.actions.splice(idx, 1)
  else perm.actions.push(action)
}

const allActions = ['read', 'write', 'delete', 'manage']

async function onSubmit() {
  if (saving.value) return
  saving.value = true
  try {
    const body = {
      name: form.name,
      description: form.description,
      allowedRoutes: form.allowedRoutes,
      permissions: form.permissions.filter(p => p.actions.length > 0)
    }
    if (editingRole.value) {
      await hubFetch(`/api/v1/apps/${appId}/roles?id=${editingRole.value.id}`, { method: 'PUT', body })
      toast.add({ title: t('admin.roleUpdated'), icon: 'i-lucide-check', color: 'success' })
    } else {
      await hubFetch(`/api/v1/apps/${appId}/roles`, { method: 'POST', body })
      toast.add({ title: t('admin.roleCreated'), icon: 'i-lucide-check', color: 'success' })
    }
    showModal.value = false
    refresh()
  } catch (err: any) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally { saving.value = false }
}

async function confirmDelete(r: Role) {
  if (r.isSystem) {
    toast.add({ title: t('admin.cannotDeleteSystem'), color: 'error' })
    return
  }
  deleteTarget.value = r
  showDeleteModal.value = true
}

const deleteTarget = ref<Role | null>(null)
const showDeleteModal = ref(false)
const deleting = ref(false)

const showBatchDeleteModal = ref(false)
const batchDeleting = ref(false)

async function doDelete() {
  if (deleting.value || !deleteTarget.value) return
  deleting.value = true
  try {
    await hubFetch(`/api/v1/apps/${appId}/roles?id=${deleteTarget.value.id}`, { method: 'DELETE' })
    toast.add({ title: t('admin.roleDeleted'), icon: 'i-lucide-check', color: 'success' })
    deleteTarget.value = null
    showDeleteModal.value = false
    refresh()
  } catch (err: any) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    deleting.value = false
  }
}

async function doBatchDelete() {
  const targets = selected.value.filter(r => !r.isSystem)
  if (batchDeleting.value || targets.length === 0) return
  batchDeleting.value = true
  try {
    const ids = targets.map(r => r.id).join(',')
    await hubFetch(`/api/v1/apps/${appId}/roles?id=${ids}`, { method: 'DELETE' })
    toast.add({ title: t('admin.roleDeleted'), icon: 'i-lucide-check', color: 'success' })
    selected.value = []
    showBatchDeleteModal.value = false
    refresh()
  } catch (err: any) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    batchDeleting.value = false
  }
}

const selected = ref<Role[]>([])

const columns = computed(() => [
  { key: 'name', label: t('admin.name'), class: 'w-48' },
  { key: 'description', label: t('admin.description'), class: 'flex-1' },
  { key: 'isSystem', label: t('admin.system'), class: 'w-24' }
])

const getActionOptions = (item: Role) => [
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
      disabled: item.isSystem,
      onSelect() { confirmDelete(item) }
    }
  ]
]
const { exporting, exportModule } = useModuleExport()

const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'import',
    icon: 'i-lucide-file-up',
    label: t('import.open'),
    overflow: true,
    onSelect: () => navigateTo({ path: '/resources/import', query: { target: 'roles' } })
  },
  {
    key: 'export',
    icon: 'i-lucide-file-down',
    label: t('admin.export.action'),
    overflow: true,
    disabled: exporting.value,
    children: buildExportChildren(t, fmt => exportModule('roles', fmt))
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
    label: t('admin.addRole'),
    color: 'primary',
    primary: true,
    onSelect: openAdd
  }
])
</script>

<template>
  <BasePage id="admin-roles" :title="$t('admin.rolesPermissions')">
    <template #right>
      <div class="flex items-center gap-2">
        <BaseHeaderActions :actions="headerActions" />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="status === 'pending'"
          @click="refresh"
        />
      </div>
    </template>
        </UButton>
        <UButton
          :label="$t('admin.addRole')"
          icon="i-lucide-plus"
          variant="soft"
          @click="openAdd"
        />
      </div>
    </template>

    <template #default>
      <div class="flex-1 min-h-0 relative h-full">
        <LazyGridList
          v-model:selected="selected"
          :items="rolesRes?.data || []"
          :columns="columns"
          :loading="status === 'pending'"
          item-key="id"
          selectable
          :action-options="getActionOptions"
          @refresh="refresh"
        >
          <template #isSystem="{ item }">
            <UBadge
              v-if="item.isSystem"
              :label="t('global.yes')"
              color="neutral"
              variant="subtle"
            />
          </template>

          <template #mobile-content="{ item }">
            <div class="flex flex-col gap-2">
              <div class="flex justify-between items-start gap-2">
                <span class="text-sm font-bold truncate">{{ item.name }}</span>
                <UBadge
                  v-if="item.isSystem"
                  variant="subtle"
                  color="neutral"
                  class="text-[10px] shrink-0"
                >
                  {{ t('admin.system') }}
                </UBadge>
              </div>
              <span v-if="item.description" class="text-xs text-gray-500 line-clamp-2 leading-relaxed italic">
                {{ item.description }}
              </span>
              <div class="flex items-center gap-1 mt-1">
                <div class="flex items-center gap-1">
                  <UIcon name="i-lucide-route" class="size-3.5 text-primary-500" />
                  <span class="text-[10px] text-gray-500">
                    {{ t('admin.allowedRoutes') }}: {{ item.allowedRoutes === '*' ? t('admin.all')
                      : (item.allowedRoutes?.length || 0) }}
                  </span>
                </div>
                <div class="flex items-center gap-1 ml-auto">
                  <UIcon name="i-lucide-shield-check" class="size-3.5 text-info-500" />
                  <span class="text-[10px] text-gray-500">
                    {{ t('admin.permissions') }}: {{ item.permissions?.length || 0 }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </LazyGridList>
      </div>

      <BaseFormModal
        v-model:open="showModal"
        :title="editingRole ? t('admin.editRole') : t('admin.addRole')"
        :schema="schema"
        :state="form"
        :loading="saving"
        :ui="{ content: 'w-full max-w-3xl' }"
        @submit="onSubmit"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField :label="t('admin.name')" name="name" required>
            <UInput v-model="form.name" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.description')" name="description">
            <UInput v-model="form.description" class="w-full" />
          </UFormField>
        </div>

        <UFormField :label="$t('admin.permissions')">
          <div class="space-y-2">
            <div class="flex justify-between items-center">
              <div class="flex gap-2">
                <UInput
                  v-model="searchQuery"
                  icon="i-lucide-search"
                  size="sm"
                  class="w-52"
                />
                <UTooltip :text="treeRef?.isAllExpanded ? $t('common.collapse_all') : $t('common.expand_all')">
                  <UButton
                    :icon="treeRef?.isAllExpanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="treeRef?.toggleAll()"
                  />
                </UTooltip>
                <UTooltip :text="isAllSelected ? $t('common.uncheck_all') : $t('common.check_all')">
                  <UButton
                    :icon="isAllSelected ? 'i-lucide-list-checks' : 'i-lucide-check-square'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    @click="handleToggleAll"
                  />
                </UTooltip>
              </div>
              <UBadge color="primary" variant="subtle">
                {{ allowedRoutesProxy.length }}
              </UBadge>
            </div>

            <div class="max-h-[40vh] overflow-y-auto border border-default rounded-lg p-2">
              <SharedHeTreeMenu
                ref="treeRef"
                :model-value="filteredRoutes"
                :selected-keys="allowedRoutesProxy"
                :field-names="{ id: 'id', label: 'label', children: 'children' }"
                :default-expand-all="false"
                :draggable="false"
                @node:select="onNodeSelect"
              >
                <template #title="{ node }">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate block">
                    {{ t(`nav.${node.label.replace('nav.', '')}`) || node.label }}
                  </span>
                  <span class="text-xs text-gray-500">{{ node.path }}</span>
                </template>
              </SharedHeTreeMenu>
            </div>
          </div>
        </UFormField>

        <UFormField :label="t('admin.permissions')" :description="$t('admin.actionsHelp')">
          <div class="space-y-2 w-full">
            <div
              v-for="perm in form.permissions"
              :key="perm.module"
              class="flex items-center justify-between p-2 rounded-md border border-default"
            >
              <span class="text-sm font-medium capitalize">{{ perm.module }}</span>
              <div class="flex gap-1">
                <UBadge
                  v-for="action in allActions"
                  :key="action"
                  :label="$t(`admin.${action}`)"
                  :variant="perm.actions.includes(action) ? 'solid' : 'subtle'"
                  :color="perm.actions.includes(action) ? 'primary' : 'neutral'"
                  class="cursor-pointer capitalize"
                  @click="toggleAction(perm.module, action)"
                />
              </div>
            </div>
          </div>
        </UFormField>
      </BaseFormModal>

      <LazyBaseConfirmModal
        v-model:open="showDeleteModal"
        :title="t('admin.deleteRoleConfirm')"
        :description="t('admin.deleteRoleConfirmDesc', { name: deleteTarget?.name || '' })"
        :loading="deleting"
        @confirm="doDelete"
      />

      <LazyBaseConfirmModal
        v-model:open="showBatchDeleteModal"
        :title="t('admin.deleteRoleConfirm')"
        :description="t('admin.deleteRoleConfirmDesc', { name: selected.filter(r => !r.isSystem).map(r => r.name).join(', ') })"
        :loading="batchDeleting"
        @confirm="doBatchDelete"
      />
    </template>
  </BasePage>
</template>
