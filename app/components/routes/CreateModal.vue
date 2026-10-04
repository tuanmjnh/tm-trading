<script setup lang="ts">
import * as z from 'zod'
import type { SystemRoute } from '~~/types'
import { getErrorMessage } from '~/shared/utils/errors'
import { MODULE_DEFINITIONS } from '#shared/rbac'

const props = defineProps<{
  appId: string
  routes: SystemRoute[]
  /** Prefill source for the row "Copy" action (nuxt4-cms duplicate pattern). */
  initialData?: Partial<Pick<Schema, 'id' | 'path' | 'name' | 'label' | 'icon' | 'sort' | 'isVisible' | 'parentId' | 'requiredPermission'>> | null
}>()
const emit = defineEmits<{ created: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const notify = useNotify()
const routesAdmin = useAdminRoutes()
const { translateRouteLabel } = useNavMenu()

// Reka UI SelectItem forbids empty-string values — use a sentinel for "no parent".
const NO_PARENT = '__none__'
const NO_PERMISSION = '__none_perm__'

const schema = z.object({
  id: z.string().min(1, t('error.required')),
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
  id: '',
  path: '/',
  name: '',
  label: '',
  icon: 'i-lucide-circle',
  sort: 0,
  isVisible: true,
  parentId: '',
  requiredPermission: ''
})

// Target app can differ from the page's app — parent options must follow the selected app
const selectedApp = ref(props.appId)
const appRoutes = ref<SystemRoute[]>([])
const effRoutes = computed(() => selectedApp.value === props.appId ? props.routes : appRoutes.value)

const loadRoutes = async (appId: string) => {
  const res = await adminFetch<{ success: boolean, data: { routes: SystemRoute[] } }>(
    `/api/v1/apps/${encodeURIComponent(appId)}/routes`
  )
  appRoutes.value = res.data?.routes || []
}

watch(open, (v) => {
  if (v) {
    selectedApp.value = props.appId
    appRoutes.value = []
    const d = props.initialData
    state.id = d?.id ?? ''
    state.path = d?.path ?? '/'
    state.name = d?.name ?? ''
    state.label = d?.label ?? ''
    state.icon = d?.icon ?? 'i-lucide-circle'
    state.sort = d?.sort ?? props.routes.length
    state.isVisible = d?.isVisible ?? true
    state.parentId = d?.parentId ?? ''
    state.requiredPermission = d?.requiredPermission ?? ''
  }
})

watch(selectedApp, async (v) => {
  if (!v || v === props.appId) {
    appRoutes.value = []
    return
  }
  try {
    await loadRoutes(v)
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
})

const parentOptions = computed(() => [
  { label: t('routes.noParent'), value: NO_PARENT },
  ...effRoutes.value.map(r => ({ label: translateRouteLabel(r.label, r.name), value: r.id }))
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
  if (!selectedApp.value) return
  loading.value = true
  try {
    await routesAdmin.createRoute(selectedApp.value, {
      id: state.id,
      path: state.path,
      name: state.name,
      label: state.label || state.name,
      icon: state.icon || 'i-lucide-circle',
      sort: state.sort,
      isVisible: state.isVisible,
      parentId: state.parentId || undefined,
      requiredPermission: state.requiredPermission || undefined
    })
    notify.success(t('routes.created'))
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
  <BaseFormModal v-model:open="open" :title="t('routes.new')" :schema="schema" :state="state" :loading="loading"
    :submit-label="t('common.create')" @submit="onSubmit">
    <UFormField :label="t('common.selectApp')" name="app" required>
      <AdminAppSelectField v-model="selectedApp" />
    </UFormField>
    <UFormField :label="t('routes.id')" name="id" required>
      <UInput v-model="state.id" class="w-full" placeholder="home" />
    </UFormField>
    <UFormField :label="t('routes.path')" name="path" required>
      <UInput v-model="state.path" class="w-full" placeholder="/" />
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
