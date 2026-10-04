<script setup lang="ts">
import { MODULE_DEFINITIONS } from '#shared/rbac'
import type { PermissionMatrix, MatrixRole, MatrixPermission } from '~/composables/admin/usePermissions'

interface Props {
  matrix: PermissionMatrix | null
  loading: boolean
  saving: boolean
  onSave: (updates: { roleId: string; permissionId: string; checked: boolean }[]) => Promise<void>
  onToggle: (roleId: string, permissionId: string, checked: boolean) => void
  isPermissionInRole: (roleId: string, permissionId: string) => boolean
}

const props = defineProps<Props>()

const { t } = useI18n()
const notify = useNotify()

const pendingUpdates = ref<{ roleId: string; permissionId: string; checked: boolean }[]>([])

const roles = computed(() => props.matrix?.roles || [])
const permissions = computed(() => props.matrix?.permissions || [])

const groupedPermissions = computed(() => {
  const map = new Map<string, MatrixPermission[]>()
  for (const p of permissions.value) {
    const list = map.get(p.module) || []
    list.push(p)
    map.set(p.module, list)
  }
  const order = MODULE_DEFINITIONS.map(m => m.key)
  return Array.from(map.entries()).sort((a, b) => {
    const ia = order.indexOf(a[0])
    const ib = order.indexOf(b[0])
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
})

const moduleLabel = (key: string): string => {
  const mod = MODULE_DEFINITIONS.find(m => m.key === key)
  if (mod) return mod.key
  return key
}

const actionLabel = (action: string) => {
  const labels: Record<string, string> = {
    read: 'Read',
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
    send: 'Send',
    manage: 'Manage',
    upload: 'Upload',
    rotateSecret: 'Rotate Secret',
    logs: 'Logs',
    write: 'Write',
    analytics: 'Analytics',
    export: 'Export',
    import: 'Import',
    apps: 'Apps',
    crossapp: 'CrossApp',
    audit: 'Audit',
    '*': 'Full Access',
  }
  return labels[action] || action
}

const scopeLabel = (scope: string) => {
  const labels: Record<string, string> = {
    own: 'Own',
    team: 'Team',
    app: 'App',
    global: 'Global',
  }
  return labels[scope] || scope
}

function handleToggle(roleId: string, permissionId: string, checked: boolean) {
  const existing = pendingUpdates.value.findIndex(u => u.roleId === roleId && u.permissionId === permissionId)
  if (existing >= 0) {
    const update = pendingUpdates.value[existing]
    if (update) update.checked = checked
  } else {
    pendingUpdates.value.push({ roleId, permissionId, checked })
  }
  props.onToggle(roleId, permissionId, checked)
}

async function handleSave() {
  if (pendingUpdates.value.length === 0) return
  try {
    await props.onSave(pendingUpdates.value)
    pendingUpdates.value = []
    notify.success(t('admin.permissions.matrixSaved'))
  } catch {
    notify.error(t('admin.permissions.matrixSaveFailed'))
  }
}

function hasChanges() {
  return pendingUpdates.value.length > 0
}

function isChecked(roleId: string, permissionId: string): boolean {
  const pending = pendingUpdates.value.find(u => u.roleId === roleId && u.permissionId === permissionId)
  if (pending) return pending.checked
  return props.isPermissionInRole(roleId, permissionId)
}

function getActionScopeCell(permission: MatrixPermission) {
  return `${actionLabel(permission.action)} · ${scopeLabel(permission.scope)}`
}
</script>

<template>
  <UCard class="w-full">
    <template #header>
      <div class="flex items-center justify-between w-full">
        <h3 class="text-lg font-semibold">{{ t('admin.permissions.matrix') }}</h3>
        <div class="flex items-center gap-2">
          <UButton
            v-if="hasChanges()"
            :label="t('common.save')"
            variant="solid"
            color="primary"
            size="sm"
            :icon="saving ? 'i-lucide-loader-circle' : 'i-lucide-save'"
            :loading="saving"
            @click="handleSave"
          />
          <UButton
            v-if="hasChanges()"
            :label="t('common.cancel')"
            variant="outline"
            color="neutral"
            size="sm"
            @click="pendingUpdates = []"
          />
        </div>
      </div>
    </template>

    <div v-if="loading" class="flex items-center justify-center h-64">
      <USkeleton class="w-full h-96" />
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[800px] border-collapse">
        <thead>
          <tr class="border-b border-default">
            <th class="sticky left-0 z-10 w-48 px-3 py-2 text-left text-xs font-medium text-muted bg-default/50 border-r border-default">
              {{ t('admin.permissions.permission') }}
            </th>
            <th class="sticky left-48 z-10 w-32 px-3 py-2 text-left text-xs font-medium text-muted bg-default/50 border-r border-default">
              {{ t('admin.permissions.actionScope') }}
            </th>
            <th
              v-for="role in roles"
              :key="role.roleId"
              class="sticky left-[80px] z-10 w-36 px-3 py-2 text-center text-xs font-medium text-muted bg-default/50 border-r border-default"
            >
              {{ role.roleName }}
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="[module, perms] in groupedPermissions" :key="module">
            <tr class="bg-muted/30">
              <td colspan="999" class="px-3 py-1.5 text-xs font-semibold text-highlighted border-b border-default">
                {{ moduleLabel(module) }}
              </td>
            </tr>
            <tr v-for="perm in perms" :key="perm.permissionId" class="border-b border-default/50 hover:bg-default/30">
              <td class="sticky left-0 z-10 px-3 py-2 text-sm font-mono text-highlighted border-r border-default bg-default/50 whitespace-nowrap">
                <div class="flex items-center gap-2">
                  <span>{{ perm.permissionName }}</span>
                </div>
              </td>
              <td class="sticky left-48 z-10 px-3 py-2 text-xs text-muted border-r border-default bg-default/50 whitespace-nowrap">
                {{ getActionScopeCell(perm) }}
              </td>
              <td
                v-for="role in roles"
                :key="role.roleId"
                class="sticky left-[80px] z-10 px-3 py-2 text-center border-r border-default"
              >
                <UCheckbox
                  :model-value="isChecked(role.roleId, perm.permissionId)"
                  @update:model-value="(v) => handleToggle(role.roleId, perm.permissionId, v as boolean)"
                  :disabled="loading || saving"
                  size="sm"
                />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="!loading && (!roles.length || !permissions.length)" class="p-8 text-center text-muted">
      <UIcon name="i-lucide-lock" class="size-12 mx-auto mb-2 text-muted/50" />
      <p>{{ t('admin.permissions.matrixEmpty') }}</p>
    </div>
  </UCard>
</template>