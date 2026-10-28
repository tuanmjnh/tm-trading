<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { getErrorMessage } from '~/shared/utils/errors'
import type { MethodMeta } from '#shared/types/methods'
import type { BotExecutionConfig } from '#shared/types/bots'
import type { SymbolRow } from '~/components/trading/SymbolSearchModal.vue'
interface LaunchPrefill {
  profileId?: string
  name?: string
  symbol?: string
  timeframe?: string
  initialCapital?: number
  paramOverrides?: Record<string, number | boolean | string>
  execution?: BotExecutionConfig | null
}

/**
 * One-shot bot launcher (UI): pick a pine-derived METHOD + symbol (+ optional
 * param overrides), then the API wires strategy version -> profile -> instance
 * and enqueues the durable `start` command for the supervisor worker.
 */
const props = defineProps<{ open: boolean, /** Pre-filled from a cloned bot/profile. */ prefill?: LaunchPrefill | null }>()

const emit = defineEmits<{ (e: 'launched', instanceId: string): void }>()

const open = defineModel<boolean>('open', { default: false })

const notify = useNotify()

const methods = ref<MethodMeta[]>([])
const loadingMethods = ref(false)
const launching = ref(false)

const method = ref('')
const symbol = ref('BTCUSDT.P')
const timeframe = ref('15')
const paramValues = ref<Record<string, number | boolean | string>>({})
// Per-bot stop management (risk section of the launch form).
const slBreakevenOn = ref(false)
const slTriggerR = ref(1)
const slTrailOn = ref(false)
const slTrailAtrMult = ref(1.5)
const name = ref('')
const nameTouched = ref(false)
const initialCapital = ref(10000)
const sizingType = ref<'percentage' | 'fixed_value'>('percentage')
const sizingValue = ref<number>(1)

const { t, te } = useI18n()

/** i18n-backed label/description; unknown params fall back to the raw key. */
function paramLabel(key: string): string {
  const labelKey = `strategyLab.bots.params.${key}.label`
  return te(labelKey) ? t(labelKey) : key
}
function paramDesc(key: string): string | null {
  const descKey = `strategyLab.bots.params.${key}.desc`
  return te(descKey) ? t(descKey) : null
}
function groupLabel(group: string): string {
  return t(`strategyLab.bots.paramGroups.${group}`)
}

/** Reactive form sections generated from the selected method's defaults. */
const paramSections = computed(() => botParamSections(currentDefaults.value ?? {}))

// Symbol search — same configured universe as /trading (catalog + venues).
const pickerOpen = ref(false)
const universeRows = ref<Array<{ symbol: string, base: string, quote: string, type: string, markets: string[] }>>([])
const catalog = useMarketCatalog()

const pickerRows = computed<SymbolRow[]>(() =>
  universeRows.value.map(r => ({
    key: `${r.symbol}|${r.type}`,
    symbol: r.symbol,
    base: r.base,
    quote: r.quote,
    type: r.type,
    markets: r.markets,
    selectable: r.type !== 'index'
  })))

function onPickSymbol(symbolPicked: string) {
  symbol.value = symbolPicked
  pickerOpen.value = false
}

const TIMEFRAMES = ['1', '5', '15', '30', '60', '240', 'D']

const methodItems = computed(() => methods.value.map(m => ({ label: m.name, value: m.id })))
const currentDefaults = computed(() => methods.value.find(m => m.id === method.value)?.defaults ?? null)

/** Auto name follows the launch config until the user edits the field. */
const autoName = computed(() =>
  method.value && symbol.value.trim() ? `${method.value} · ${symbol.value.trim().toUpperCase()} ${tfLabel(timeframe.value)}` : '')

watch([method, symbol, timeframe], () => {
  if (!nameTouched.value) name.value = autoName.value
})

watch(method, (id) => {
  if (applyingPrefill.value) return
  const def = methods.value.find(m => m.id === id)?.defaults
  paramValues.value = { ...(def ?? {}) }
})

/** Clone mode: apply a source bot's config over the defaults. */
async function applyPrefill() {
  const p = props.prefill
  if (!p) return
  applyingPrefill.value = true
  try {
    // Method: recovered from the source profileId prefix (`bot-<method>-…`).
    if (p.profileId) {
      const m = methods.value.find(mm => p.profileId!.startsWith(`bot-${mm.id}-`))
      if (m) method.value = m.id
    }
    if (p.symbol) symbol.value = p.symbol
    if (p.timeframe && TIMEFRAMES.includes(p.timeframe)) timeframe.value = p.timeframe
    if (p.paramOverrides) paramValues.value = { ...(currentDefaults.value ?? {}), ...p.paramOverrides }
    if (p.initialCapital != null && Number.isFinite(p.initialCapital)) initialCapital.value = p.initialCapital
    if (p.execution) {
      slBreakevenOn.value = p.execution.slBreakevenOn === true
      slTriggerR.value = p.execution.slTriggerR ?? 1
      slTrailOn.value = p.execution.slTrailOn === true
      slTrailAtrMult.value = p.execution.slTrailAtrMult ?? 1.5
      if (p.execution.sizingType === 'fixed_value' || p.execution.sizingType === 'percentage') {
        sizingType.value = p.execution.sizingType
      }
      if (Number.isFinite(p.execution.sizingValue) && Number(p.execution.sizingValue) > 0) {
        sizingValue.value = Number(p.execution.sizingValue)
      }
    }
    if (p.name) { name.value = p.name; nameTouched.value = true }
    await nextTick()
  } finally {
    applyingPrefill.value = false
  }
}

const applyingPrefill = ref(false)

watch(open, async (value) => {
  if (!value) return
  nameTouched.value = false
  slBreakevenOn.value = false
  slTriggerR.value = 1
  slTrailOn.value = false
  slTrailAtrMult.value = 1.5
  initialCapital.value = 10000
  sizingType.value = 'percentage'
  sizingValue.value = 1
  if (!universeRows.value.length) {
    const res = await catalog.universe().catch(() => null)
    universeRows.value = res?.rows ?? []
  }
  if (!methods.value.length) {
    loadingMethods.value = true
    try {
      const res = await $fetch<{ success: boolean, data: { methods: MethodMeta[] } }>('/api/v1/methods')
      methods.value = res.data?.methods ?? []
    } catch (err) {
      notify.error(t('strategyLab.bots.launchFailed'), getErrorMessage(err, key => t(key)))
    } finally {
      loadingMethods.value = false
    }
  }
  if (props.prefill) {
    await applyPrefill()
  } else {
    if (!method.value && methods.value[0]) {
      method.value = methods.value[0].id
      paramValues.value = { ...(methods.value[0].defaults ?? {}) }
    }
    if (!nameTouched.value) name.value = autoName.value
  }
})

const canLaunch = computed(() => Boolean(method.value && symbol.value.trim() && !launching.value))

async function launch() {
  if (!canLaunch.value) return
  const parsed: Record<string, unknown> = { ...paramValues.value }
  launching.value = true
  try {
      const res = await $fetch<{ success: boolean, data: { instanceId: string, commandEnqueued: boolean } }>(
        '/api/v1/bots/launch',
        {
          method: 'POST',
          body: {
            method: method.value,
            symbol: symbol.value.trim().toUpperCase(),
            timeframe: timeframe.value,
            name: name.value.trim() || undefined,
            initialCapital: Number(initialCapital.value) || 10000,
            params: parsed,
            execution: {
              slBreakevenOn: slBreakevenOn.value,
              slTriggerR: slTriggerR.value,
              slTrailOn: slTrailOn.value,
              slTrailAtrMult: slTrailAtrMult.value,
              sizingType: sizingType.value,
              sizingValue: Number(sizingValue.value) || (sizingType.value === 'fixed_value' ? 500 : 1)
            }
          }
        }
      )
    notify.success(
      t('strategyLab.bots.launched'),
      res.data?.commandEnqueued
        ? t('strategyLab.bots.launchedHint')
        : t('strategyLab.bots.launchedQueued')
    )
    open.value = false
    if (res.data?.instanceId) emit('launched', res.data.instanceId)
  } catch (err) {
    notify.error(t('strategyLab.bots.launchFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    launching.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="t('strategyLab.bots.launchTitle')" :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <div class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('strategyLab.bots.launchName')" class="sm:col-span-2">
            <UInput v-model="name" class="w-full" :placeholder="autoName"
              @update:model-value="value => { nameTouched = String(value ?? '').trim() !== autoName }" />
          </UFormField>
          <UFormField :label="t('strategyLab.bots.launchMethod')">
            <USelectMenu v-model="method" :items="methodItems" value-key="value" label-key="label"
              :loading="loadingMethods" class="w-full" />
          </UFormField>
          <UFormField :label="t('strategyLab.bots.launchSymbol')">
            <div class="flex gap-2">
              <UInput v-model="symbol" class="w-full" placeholder="BTCUSDT.P" />
              <UButton icon="i-lucide-search" color="neutral" variant="soft"
                :aria-label="t('trade.symbolSearch')" :title="t('trade.symbolSearch')"
                @click="pickerOpen = true" />
            </div>
          </UFormField>
          <UFormField :label="t('strategyLab.bots.launchTimeframe')">
            <USelectMenu v-model="timeframe" :items="TIMEFRAMES.map(tf => ({ label: tfLabel(tf), value: tf }))"
              value-key="value" label-key="label" class="w-full" />
          </UFormField>
          <UFormField :label="t('strategyLab.bots.launchInitialCapital')" class="sm:col-span-2"
            :help="t('strategyLab.bots.launchInitialCapitalHint')">
            <UInputNumber v-model="initialCapital" class="w-full" :min="100" :step="1000" />
          </UFormField>
        </div>

        <!-- Method parameters — grouped form (signal / risk / cost), i18n labels
             and an ⓘ description for special params. Unknown params fall back
             to the raw key with a generic editor. -->
        <div v-for="section in paramSections" :key="section.group" class="space-y-2">
          <div class="flex items-center gap-2 border-t border-default pt-2 first:border-t-0 first:pt-0">
            <UIcon
              :name="section.group === 'signal' ? 'i-lucide-activity' : section.group === 'risk' ? 'i-lucide-shield' : 'i-lucide-coins'"
              class="size-3.5 text-muted"
            />
            <span class="text-xs font-semibold text-highlighted">{{ groupLabel(section.group) }}</span>
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <UFormField v-for="item in section.items" :key="item.key" :label="paramLabel(item.key)">
              <div class="flex items-center gap-1.5">
                <USwitch v-if="item.type === 'boolean'" v-model="paramValues[item.key]" />
                <UInputNumber
                  v-else-if="item.type === 'number'"
                  v-model="(paramValues[item.key] as number)"
                  class="w-full"
                  :step="0.1"
                  :min="0"
                />
                <UInput v-else v-model="(paramValues[item.key] as string)" class="w-full" />
                <!-- ⓘ only for curated special params (methodParamsUi.special). -->
                <UTooltip v-if="item.meta?.special && paramDesc(item.key)" :text="paramDesc(item.key)!">
                  <UButton icon="i-lucide-info" color="neutral" variant="ghost" square size="xs"
                    :aria-label="paramLabel(item.key)" :tabindex="-1" />
                </UTooltip>
              </div>
            </UFormField>
          </div>
        </div>

        <!-- Order Sizing Configuration -->
        <div class="space-y-2">
          <div class="flex items-center gap-2 border-t border-default pt-2">
            <UIcon name="i-lucide-calculator" class="size-3.5 text-muted" />
            <span class="text-xs font-semibold text-highlighted">{{ t('strategyLab.bots.sizingSection') }}</span>
          </div>
          <div class="rounded border border-default p-3 space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField :label="t('strategyLab.bots.sizingMode')">
                <USelect
                  v-model="sizingType"
                  class="w-full"
                  :items="[
                    { label: t('strategyLab.bots.sizingPercentage'), value: 'percentage' },
                    { label: t('strategyLab.bots.sizingFixedValue'), value: 'fixed_value' }
                  ]"
                />
              </UFormField>
              <UFormField
                :label="sizingType === 'percentage' ? t('strategyLab.bots.sizingPctLabel') : t('strategyLab.bots.sizingUsdLabel')"
                :help="sizingType === 'percentage' ? t('strategyLab.bots.sizingPctHint') : t('strategyLab.bots.sizingUsdHint')"
              >
                <UInputNumber
                  v-model="sizingValue"
                  class="w-full"
                  :step="sizingType === 'percentage' ? 0.5 : 50"
                  :min="sizingType === 'percentage' ? 0.1 : 1"
                  :max="sizingType === 'percentage' ? 100 : 1000000"
                />
              </UFormField>
            </div>
          </div>
        </div>

        <!-- Stop management — per-bot toggles handled by the paper executor. -->
        <div class="space-y-2">
          <div class="flex items-center gap-2 border-t border-default pt-2">
            <UIcon name="i-lucide-crosshair" class="size-3.5 text-muted" />
            <span class="text-xs font-semibold text-highlighted">{{ t('strategyLab.bots.slSection') }}</span>
          </div>
          <div class="rounded border border-default p-3 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">{{ t('strategyLab.bots.slBreakeven') }}</p>
                <p class="text-xs text-muted">{{ t('strategyLab.bots.slBreakevenHint') }}</p>
              </div>
              <USwitch v-model="slBreakevenOn" />
            </div>
            <UFormField v-if="slBreakevenOn" :label="t('strategyLab.bots.slTriggerR')"
              :help="t('strategyLab.bots.slTriggerRHint')" class="max-w-xs">
              <UInputNumber v-model="slTriggerR" class="w-full" :step="0.1" :min="0.1" />
            </UFormField>
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">{{ t('strategyLab.bots.slTrail') }}</p>
                <p class="text-xs text-muted">{{ t('strategyLab.bots.slTrailHint') }}</p>
              </div>
              <USwitch v-model="slTrailOn" />
            </div>
            <UFormField v-if="slTrailOn" :label="t('strategyLab.bots.slTrailAtrMult')"
              :help="t('strategyLab.bots.slTrailAtrMultHint')" class="max-w-xs">
              <UInputNumber v-model="slTrailAtrMult" class="w-full" :step="0.1" :min="0.1" />
            </UFormField>
          </div>
        </div>

        <UAlert color="neutral" variant="subtle" icon="i-lucide-info"
          :description="t('strategyLab.bots.launchWorkerHint')" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton :label="t('common.cancel')" color="neutral" variant="ghost" @click="open = false" />
        <UButton icon="i-lucide-play" :label="t('strategyLab.bots.launchRun')" variant="soft" :loading="launching"
          :disabled="!canLaunch" @click="launch" />
      </div>
    </template>
  </UModal>

  <TradingSymbolSearchModal
    :open="pickerOpen"
    :rows="pickerRows"
    @update:open="pickerOpen = $event"
    @select="onPickSymbol"
  />
</template>
