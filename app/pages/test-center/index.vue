<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
import type { MethodMeta } from '~~/types/methods'
import type { ReplaySummary } from '~~/types/replay'
import type { TestRunResult } from '~~/types/runs'
import type { StrategyProfile, StrategyVersion } from '~~/types/strategy'

// Test Builder (roadmap §58.9 Slice 3). One page, three launch modes backed by
// real contracts: BACKTEST -> POST /api/v1/runs (engine runOne + D1 stamp),
// REPLAY -> POST /api/v1/replay/sessions, LIVE_PAPER -> POST .../activate-paper.
// Every result deep-links into the page that monitors it; nothing is faked.
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'testCenter.builder.title',
  descKey: 'testCenter.builder.desc'
})

const testRuns = useTestRuns()
const replayApi = useReplay()
const strategiesApi = useStrategies()

type Mode = 'backtest' | 'replay' | 'paper'
const mode = ref<Mode>('backtest')
const submitting = ref(false)

const TF_OPTIONS = ['5m', '15m', '30m', '1h', '4h']
const INTERVAL_OPTIONS = ['1m', '5m', '15m', '1h']
const PAPER_READY = ['paper', 'stable_paper']

// --- BACKTEST form ---
const methods = ref<string[]>([])
const backtest = reactive({
  method: 'vsa',
  symbol: 'BTCUSDT',
  tf: '15m',
  market: 'fapi' as 'fapi' | 'spot',
  limit: 5000
})

// --- REPLAY form ---
const replay = reactive({
  symbol: 'BTCUSDT',
  interval: '15m',
  market: 'futures' as 'spot' | 'futures',
  limit: 300
})

// --- LIVE_PAPER selection ---
const profiles = ref<StrategyProfile[]>([])
const versions = ref<StrategyVersion[]>([])
const selectedProfile = ref<string | null>(null)
const selectedVersion = ref<string | null>(null)
const loadingVersions = ref(false)

// --- results ---
const runResult = ref<TestRunResult | null>(null)
const replayResult = ref<ReplaySummary | null>(null)
const paperResult = ref<{ profileId: string; strategyVersionId: string } | null>(null)

interface RunStats {
  runs?: number
  trades?: number
  winRate?: number
  profitFactor?: number | null
  netPct?: number
  maxDrawdownPct?: number
  expectancy?: number
}
const stats = computed<RunStats>(() => (runResult.value?.stats ?? {}) as RunStats)

async function loadMethods() {
  try {
    const res = await $fetch<{ success: boolean; data: { methods: MethodMeta[] } }>('/api/v1/methods')
    methods.value = (res.data?.methods ?? []).map(m => m.id)
    if (methods.value.length && !methods.value.includes(backtest.method)) backtest.method = methods.value[0]!
  } catch {
    methods.value = []
  }
}

async function loadProfiles() {
  profiles.value = await strategiesApi.list()
}

async function selectProfile(id: string) {
  selectedProfile.value = id
  selectedVersion.value = null
  loadingVersions.value = true
  try {
    versions.value = await strategiesApi.versions(id)
  } finally {
    loadingVersions.value = false
  }
}

onMounted(() => {
  void loadMethods()
  void loadProfiles()
})

function resetResults() {
  runResult.value = null
  replayResult.value = null
  paperResult.value = null
}

async function submitBacktest() {
  submitting.value = true
  resetResults()
  try {
    runResult.value = await testRuns.backtest({
      method: backtest.method,
      symbol: backtest.symbol,
      tf: backtest.tf,
      market: backtest.market,
      limit: backtest.limit
    })
    notify.success(t('testCenter.builder.title'), t('testCenter.builder.started'))
  } catch (err) {
    notify.error(t('testCenter.builder.failed'), getErrorMessage(err, key => t(key)))
  } finally {
    submitting.value = false
  }
}

async function submitReplay() {
  submitting.value = true
  resetResults()
  try {
    replayResult.value = await replayApi.create({
      symbol: replay.symbol,
      interval: replay.interval,
      market: replay.market,
      limit: replay.limit
    })
    notify.success(t('testCenter.builder.title'), t('testCenter.builder.started'))
  } catch (err) {
    notify.error(t('testCenter.builder.failed'), getErrorMessage(err, key => t(key)))
  } finally {
    submitting.value = false
  }
}

async function submitPaper() {
  if (!selectedProfile.value || !selectedVersion.value) return
  submitting.value = true
  resetResults()
  try {
    paperResult.value = await strategiesApi.activatePaper(selectedProfile.value, selectedVersion.value)
    notify.success(t('testCenter.builder.title'), t('testCenter.builder.started'))
  } catch (err) {
    notify.error(t('testCenter.builder.failed'), getErrorMessage(err, key => t(key)))
  } finally {
    submitting.value = false
  }
}

function submit() {
  if (submitting.value) return
  if (mode.value === 'backtest') void submitBacktest()
  else if (mode.value === 'replay') void submitReplay()
  else void submitPaper()
}

const runLink = computed(() =>
  runResult.value ? `/test-center/runs/${encodeURIComponent(runResult.value.seriesId)}` : null
)

const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
const fmtNum = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—'
const fmtPf = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Number.isFinite(v) ? v.toFixed(2) : '∞')
const netColor = (v: number | undefined) => (typeof v === 'number' && v > 0 ? 'text-success' : typeof v === 'number' && v < 0 ? 'text-error' : 'text-muted')

const trail = computed(() => [
  { label: t('nav.test_center') },
  { label: t('testCenter.builder.title') }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-play', label: t('testCenter.builder.run'), onSelect: submit }
]))

useHead({ title })
</script>

<template>
  <BasePage id="lab-new" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('testCenter.pips.builder')" />
    </template>

    <template #right>
      <UButton
        icon="i-lucide-play"
        :label="t('testCenter.builder.run')"
        color="primary"
        variant="soft"
        size="sm"
        :loading="submitting"
        @click="submit"
      />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 overflow-y-auto pb-24 lg:pb-6">
      <!-- Mode switch -->
      <div class="flex items-center gap-2 flex-wrap shrink-0">
        <UButton
          icon="i-lucide-flask-conical"
          :label="t('testCenter.builder.backtest')"
          :color="mode === 'backtest' ? 'primary' : 'neutral'"
          :variant="mode === 'backtest' ? 'soft' : 'ghost'"
          size="sm"
          @click="mode = 'backtest'"
        />
        <UButton
          icon="i-lucide-history"
          :label="t('testCenter.builder.replay')"
          :color="mode === 'replay' ? 'primary' : 'neutral'"
          :variant="mode === 'replay' ? 'soft' : 'ghost'"
          size="sm"
          @click="mode = 'replay'"
        />
        <UButton
          icon="i-lucide-fast-forward"
          :label="t('testCenter.builder.paper')"
          :color="mode === 'paper' ? 'primary' : 'neutral'"
          :variant="mode === 'paper' ? 'soft' : 'ghost'"
          size="sm"
          @click="mode = 'paper'"
        />
      </div>

      <!-- BACKTEST -->
      <UCard v-if="mode === 'backtest'" :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-flask-conical" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('testCenter.builder.backtest') }}</h3>
          </div>
        </template>

        <div class="flex flex-col gap-3">
          <p class="text-[11px] text-dimmed">{{ t('testCenter.builder.backtestHint') }}</p>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-medium text-muted uppercase tracking-wider">{{ t('testCenter.builder.method') }}</span>
            <div v-if="methods.length" class="flex items-center gap-1.5 flex-wrap">
              <UButton
                v-for="m in methods"
                :key="m"
                :label="m"
                size="xs"
                :color="backtest.method === m ? 'primary' : 'neutral'"
                :variant="backtest.method === m ? 'soft' : 'outline'"
                @click="backtest.method = m"
              />
            </div>
            <span v-else class="text-[11px] text-dimmed">{{ t('strategyLab.methods.empty') }}</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField :label="t('testCenter.builder.symbol')">
              <UInput v-model="backtest.symbol" class="w-full" />
            </UFormField>
            <UFormField :label="t('testCenter.builder.limit')">
              <UInput v-model.number="backtest.limit" type="number" :min="1" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-medium text-muted uppercase tracking-wider">{{ t('testCenter.builder.timeframe') }}</span>
            <div class="flex items-center gap-1.5 flex-wrap">
              <UButton
                v-for="tf in TF_OPTIONS"
                :key="tf"
                :label="tf"
                size="xs"
                :color="backtest.tf === tf ? 'primary' : 'neutral'"
                :variant="backtest.tf === tf ? 'soft' : 'outline'"
                @click="backtest.tf = tf"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-medium text-muted uppercase tracking-wider">{{ t('testCenter.builder.market') }}</span>
            <div class="flex items-center gap-1.5">
              <UButton
                v-for="mk in (['fapi', 'spot'] as const)"
                :key="mk"
                :label="mk"
                size="xs"
                :color="backtest.market === mk ? 'primary' : 'neutral'"
                :variant="backtest.market === mk ? 'soft' : 'outline'"
                @click="backtest.market = mk"
              />
            </div>
          </div>
        </div>
      </UCard>

      <!-- REPLAY -->
      <UCard v-else-if="mode === 'replay'" :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-history" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('testCenter.builder.replay') }}</h3>
          </div>
        </template>

        <div class="flex flex-col gap-3">
          <p class="text-[11px] text-dimmed">{{ t('testCenter.builder.replayHint') }}</p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField :label="t('testCenter.builder.symbol')">
              <UInput v-model="replay.symbol" class="w-full" />
            </UFormField>
            <UFormField :label="t('testCenter.builder.limit')">
              <UInput v-model.number="replay.limit" type="number" :min="1" class="w-full" />
            </UFormField>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-medium text-muted uppercase tracking-wider">{{ t('testCenter.builder.interval') }}</span>
            <div class="flex items-center gap-1.5 flex-wrap">
              <UButton
                v-for="iv in INTERVAL_OPTIONS"
                :key="iv"
                :label="iv"
                size="xs"
                :color="replay.interval === iv ? 'primary' : 'neutral'"
                :variant="replay.interval === iv ? 'soft' : 'outline'"
                @click="replay.interval = iv"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-medium text-muted uppercase tracking-wider">{{ t('testCenter.builder.market') }}</span>
            <div class="flex items-center gap-1.5">
              <UButton
                v-for="mk in (['futures', 'spot'] as const)"
                :key="mk"
                :label="mk"
                size="xs"
                :color="replay.market === mk ? 'primary' : 'neutral'"
                :variant="replay.market === mk ? 'soft' : 'outline'"
                @click="replay.market = mk"
              />
            </div>
          </div>
        </div>
      </UCard>

      <!-- LIVE PAPER -->
      <UCard v-else :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-fast-forward" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('testCenter.builder.paper') }}</h3>
          </div>
        </template>

        <div class="flex flex-col gap-3">
          <p class="text-[11px] text-dimmed">{{ t('testCenter.builder.paperHint') }}</p>

          <div v-if="profiles.length" class="flex flex-col gap-3">
            <div class="flex flex-col gap-1.5">
              <span class="text-[11px] font-medium text-muted uppercase tracking-wider">{{ t('testCenter.builder.profile') }}</span>
              <div class="flex items-center gap-1.5 flex-wrap">
                <UButton
                  v-for="p in profiles"
                  :key="p.profileId"
                  :label="p.name || p.profileId"
                  size="xs"
                  :color="selectedProfile === p.profileId ? 'primary' : 'neutral'"
                  :variant="selectedProfile === p.profileId ? 'soft' : 'outline'"
                  @click="selectProfile(p.profileId)"
                />
              </div>
            </div>

            <div v-if="selectedProfile" class="flex flex-col gap-1.5">
              <span class="text-[11px] font-medium text-muted uppercase tracking-wider">{{ t('testCenter.builder.version') }}</span>
              <div v-if="versions.length" class="flex items-center gap-1.5 flex-wrap">
                <UButton
                  v-for="v in versions"
                  :key="v.strategyVersionId"
                  :label="`v${v.version} · ${v.status}`"
                  size="xs"
                  :disabled="!PAPER_READY.includes(v.status)"
                  :color="selectedVersion === v.strategyVersionId ? 'primary' : 'neutral'"
                  :variant="selectedVersion === v.strategyVersionId ? 'soft' : 'outline'"
                  @click="selectedVersion = v.strategyVersionId"
                />
              </div>
              <span v-else-if="loadingVersions" class="text-[11px] text-dimmed">{{ t('testCenter.builder.loadingVersions') }}</span>
              <span v-else class="text-[11px] text-dimmed">{{ t('testCenter.builder.noVersionsHint') }}</span>
            </div>

            <UButton
              icon="i-lucide-rocket"
              :label="t('testCenter.builder.activate')"
              color="primary"
              variant="soft"
              size="sm"
              class="self-start"
              :disabled="!selectedProfile || !selectedVersion"
              :loading="submitting"
              @click="submitPaper"
            />
          </div>

          <AdminEmptyState
            v-else
            :title="t('testCenter.builder.noProfiles')"
            :description="t('testCenter.builder.noProfilesHint')"
            icon="i-lucide-layers"
          />
        </div>
      </UCard>

      <!-- RESULT: backtest -->
      <UCard v-if="runResult" :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-check-circle-2" class="w-4 h-4 text-success" />
              <h3 class="font-semibold text-sm">{{ t('testCenter.builder.result') }}</h3>
              <span class="text-[11px] text-dimmed">{{ runResult.symbol }} · {{ runResult.tf }}m · {{ runResult.method }}</span>
            </div>
            <UButton
              v-if="runLink"
              icon="i-lucide-arrow-up-right"
              :label="t('testCenter.builder.viewRun')"
              color="primary"
              variant="soft"
              size="xs"
              :to="runLink"
            />
          </div>
        </template>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.builder.trades') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ stats.trades ?? '—' }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.builder.winRate') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ fmtPct((stats.winRate ?? 0) * 100, 1) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.builder.net') }}</span>
            <span class="text-sm font-semibold" :class="netColor(stats.netPct)">{{ fmtPct(stats.netPct) }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.builder.drawdown') }}</span>
            <span class="text-sm font-semibold text-highlighted">{{ fmtPct(stats.maxDrawdownPct) }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-default/50 text-[10px] text-dimmed font-mono">
          <span>{{ t('testCenter.builder.engine') }} {{ runResult.engineVersion || '—' }}</span>
          <span>{{ t('testCenter.builder.paramsHash') }} {{ (runResult.paramsHash || '—').slice(0, 12) }}</span>
          <span>{{ t('testCenter.builder.bars') }} {{ runResult.bars }}</span>
          <span>{{ t('testCenter.builder.source') }} {{ runResult.source || '—' }}</span>
          <span>PF {{ fmtPf(stats.profitFactor) }}</span>
        </div>

        <p v-if="runResult.warnings.length" class="text-[10px] text-warning mt-2">
          {{ runResult.warnings.join(' · ') }}
        </p>
      </UCard>

      <!-- RESULT: replay -->
      <UCard v-else-if="replayResult" :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-check-circle-2" class="w-4 h-4 text-success" />
              <h3 class="font-semibold text-sm">{{ t('testCenter.builder.result') }}</h3>
              <span class="text-[11px] text-dimmed">{{ replayResult.symbol }} · {{ replayResult.interval }}</span>
            </div>
            <UButton
              icon="i-lucide-arrow-up-right"
              :label="t('testCenter.builder.openReplay')"
              color="primary"
              variant="soft"
              size="xs"
              to="/test-center/replay"
            />
          </div>
        </template>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.builder.bars') }}</span>
            <span class="font-semibold text-highlighted">{{ replayResult.total }}</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.builder.mode') }}</span>
            <span class="font-semibold text-highlighted">{{ replayResult.mode }}</span>
          </div>
          <div class="col-span-2 flex flex-col gap-0.5">
            <span class="text-[10px] text-dimmed uppercase tracking-wider">{{ t('testCenter.builder.started') }}</span>
            <span class="font-mono text-dimmed">{{ replayResult.id }}</span>
          </div>
        </div>
      </UCard>

      <!-- RESULT: paper -->
      <UCard v-else-if="paperResult" :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-check-circle-2" class="w-4 h-4 text-success" />
              <h3 class="font-semibold text-sm">{{ t('testCenter.builder.result') }}</h3>
            </div>
            <UButton
              icon="i-lucide-arrow-up-right"
              :label="t('testCenter.builder.openForward')"
              color="primary"
              variant="soft"
              size="xs"
              to="/test-center/forward"
            />
          </div>
        </template>

        <div class="flex flex-col gap-1 text-xs">
          <div class="flex items-center gap-2">
            <span class="text-dimmed">{{ t('testCenter.builder.profile') }}:</span>
            <span class="font-mono text-highlighted">{{ paperResult.profileId }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-dimmed">{{ t('testCenter.builder.version') }}:</span>
            <span class="font-mono text-highlighted">{{ paperResult.strategyVersionId }}</span>
          </div>
        </div>
      </UCard>
    </div>
  </BasePage>
</template>
