<script setup lang="ts">
import type { App } from '~~/types'
import { useModuleExport, buildExportChildren } from '~/composables/admin/useModuleExport'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ app: App | null }>()
const emit = defineEmits<{
  (e: 'edit', app: App): void
  (e: 'logs', app: App): void
  (e: 'config', app: App): void
}>()

const { t } = useI18n()
const notify = useNotify()
const auth = useAuth()
const revealed = ref(false)
const { exporting: exportingDetail, exportModule: exportAppDetail } = useModuleExport()

watch(() => props.app, () => {
  revealed.value = false
})

// Links to 3 sub-admin pages (features/permissions/import) -
// previously orphaned routes without UI entry points.
// Cross-module page (ARCHITECTURE §7): hide links based on module permissions -
// backend API guards independently; this is UI gating.
const manageLinks = computed(() => {
  const app = props.app
  if (!app) return []
  const links = [
    { key: 'features', to: `/administration/apps/${app.id}/features`, icon: 'i-lucide-sliders-horizontal', label: t('features.title'), capability: undefined as string | undefined },
    { key: 'permissions', to: `/administration/apps/${app.id}/permissions`, icon: 'i-lucide-shield-check', label: t('admin.permissions.title'), capability: 'permissions.read' as string | undefined },
    { key: 'import', to: `/administration/apps/${app.id}/import`, icon: 'i-lucide-file-input', label: t('import.title'), capability: 'imports.read' as string | undefined },
    { key: 'export', to: `/administration/apps/${app.id}/export`, icon: 'i-lucide-file-down', label: t('admin.export.title'), capability: undefined as string | undefined }
  ]
  return links.filter(l => !l.capability || auth.hasPermission(l.capability))
})

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notify.success(t('common.copied'))
  } catch {
    notify.error(t('common.error'))
  }
}

const overflowMenuItems = computed(() => {
  const app = props.app
  if (!app) return []
  const editGroup = [
    { label: t('common.edit'), icon: 'i-lucide-pencil', onSelect: () => emit('edit', app) },
    { label: t('common.viewLogs'), icon: 'i-lucide-scroll-text', onSelect: () => emit('logs', app) },
    ...(auth.hasPermission('configs.read')
      ? [{ label: t('configs.title'), icon: 'i-lucide-settings-2', onSelect: () => emit('config', app) }]
      : [])
  ]
  // Export includes base info + configs of viewed app (module 'app-detail');
  // download file is prefixed with appId.
  const exportGroup = [
    ...(auth.hasPermission('configs.export')
      ? [{
          label: t('admin.export.action'),
          icon: 'i-lucide-file-down',
          disabled: exportingDetail.value,
          children: buildExportChildren(t, fmt => exportAppDetail(app.id, 'app-detail', fmt))
        }]
      : [])
  ]
  return exportGroup.length ? [editGroup, exportGroup] : [editGroup]
})

const rows = computed(() => {
  const app = props.app
  if (!app) return []
  return [
    { key: 'id', label: t('apps.appId'), value: app.id, mono: true, copy: true },
    { key: 'name', label: t('common.name'), value: app.name },
    { key: 'description', label: t('common.description'), value: app.description || '—' },
    { key: 'createdAt', label: t('apps.initial'), value: formatDate(app.createdAt) || '—' },
    { key: 'updatedAt', label: t('common.updatedAt'), value: formatDate(app.updatedAt) || '—' }
  ]
})
</script>

<template>
  <BaseResponsiveSlideover v-model:open="open" :title="app?.name || t('apps.title')" :description="app?.id"
    icon="i-lucide-boxes" :ui="{ content: 'w-screen max-w-xl' }">
    <template #header-right>
      <div class="flex items-center gap-1">
        <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" :aria-label="t('apps.appId')"
          @click="app && copyText(app.id)" />
        <UButton icon="i-lucide-key-round" color="neutral" variant="ghost" size="xs" :aria-label="t('apps.secretKey')"
          @click="app && copyText(app.secretKey)" />
        <UDropdownMenu v-if="app" :items="overflowMenuItems" :popper="{ placement: 'bottom-end' }">
          <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs"
            :aria-label="t('common.actions')" />
        </UDropdownMenu>
      </div>
    </template>

    <template #body>
      <div v-if="app" class="space-y-5">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge :label="app.isActive ? t('apps.active') : t('apps.inactive')"
            :color="app.isActive ? 'success' : 'neutral'" variant="subtle" size="sm" />
          <UBadge v-if="app.isPinned" :label="t('apps.pinned')" color="warning" variant="subtle" size="sm"
            icon="i-lucide-pin" />
          <UBadge v-if="app.isSystem" :label="t('apps.system')" color="info" variant="subtle" size="sm"
            icon="i-lucide-shield" />
        </div>

        <div class="rounded-xl border border-default bg-default/30 p-4 space-y-3">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ t('apps.appId') }}</span>
              <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs" @click="copyText(app.id)" />
            </div>
            <code class="block text-sm font-mono text-primary bg-primary/10 px-2.5 py-2 rounded-lg break-all">
              {{ app.id }}
            </code>
          </div>

          <div class="space-y-1.5 pt-2 border-t border-default">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ t('apps.secretKey') }}</span>
              <div class="flex items-center gap-0.5">
                <UButton :icon="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'" color="neutral" variant="ghost"
                  size="xs" @click="revealed = !revealed" />
                <UButton icon="i-lucide-copy" color="neutral" variant="ghost" size="xs"
                  @click="copyText(app.secretKey)" />
              </div>
            </div>
            <code class="block text-sm font-mono text-highlighted bg-elevated px-2.5 py-2 rounded-lg break-all">
              {{ revealed ? app.secretKey : maskSecretKey(app.secretKey) }}
            </code>
          </div>
        </div>

        <div class="rounded-xl border border-default bg-default/30 divide-y divide-default">
          <div v-for="row in rows" :key="row.key" class="flex items-start gap-4 px-4 py-3">
            <span class="w-28 shrink-0 text-xs text-muted">{{ row.label }}</span>
            <span class="flex-1 min-w-0 text-sm text-highlighted warp-break-words"
              :class="row.mono ? 'font-mono text-primary' : ''">
              {{ row.value }}
            </span>
            <UButton v-if="row.copy && row.value" icon="i-lucide-copy" color="neutral" variant="ghost" size="xs"
              @click="copyText(String(row.value))" />
          </div>
        </div>

        <div v-if="manageLinks.length" class="space-y-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ t('common.actions') }}</span>
          <div class="flex flex-wrap gap-2">
            <UButton v-for="link in manageLinks" :key="link.key" :to="link.to" :icon="link.icon" :label="link.label"
              color="neutral" variant="soft" size="sm" @click="open = false" />
          </div>
        </div>

        <div v-if="app.allowedOrigins?.length" class="space-y-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ t('apps.allowedOrigins') }}</span>
          <div class="flex flex-wrap gap-1.5">
            <UBadge v-for="origin in app.allowedOrigins" :key="origin" :label="origin" color="info" variant="subtle"
              size="sm" class="font-mono" />
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full gap-2">
        <UButton v-if="app" icon="i-lucide-scroll-text" :label="t('common.viewLogs')" color="neutral" variant="soft"
          size="sm" @click="emit('logs', app)" />
        <div class="flex items-center gap-2">
          <UButton :label="t('common.close')" color="neutral" variant="ghost" size="sm" @click="open = false" />
          <UButton v-if="app" icon="i-lucide-pencil" :label="t('common.edit')" color="primary" variant="soft" size="sm"
            @click="emit('edit', app)" />
        </div>
      </div>
    </template>
  </BaseResponsiveSlideover>
</template>
