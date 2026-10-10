<script setup lang="ts">
import * as z from 'zod'
import { groupFlatPermissions } from '#shared/rbac'
import type { ModulePermission, PermissionAction, RouteTreeNode } from '~/types/rbac'
import { getErrorMessage } from '~/shared/utils/errors'

const props = defineProps<{
  appId: string
  routes: RouteTreeNode[]
  routeTree?: RouteTreeNode[]
  /** Prefill source for duplicate/copy role action */
  initialData?: { name?: string, description?: string, permissions?: string[] } | null
}>()
const emit = defineEmits<{ created: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const notify = useNotify()
const roles = useAdminRoles()

const schema = z.object({
  name: z.string().min(1, t('error.required')),
  description: z.string().optional(),
  permissions: z.array(z.string()).min(1, t('error.required'))
})

type Schema = z.output<typeof schema>

const state = reactive<Schema>({
  name: '',
  description: '',
  permissions: []
})

watch(open, (v) => {
  if (v) {
    const d = props.initialData
    state.name = d?.name ?? ''
    state.description = d?.description ?? ''
    state.permissions = d?.permissions ? [...d.permissions] : []
  }
})

const loading = ref(false)

async function onSubmit() {
  if (!props.appId) {
    notify.error(t('error.missingAppId'))
    return
  }
  if (!state.permissions.length) {
    notify.error(t('error.required'))
    return
  }
  loading.value = true
  try {
    const permissions: ModulePermission[] = groupFlatPermissions(state.permissions)
      .map(m => ({ module: m.module, actions: m.actions as PermissionAction[] }))
    await roles.createRole(props.appId, {
      name: state.name,
      description: state.description || '',
      permissions
    })
    notify.success(t('admin.roleCreated'))
    open.value = false
    emit('created')
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <BaseFormModal v-model:open="open" :title="t('admin.addRole')" :schema="schema" :state="state" :loading="loading"
    :submit-label="t('common.create')" @submit="onSubmit">
    <UFormField :label="t('common.name')" name="name" required>
      <UInput v-model="state.name" class="w-full" />
    </UFormField>
    <UFormField :label="t('common.description')" name="description">
      <UInput v-model="state.description" class="w-full" />
    </UFormField>

    <UFormField :label="t('admin.permissions.title')" name="permissions" required :help="t('admin.actionsHelp')">
      <RolesPermissionSelector v-model="state.permissions" />
    </UFormField>

    <UFormField :label="t('admin.accessibleRoutes')" name="accessibleRoutes">
      <RolesAccessibleRoutesPreview :permissions="state.permissions" :tree="props.routeTree" />
    </UFormField>
  </BaseFormModal>
</template>
