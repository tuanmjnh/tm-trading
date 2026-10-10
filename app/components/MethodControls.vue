<script setup lang="ts">
// =============================================================================
//  MethodControls (S8 / roadmap 7T) — method registry browser.
//
//  Reads the engine method plugins (engine/methods/*) through the same
//  registry the backtest uses: import all.mjs for its side effect, then
//  listMethods()/getMethod(). Display + selection only — the selection is
//  shared via v-model so other panels (Positions) can filter by method.
//  Engine methods are dependency-free ESM (ta.mjs, simulate.mjs) so they
//  bundle into the app without Node builtins.
// =============================================================================
import '../../engine/methods/all.mjs'
import { getMethod, listMethods, type MethodMeta } from '../../engine/methods/index.mjs'
import { methodParamEntries } from '../utils/terminal'

const { t, te } = useI18n()

const active = defineModel<string>({ default: '' })

const methods = listMethods().map((id) => getMethod(id))

/** i18n label when the id is known, otherwise the raw id (future methods). */
const labelOf = (m: MethodMeta): string =>
  te(`trade.methodNames.${m.id}`) ? t(`trade.methodNames.${m.id}`) : m.id

const toggle = (id: string): void => {
  active.value = active.value === id ? '' : id
}

const selected = computed<MethodMeta | null>(() =>
  active.value ? methods.find((m) => m.id === active.value) ?? null : null
)
const selectedParams = computed<Array<[string, string]>>(() =>
  selected.value ? methodParamEntries(selected.value.defaults, 10) : []
)
</script>

<template>
  <div class="flex flex-col gap-2 rounded-lg bg-default ring ring-default p-3">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-semibold">{{ t('trade.methods') }}</h3>
      <span class="text-[10px] text-muted">{{ methods.length }}</span>
    </div>

    <div
      v-if="methods.length"
      class="flex flex-wrap gap-1.5"
      role="group"
      :aria-label="t('trade.methods')"
    >
      <UButton
        v-for="m in methods"
        :key="m.id"
        size="xs"
        :color="active === m.id ? 'primary' : 'neutral'"
        :variant="active === m.id ? 'soft' : 'ghost'"
        :aria-pressed="active === m.id"
        :title="m.name"
        @click="toggle(m.id)"
      >
        {{ labelOf(m) }}
      </UButton>
    </div>
    <p v-else class="py-2 text-xs text-muted">{{ t('trade.methodsEmpty') }}</p>

    <p class="text-[10px] text-muted">{{ t('trade.methodsHint') }}</p>

    <!-- Selected method: engine defaults (read-only, D1 — engine owns params). -->
    <div v-if="selected" class="flex flex-col gap-1 border-t border-default pt-2">
      <div class="flex items-baseline justify-between">
        <span class="text-xs font-medium text-muted">{{ t('trade.methodParams') }}</span>
        <span class="font-mono text-[10px] text-muted">{{ selected.id }}</span>
      </div>
      <dl class="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <template v-for="[key, value] in selectedParams" :key="key">
          <dt class="truncate text-[10px] text-muted" :title="key">{{ key }}</dt>
          <dd class="text-right font-mono text-[10px] text-default/90">{{ value }}</dd>
        </template>
      </dl>
    </div>
  </div>
</template>
