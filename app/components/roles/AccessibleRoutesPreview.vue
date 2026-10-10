<script setup lang="ts">
import { groupFlatPermissions, computeAccessibleRouteIds, isFullAccessRole } from '#shared/rbac'
import type { RouteTreeNode } from '~/types/rbac'

const props = withDefaults(defineProps<{
  permissions?: string[]
  tree?: RouteTreeNode[]
}>(), {
  permissions: () => [],
  tree: () => []
})

const { t } = useI18n()
const { translateRouteLabel } = useNavMenu()

const open = defineModel<boolean>('open', { default: false })
const search = ref('')

interface FlatPreviewNode {
  id: string
  path: string
  label: string
  name?: string
  requiredPermission?: string | null
  depth: number
}

const flattenTree = (nodes: RouteTreeNode[], depth = 0): FlatPreviewNode[] =>
  (nodes || []).flatMap(node => [
    {
      id: node.id,
      path: node.path,
      label: node.label,
      name: node.name,
      requiredPermission: node.requiredPermission ?? null,
      depth
    },
    ...flattenTree(node.children || [], depth + 1)
  ])

const allNodes = computed(() => flattenTree(props.tree))

const isFullAccess = computed(() => isFullAccessRole(groupFlatPermissions(props.permissions)))

const accessibleIds = computed(() =>
  computeAccessibleRouteIds(
    allNodes.value.map(n => ({ id: n.id, requiredPermission: n.requiredPermission })),
    groupFlatPermissions(props.permissions)
  )
)

const accessibleCount = computed(() =>
  accessibleIds.value.includes('*') ? allNodes.value.length : accessibleIds.value.length
)

const isAccessible = (node: FlatPreviewNode) =>
  isFullAccess.value
  || accessibleIds.value.includes(node.id)
  || !node.requiredPermission

const summaryLabel = computed(() =>
  isFullAccess.value
    ? t('admin.allRoutes')
    : t('admin.routesAccessible', { n: accessibleCount.value })
)

const effectiveCaps = computed(() => (isFullAccess.value ? [] : props.permissions))

const displayNodes = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return allNodes.value
  const visibleIds = new Set<string>()
  const keep = (nodes: RouteTreeNode[]): boolean => {
    let any = false
    for (const n of nodes) {
      const match = (n.label || '').toLowerCase().includes(q)
        || translateRouteLabel(n.label, n.name).toLowerCase().includes(q)
        || (n.name || '').toLowerCase().includes(q)
        || (n.path || '').toLowerCase().includes(q)
      const childKept = n.children?.length ? keep(n.children) : false
      if (match || childKept) {
        visibleIds.add(n.id)
        any = true
      }
    }
    return any
  }
  keep(props.tree)
  return allNodes.value.filter(n => visibleIds.has(n.id))
})
</script>

<template>
  <div class="w-full">
    <UButton type="button" color="neutral" variant="soft" size="sm" class="w-full justify-between gap-2"
      @click="open = true">
      <span class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-route" class="size-4 text-primary shrink-0" />
        <span class="font-medium truncate">{{ t('admin.accessibleRoutes') }}</span>
      </span>
      <span class="flex items-center gap-1.5 shrink-0">
        <UBadge :label="summaryLabel" color="info" variant="subtle" size="xs" />
        <UIcon name="i-lucide-chevron-right" class="size-4 text-muted" />
      </span>
    </UButton>
    <p class="text-[11px] text-dimmed mt-1">{{ t('admin.accessibleRoutesHint') }}</p>

    <BaseResponsiveModal v-model:open="open" :title="t('admin.accessibleRoutes')" :description="summaryLabel"
      icon="i-lucide-route">
      <div class="space-y-3">
        <UInput v-model="search" icon="i-lucide-search" size="sm" class="w-full" :placeholder="t('common.search')" />

        <div class="border border-default rounded-lg divide-y divide-default max-h-[60vh] overflow-y-auto">
          <div v-if="displayNodes.length === 0" class="py-6 text-center text-sm text-muted">
            {{ t('common.no_results') }}
          </div>
          <div v-for="node in displayNodes" :key="node.id" class="flex items-center gap-2 px-3 py-1.5"
            :style="{ paddingLeft: `${12 + node.depth * 14}px` }" :class="isAccessible(node) ? '' : 'opacity-60'">
            <UIcon :name="isAccessible(node) ? 'i-lucide-check' : 'i-lucide-x'" class="size-3.5 shrink-0"
              :class="isAccessible(node) ? 'text-success' : 'text-error'" />
            <span class="text-xs font-medium truncate"
              :class="isAccessible(node) ? 'text-highlighted' : 'text-muted line-through'">
              {{ translateRouteLabel(node.label, node.name) }}
            </span>
            <code class="text-[10px] text-primary bg-primary/10 px-1 rounded shrink-0">{{ node.path }}</code>
            <UBadge v-if="!isAccessible(node) && node.requiredPermission"
              :label="t('admin.requiresPermission', { perm: node.requiredPermission })" color="warning" variant="subtle"
              size="xs" class="ms-auto shrink-0" />
          </div>
        </div>

        <div class="space-y-1.5">
          <span class="text-[11px] font-medium text-muted">{{ t('admin.effectiveAccess') }}</span>
          <div class="border border-default rounded-lg p-3 space-y-3 bg-default/25">
            <div class="space-y-1.5">
              <span class="text-[11px] font-medium text-muted">{{ t('admin.apiCapabilities') }}</span>
              <div class="flex flex-wrap gap-1">
                <UBadge v-if="isFullAccess" :label="t('admin.fullAccess')" color="success" variant="subtle" size="xs"
                  icon="i-lucide-crown" />
                <template v-else-if="effectiveCaps.length">
                  <UBadge v-for="cap in effectiveCaps" :key="cap" :label="cap" color="primary" variant="subtle"
                    size="xs" />
                </template>
                <span v-else class="text-xs text-dimmed">{{ t('admin.noPermissionsHint') }}</span>
              </div>
            </div>
            <div class="space-y-1.5">
              <span class="text-[11px] font-medium text-muted">{{ t('admin.navAccess') }}</span>
              <div class="flex flex-wrap gap-1">
                <UBadge :label="summaryLabel" color="info" variant="subtle" size="xs" icon="i-lucide-route" />
                <UBadge v-if="isFullAccess" :label="t('admin.fullAccess')" color="success" variant="subtle" size="xs" />
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" size="sm" :label="t('common.close')"
            @click="open = false" />
        </div>
      </div>
    </BaseResponsiveModal>
  </div>
</template>
