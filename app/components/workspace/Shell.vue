<script setup lang="ts">
import type { Component } from 'vue'

// =============================================================================
//  Workspace shell (V4.2 §1 / §10.3) — one top-level route, N tab panels.
//  The shell owns the workspace title + tab strip; each tab renders an EXISTING
//  page component (imported directly) which keeps its own BasePage chrome, so
//  there is exactly one panel/header on screen and no page was rewritten.
//  Tab selection lives in the query string (`?tab=…`) so a workspace tab is a
//  shareable deep link; the reused leaves stay routable for legacy deep links.
// =============================================================================
const props = defineProps<{
  /** Workspace i18n namespace exposing `title` and `tabs.<key>`. */
  namespace: string
  /** Tabs in display order; the first one is the default. `key` is also the `?tab=` value. */
  tabs: { key: string, icon: string, component: Component }[]
  /** Query param carrying the active tab (default: `tab`). */
  queryKey?: string
}>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const queryKey = computed(() => props.queryKey ?? 'tab')
const keys = computed(() => props.tabs.map(tab => tab.key))
const fallback = computed(() => props.tabs[0]?.key ?? '')

const active = computed(() => {
  const raw = route.query[queryKey.value]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && keys.value.includes(value) ? value : fallback.value
})

const activeComponent = computed(() => props.tabs.find(tab => tab.key === active.value)?.component)

const items = computed(() => props.tabs.map(tab => ({
  value: tab.key,
  label: t(`${props.namespace}.tabs.${tab.key}`),
  icon: tab.icon
})))

function onSelect(value: string | number) {
  const next = String(value)
  const query: Record<string, string> = {}
  for (const [key, val] of Object.entries(route.query)) {
    if (key !== queryKey.value && typeof val === 'string') query[key] = val
  }
  if (next !== fallback.value) query[queryKey.value] = next
  router.replace({ query })
}

// The active page sets `useHead` after this shell, so its own title wins.
useHead({ title: t(`${props.namespace}.title`) })
</script>

<template>
  <div class="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
    <div
      class="shrink-0 flex items-center gap-3 border-b border-default bg-elevated/50 backdrop-blur-md px-4 sm:px-6 py-1.5 overflow-x-auto">
      <span class="hidden sm:inline text-xs font-semibold uppercase tracking-wide text-dimmed shrink-0">
        {{ t(`${namespace}.title`) }}
      </span>
      <UTabs
        :model-value="active"
        :items="items"
        :content="false"
        size="sm"
        class="w-full sm:w-auto"
        @update:model-value="onSelect"
      />
    </div>
    <component :is="activeComponent" class="flex-1 min-h-0" />
  </div>
</template>
