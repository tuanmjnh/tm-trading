<script setup lang="ts">
import { useModuleExport, buildExportChildren } from '~/composables/admin/useModuleExport'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'
import { MODULE_DEFINITIONS } from '#shared/rbac'
import { getErrorMessage } from '~/shared/utils/errors'

interface PermissionRow {
  id: string
  code: string
  name: string
  module: string
  description: string | null
  isSystem: boolean
}

const { t } = useI18n()
const notify = useNotify()
const auth = useAuth()
const appsStore = useAppsStore()
const { title, description } = useAdminPageChrome({
  titleKey: 'admin.permissionsTitle',
  descKey: 'admin.permissionsDesc'
})
const { exporting: exportingPermissions, exportModule: exportPermissions } = useModuleExport()

const targetApp = ref('')
const search = ref('')
const items = ref<PermissionRow[]>([])
const loading = ref(false)
const ownPerms = ref<string[]>([])

watchEffect(() => {
  if (!targetApp.value && appsStore.apps.length) {
    targetApp.value = appsStore.activeAppId || appsStore.apps[0]?.id || ''
  }
})

watchEffect(() => {
  ownPerms.value = [...(auth.user.value?.permissions || [])]
})

const hasOwn = (code: string) =>
  ownPerms.value.includes('*') || ownPerms.value.includes(code)

const isPlatformModule = (mod: string) => mod === 'platform'

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(p =>
    p.code.toLowerCase().includes(q)
    || p.module.toLowerCase().includes(q)
    || (p.description || '').toLowerCase().includes(q)
  )
})

const grouped = computed(() => {
  const map = new Map<string, PermissionRow[]>()
  for (const p of filtered.value) {
    const list = map.get(p.module) || []
    list.push(p)
    map.set(p.module, list)
  }
  // sort modules by MODULE_DEFINITIONS order, unknown last
  const order = MODULE_DEFINITIONS.map(m => m.key)
  return Array.from(map.entries()).sort((a, b) => {
    const ia = order.indexOf(a[0])
    const ib = order.indexOf(b[0])
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
})

const moduleLabel = (key: string) => {
  if (isPlatformModule(key)) return t('admin.modules.platform')
  const label = t(`admin.modules.${key}`)
  return label === `admin.modules.${key}` ? key : label
}

const permDesc = (p: PermissionRow) => {
  const key = `admin.permDesc.${p.code}`
  const label = t(key)
  return label === key ? (p.description || p.name) : label
}

const total = computed(() => items.value.length)

async function fetchPermissions() {
  if (!targetApp.value) return
  loading.value = true
  try {
    const res = await adminFetch<{ success: boolean, data: PermissionRow[] }>(
      `/api/v1/apps/${encodeURIComponent(targetApp.value)}/permissions`
    )
    items.value = (res.data || []).map(p => ({ ...p, code: p.code || p.name }))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
    items.value = []
  } finally {
    loading.value = false
  }
}

watch(targetApp, () => fetchPermissions(), { immediate: true })

const mobileBar = useMobileBar()
const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'export',
    icon: 'i-lucide-file-down',
    label: t('admin.export.action'),
    overflow: true,
    disabled: exportingPermissions.value,
    children: buildExportChildren(t, fmt => exportPermissions(targetApp.value, 'permissions', fmt))
  }
])
mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value),
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: fetchPermissions
  }
]))
mobileBar.registerInfo(computed(() => ({
  text: t('admin.permissionsReadOnly'),
  count: filtered.value.length,
  loading: loading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="permissions" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge color="neutral" variant="subtle" :label="`${total} ${t('common.total')}`" />
        <BaseHeaderActions :actions="headerActions" />
        <UButton icon="i-lucide-refresh-cw" variant="soft" size="sm" :loading="loading" @click="fetchPermissions" />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <AdminAppSwitcher v-model="targetApp" />
          </div>
        </template>
        <template #right>
          <UInput v-model="search" icon="i-lucide-search" :placeholder="t('common.search')" size="sm"
            class="w-full sm:w-56" />
        </template>
      </UDashboardToolbar>
    </template>

    <div class="space-y-6 p-4 sm:p-6">
      <div class="flex items-start gap-2 rounded-lg bg-default border border-default p-3 text-sm text-muted">
        <UIcon name="i-lucide-lock" class="size-4 mt-0.5 shrink-0" />
        <p>{{ t('admin.permissionsReadOnly') }}</p>
      </div>

      <AdminEmptyState v-if="!loading && !grouped.length" :title="t('common.no_results')" />

      <div v-for="[mod, rows] in grouped" :key="mod" class="space-y-3">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-highlighted">{{ moduleLabel(mod) }}</h3>
          <UBadge :color="isPlatformModule(mod) ? 'warning' : 'neutral'" variant="subtle" size="sm"
            :label="isPlatformModule(mod) ? t('admin.platformOnly') : `${rows.length}`" />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <div v-for="p in rows" :key="p.code"
            class="flex items-start justify-between gap-2 rounded-lg border border-default bg-default p-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <code class="text-xs font-mono text-highlighted truncate">{{ p.code }}</code>
                <UIcon v-if="p.isSystem" name="i-lucide-shield-check" class="size-3.5 text-success shrink-0"
                  :aria-label="t('admin.system')" />
              </div>
              <p v-if="p.description" class="text-xs text-muted mt-1 line-clamp-2">{{ permDesc(p) }}</p>
              <p v-else class="text-xs text-muted mt-1">{{ p.name }}</p>
            </div>
            <UBadge v-if="hasOwn(p.code)" color="success" variant="subtle" size="sm"
              :label="t('admin.ownGrant')" />
          </div>
        </div>
      </div>
    </div>
  </BasePage>
</template>
