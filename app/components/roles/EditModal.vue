<script setup lang="ts">
import * as z from 'zod'
import { isFullAccessRole, groupFlatPermissions } from '#shared/rbac'
import type { Role, ModulePermission, PermissionAction, RouteTreeNode } from '~/types/rbac'
import { getErrorMessage } from '~/shared/utils/errors'

const props = defineProps<{
  role: Role | null
  appId: string
  routes: RouteTreeNode[]
  routeTree?: RouteTreeNode[]
}>()
const emit = defineEmits<{ updated: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const notify = useNotify()
const roles = useAdminRoles()
const auth = useAuth()

const schema = z.object({
  name: z.string().min(1, t('error.required')),
  description: z.string().optional()
})

type Schema = z.output<typeof schema>

const state = reactive<Schema>({
  name: '',
  description: ''
})

const flatPerms = ref<string[]>([])

const isRoot = computed(() => auth.user.value?.permissions?.includes('*') || auth.user.value?.role === 'root')
const isSystemRole = computed(() => !!props.role?.isSystem)
const permsLocked = computed(() => isSystemRole.value || !isRoot.value)
const lockReason = computed(() => (isSystemRole.value ? t('admin.permsLockedSystem') : t('admin.permsLockedRoot')))
const isOwnRole = computed(() => !!props.role && auth.user.value?.role === props.role.id)
const originalFlatPerms = ref<string[]>([])
const isConfirmOpen = ref(false)

watch(() => props.role, (r) => {
  if (r) {
    state.name = r.name
    state.description = r.description || ''
    flatPerms.value = (r.permissions || []).flatMap(p => p.actions.map(a => `${p.module}.${a}`))
    originalFlatPerms.value = [...flatPerms.value]
  }
}, { immediate: true })

// Self-downgrade: lost permission (route access is derived from permission).
const isDowngrade = computed(() => {
  if (!isOwnRole.value) return false
  const next = new Set(flatPerms.value)
  return originalFlatPerms.value.some(p => !next.has(p) && !next.has('*.*'))
})

const isFullAccess = computed(() => isFullAccessRole(props.role?.permissions))

const loading = ref(false)

async function doSave() {
  if (!props.appId || !props.role) return
  loading.value = true
  try {
    const body: { name: string, description: string, permissions?: ModulePermission[] } = {
      name: state.name,
      description: state.description || ''
    }
    if (!isSystemRole.value && isRoot.value) {
      body.permissions = groupFlatPermissions(flatPerms.value)
        .map(m => ({ module: m.module, actions: m.actions as PermissionAction[] }))
    }
    await roles.updateRole(props.appId, props.role.id, body)
    notify.success(t('admin.roleUpdated'))
    open.value = false
    emit('updated')
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    loading.value = false
  }
}

async function onSubmit() {
  if (isDowngrade.value) {
    isConfirmOpen.value = true
    return
  }
  await doSave()
}
</script>

<template>
  <BaseFormModal v-model:open="open" :title="t('admin.editRole')" :description="role?.id" :schema="schema"
    :state="state" :loading="loading" :submit-label="t('common.save')" @submit="onSubmit">
    <UFormField :label="t('common.name')" name="name" required>
      <UInput v-model="state.name" class="w-full" :disabled="role?.isSystem" />
    </UFormField>
    <UFormField :label="t('common.description')" name="description">
      <UInput v-model="state.description" class="w-full" />
    </UFormField>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <label class="text-xs font-semibold uppercase tracking-wider text-muted">{{ t('admin.permissions.title')
          }}</label>
        <div class="flex items-center gap-1.5">
          <UBadge v-if="isOwnRole" :label="t('admin.ownRole')" color="info" variant="subtle" size="xs"
            icon="i-lucide-user" />
          <UBadge v-if="isFullAccess" :label="t('admin.fullAccess')" color="success" variant="subtle" size="xs"
            icon="i-lucide-crown" />
        </div>
      </div>
      <p class="text-xs text-dimmed">{{ t('admin.actionsHelp') }}</p>
      <p v-if="permsLocked && !isFullAccess" class="text-xs text-warning">{{ lockReason }}</p>
      <div v-if="isFullAccess" class="border border-success/30 bg-success/5 rounded-lg p-3 text-sm text-highlighted">
        {{ t('admin.fullAccess') }} — {{ t('admin.allRoutes') }}
      </div>
      <RolesPermissionSelector v-else v-model="flatPerms" :disabled="permsLocked" />
    </div>

    <UFormField :label="t('admin.accessibleRoutes')" name="accessibleRoutes">
      <RolesAccessibleRoutesPreview :permissions="flatPerms" :tree="routeTree" />
    </UFormField>

    <div v-if="role?.isSystem" class="text-xs text-warning">
      {{ t('admin.cannotDeleteSystem') }}
    </div>

    <BaseConfirmModal v-model:open="isConfirmOpen" :title="t('admin.selfDowngradeTitle')"
      :description="t('admin.selfDowngradeDesc')" color="warning" icon="i-lucide-triangle-alert"
      :confirm-label="t('common.save')" :cancel-label="t('common.cancel')" :loading="loading" @confirm="doSave" />
  </BaseFormModal>
</template>
