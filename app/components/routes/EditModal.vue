<script setup lang="ts">
import * as z from 'zod'
import type { SystemRoute } from '~~/types'
import { getErrorMessage } from '~/shared/utils/errors'
import { MODULE_DEFINITIONS } from '#shared/rbac'

const props = defineProps<{ route: SystemRoute | null, appId: string, routes: SystemRoute[] }>()
const emit = defineEmits<{ updated: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const notify = useNotify()
const routesAdmin = useAdminRoutes()
const { translateRouteLabel } = useNavMenu()

// Reka UI SelectItem forbids empty-string values — use a sentinel for "no parent".
const NO_PARENT = '__none__'
const NO_PERMISSION = '__none_perm__'

const schema = z.object({
  path: z.string().min(1, t('error.required')),
  name: z.string().min(1, t('error.required')),
  label: z.string().optional(),
  icon: z.string().optional(),
  sort: z.number().min(0),
  isVisible: z.boolean(),
  parentId: z.string().optional(),
  requiredPermission: z.string().optional()
})

type Schema = z.output<typeof schema>

const state = reactive<Schema>({
  path: '/',
  name: '',
  label: '',
  icon: '',
  sort: 0,
  isVisible: true,
  parentId: '',
  requiredPermission: ''
})

watch(() => props.route, (r) => {
  if (r) {
    state.path = r.path
    state.name = r.name
    state.label = r.label || ''
    state.icon = r.icon || ''
    state.sort = r.sort ?? 0
    state.isVisible = r.isVisible !== false
    state.parentId = r.parentId || ''
    state.requiredPermission = r.requiredPermission || ''
  }
}, { immediate: true })

const parentOptions = computed(() => [
  { label: t('routes.noParent'), value: NO_PARENT },
  ...props.routes
    .filter(r => r.id !== props.route?.id)
    .map(r => ({ label: translateRouteLabel(r.label, r.name), value: r.id }))
])

const parentSelectValue = computed({
  get: () => state.parentId || NO_PARENT,
  set: (v: string) => { state.parentId = v === NO_PARENT ? '' : v }
})

const permissionOptions = computed(() => [
  { label: t('routes.noPermission'), value: NO_PERMISSION },
  ...MODULE_DEFINITIONS.flatMap(m =>
    m.actions.map(a => ({ label: `${m.key}.${a}`, value: `${m.key}.${a}` }))
  )
])

const permissionSelectValue = computed({
  get: () => state.requiredPermission || NO_PERMISSION,
  set: (v: string) => { state.requiredPermission = v === NO_PERMISSION ? '' : v }
})

const labelPreview = computed(() => {
  const raw = state.label || state.name
  if (!raw) return undefined
  const translated = translateRouteLabel(state.label, state.name)
  return translated !== raw ? translated : undefined
})

const loading = ref(false)

async function onSubmit() {
  if (!props.appId || !props.route) return
  loading.value = true
  try {
    await routesAdmin.updateRoute(props.route.id, {
      path: state.path,
      name: state.name,
      label: state.label || state.name,
      icon: state.icon,
      sort: state.sort,
      isVisible: state.isVisible,
      parentId: state.parentId || null,
      requiredPermission: state.requiredPermission || null
    })
    notify.success(t('routes.updated'))
    open.value = false
    emit('updated')
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <BaseFormModal v-model:open="open" :title="t('routes.edit')" :description="route?.id" :schema="schema" :state="state"
    :loading="loading" :submit-label="t('common.save')" @submit="onSubmit">
    <UFormField :label="t('routes.path')" name="path" required>
      <UInput v-model="state.path" class="w-full" />
    </UFormField>
    <UFormField :label="t('routes.name')" name="name" required>
      <UInput v-model="state.name" class="w-full" />
    </UFormField>
    <UFormField :label="t('routes.label')" name="label" :description="labelPreview">
      <UInput v-model="state.label" class="w-full" placeholder="nav.home" />
    </UFormField>
    <UFormField :label="t('routes.icon')" name="icon">
      <InputsIconSelector v-model="state.icon" class="w-full" />
    </UFormField>
    <UFormField :label="t('routes.permission')" name="requiredPermission">
      <USelect v-model="permissionSelectValue" :items="permissionOptions" value-key="value" class="w-full" />
    </UFormField>
    <div class="grid grid-cols-2 gap-3">
      <UFormField :label="t('routes.sort')" name="sort">
        <UInput v-model.number="state.sort" type="number" class="w-full" />
      </UFormField>
      <UFormField :label="t('routes.parent')" name="parentId">
        <USelect v-model="parentSelectValue" :items="parentOptions" value-key="value" class="w-full" />
      </UFormField>
    </div>
    <UFormField name="isVisible">
      <UCheckbox v-model="state.isVisible" :label="t('routes.visible')" />
    </UFormField>
  </BaseFormModal>
</template>
