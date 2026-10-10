<script setup lang="ts">
import { MODULE_DEFINITIONS } from '#shared/rbac'

const props = withDefaults(defineProps<{
  modelValue?: string[]
  disabled?: boolean
}>(), {
  modelValue: () => [],
  disabled: false
})
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const { t } = useI18n()
const search = ref('')

const selected = computed<string[]>({
  get: () => props.modelValue || [],
  set: value => emit('update:modelValue', value)
})

// Satellite apps do not manage platform-level permissions
const satelliteModules = computed(() =>
  MODULE_DEFINITIONS.filter(m => m.key !== 'platform')
)

const totalCount = computed(() =>
  satelliteModules.value.reduce((n, m) => n + m.actions.length, 0)
)

const moduleLabel = (key: string) => {
  const label = t(`admin.modules.${key}`)
  return label === `admin.modules.${key}` ? key : label
}

const actionLabel = (module: string, action: string) => {
  const key = `admin.permDesc.${module}.${action}`
  const label = t(key)
  if (label !== key) return label
  const basicKey = `admin.${action}`
  const basicLabel = t(basicKey)
  if (basicLabel !== basicKey) return basicLabel
  return action.charAt(0).toUpperCase() + action.slice(1)
}

const code = (module: string, action: string) => `${module}.${action}`
const has = (module: string, action: string) => selected.value.includes(code(module, action))

const visibleModules = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return satelliteModules.value.map(m => ({ mod: m, actions: m.actions }))
  const rows: Array<{ mod: typeof MODULE_DEFINITIONS[number], actions: string[] }> = []
  for (const m of satelliteModules.value) {
    const moduleHit = m.key.toLowerCase().includes(q) || moduleLabel(m.key).toLowerCase().includes(q)
    const actions = moduleHit
      ? m.actions
      : m.actions.filter(a =>
        a.toLowerCase().includes(q)
        || code(m.key, a).toLowerCase().includes(q)
        || actionLabel(m.key, a).toLowerCase().includes(q))
    if (actions.length) rows.push({ mod: m, actions })
  }
  return rows
})

const moduleSelected = (moduleKey: string, actions: string[]) =>
  actions.filter(a => has(moduleKey, a)).length

const toggle = (module: string, action: string) => {
  const val = code(module, action)
  const idx = selected.value.indexOf(val)
  const next = [...selected.value]
  if (idx >= 0) next.splice(idx, 1)
  else next.push(val)
  selected.value = next
}

const selectAllModule = (moduleKey: string, actions: string[]) => {
  const next = new Set(selected.value)
  for (const a of actions) next.add(code(moduleKey, a))
  selected.value = Array.from(next)
}

const clearModule = (moduleKey: string, actions: string[]) => {
  const remove = new Set(actions.map(a => code(moduleKey, a)))
  selected.value = selected.value.filter(v => !remove.has(v))
}
</script>

<template>
  <div class="w-full border border-default rounded-lg overflow-hidden">
    <div class="flex items-center gap-2 p-2 border-b border-default bg-default/40">
      <UInput v-model="search" icon="i-lucide-search" size="sm" class="flex-1 min-w-0" :placeholder="t('common.search')"
        :disabled="disabled" />
      <UBadge :label="t('admin.permissionsSelected', { n: selected.length })" color="primary" variant="subtle" size="sm"
        class="shrink-0" />
      <span class="text-[11px] text-muted tabular-nums shrink-0 hidden sm:inline">/ {{ totalCount }}</span>
    </div>

    <div class="max-h-64 overflow-y-auto divide-y divide-default">
      <section v-for="row in visibleModules" :key="row.mod.key" class="px-3 py-2.5">
        <div class="flex items-center justify-between gap-2 mb-2 sticky top-0 bg-default z-10 -mx-3 px-3 py-1.5">
          <span class="text-sm font-semibold text-highlighted">{{ moduleLabel(row.mod.key) }}</span>
          <div class="flex items-center gap-1">
            <span class="text-[11px] text-muted tabular-nums">
              {{ moduleSelected(row.mod.key, row.mod.actions) }} / {{ row.mod.actions.length }}
            </span>
            <template v-if="!disabled">
              <UTooltip :text="t('admin.selectAll')">
                <UButton icon="i-lucide-list-checks" size="xs" color="neutral" variant="ghost" type="button"
                  @click="selectAllModule(row.mod.key, row.mod.actions)" />
              </UTooltip>
              <UTooltip :text="t('admin.clearSelection')">
                <UButton icon="i-lucide-circle-x" size="xs" color="neutral" variant="ghost" type="button"
                  @click="clearModule(row.mod.key, row.mod.actions)" />
              </UTooltip>
            </template>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <UButton v-for="act in row.actions" :key="act" :label="actionLabel(row.mod.key, act)" size="xs" type="button"
            :disabled="disabled" :variant="has(row.mod.key, act) ? 'solid' : 'soft'"
            :color="has(row.mod.key, act) ? 'primary' : 'neutral'" @click="toggle(row.mod.key, act)" />
        </div>
      </section>

      <div v-if="visibleModules.length === 0" class="py-6 text-center text-sm text-muted">
        {{ t('common.no_results') }}
      </div>
    </div>
  </div>
</template>
