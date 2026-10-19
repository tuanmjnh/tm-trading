<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { BotInstance } from '~~/types/bots'
import type { ReplaySummary } from '~~/types/replay'
import type { TradingSession } from '~/composables/useSessions'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Sessions (V3.4 Slices B+C): durable trading sessions on top, pre-session
//  evidence (bot instances, ephemeral replays) below, each labeled for what
//  it is. State transitions stay server-guarded (D25) and human-driven (D7):
//  the UI only offers legal next states and surfaces 409s honestly.
// =============================================================================
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'sessions.title',
  descKey: 'sessions.desc'
})
const { viewMode } = useAdminGridView('sessions-view-mode')
const botsApi = useBots()
const replayApi = useReplay()
const sessionsApi = useSessions()

const instances = ref<BotInstance[]>([])
const replays = ref<ReplaySummary[]>([])
const sessions = ref<TradingSession[]>([])
const selectedId = ref<string | null>(null)
const isLoading = ref(true)
const acting = ref(false)

// Start form (compact, inline — kind + strategy version + account).
const newKind = ref<'live-paper' | 'replay'>('live-paper')
const newStrategyVersion = ref('')
const newAccount = ref('default')
const starting = ref(false)

// Session list filter
const sessionFilter = ref<'all' | 'active' | 'terminal'>('all')
const filteredSessions = computed(() => {
  if (sessionFilter.value === 'active') {
    return sessions.value.filter((s) => !['completed', 'failed', 'halted'].includes(s.state))
  }
  if (sessionFilter.value === 'terminal') {
    return sessions.value.filter((s) => ['completed', 'failed', 'halted'].includes(s.state))
  }
  return sessions.value
})

async function load() {
  isLoading.value = true
  try {
    const [b, r, s] = await Promise.all([
      botsApi.instances({ limit: 50 }),
      replayApi.list(),
      sessionsApi.list({ limit: 50 })
    ])
    instances.value = b
    replays.value = r
    sessions.value = s
    if (selectedId.value && !s.some((x) => x.sessionId === selectedId.value)) selectedId.value = null
  } catch (err) {
    notify.error(t('sessions.title'), getErrorMessage(err, key => t(key)))
    instances.value = []
    replays.value = []
    sessions.value = []
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

const trail = computed(() => [{ label: title.value }])

const running = computed(() => instances.value.filter((i) => i.state === 'running').length)
const activeSessions = computed(() => sessions.value.filter((s) => !['completed', 'failed', 'halted'].includes(s.state)).length)

const metrics = computed<MetricItem[]>(() => [
  { key: 'sessions', label: t('sessions.durable'), value: String(sessions.value.length), tone: 'primary' },
  { key: 'bots', label: t('sessions.botSessions'), value: String(instances.value.length) },
  { key: 'running', label: t('sessions.running'), value: String(running.value), tone: running.value > 0 ? 'success' : 'default' },
  { key: 'replays', label: t('sessions.replaySessions'), value: String(replays.value.length), tone: 'info' }
])

// Legal next states (client mirror — the server guard is authoritative and
// 409s anything else; offering only these keeps the UI honest, D12).
const NEXT: Record<string, string[]> = {
  queued: ['starting', 'failed'],
  starting: ['running', 'failed'],
  running: ['paused', 'stopping', 'failed', 'halted'],
  paused: ['running', 'stopping', 'failed'],
  stopping: ['completed', 'failed'],
  completed: [],
  failed: [],
  halted: []
}

const selected = computed(() => sessions.value.find((s) => s.sessionId === selectedId.value) ?? null)

async function startSession(): Promise<void> {
  if (starting.value) return
  starting.value = true
  try {
    const created = await sessionsApi.start({
      kind: newKind.value,
      strategyVersionId: newStrategyVersion.value.trim() || null,
      accountId: newAccount.value.trim() || 'default',
      createdBy: 'dashboard'
    })
    notify.success(t('sessions.title'), t('sessions.started'))
    await load()
    selectedId.value = created.sessionId
  } catch (err) {
    notify.error(t('sessions.startFailed'), getErrorMessage(err, (key) => t(key)))
  } finally {
    starting.value = false
  }
}

async function moveSelected(to: string): Promise<void> {
  if (!selected.value || acting.value) return
  acting.value = true
  try {
    const result = await sessionsApi.move(selected.value.sessionId, to)
    const updated = result.session
    const i = sessions.value.findIndex((s) => s.sessionId === updated.sessionId)
    if (i >= 0) sessions.value[i] = updated
    notify.success(t('sessions.title'), t('sessions.moved'))
    // Sealing a session auto-freezes its evidence server-side (§59.15).
    const auto = result.autoFreeze
    if (auto?.setId) {
      notify.success(t('sessions.autoFreezeTitle'), auto.created ? t('sessions.autoFreezeCreated') : t('sessions.autoFreezeExists'))
    } else if (auto) {
      notify.warning(t('sessions.autoFreezeTitle'), t('sessions.autoFreezeFailed'))
    }
  } catch (err) {
    notify.error(t('sessions.moveFailed'), getErrorMessage(err, (key) => t(key)))
    void load()
  } finally {
    acting.value = false
  }
}

const fmtTime = (ms: number | null) =>
  typeof ms !== 'number' || !Number.isFinite(ms) ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

const stateColor = (s: string) =>
  s === 'running' ? 'success'
    : s === 'queued' || s === 'starting' ? 'info'
      : s === 'paused' || s === 'stopping' ? 'warning'
        : s === 'failed' || s === 'halted' ? 'error'
          : 'neutral'

const columns = computed<GridColumn[]>(() => [
  { key: 'instanceId', label: t('strategyLab.bots.instance'), class: 'w-48' },
  { key: 'state', label: t('strategyLab.bots.state'), class: 'w-28' },
  { key: 'startedAt', label: t('strategyLab.bots.started'), class: 'w-32' },
  { key: 'counts', label: t('strategyLab.bots.trades'), class: 'w-40' },
  { key: 'paperPnl', label: t('strategyLab.bots.instanceDetail.paperPnl'), class: 'w-28' }
])

const fmtMoney = (v: number | null) =>
  v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`

function openInstance(item: BotInstance) {
  navigateTo(`/strategy-lab/bots/instances/${encodeURIComponent(item._id)}`)
}

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))
mobileBar.registerInfo(computed(() => ({
  count: instances.value.length + replays.value.length,
  hasMore: false,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="sessions" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('sessions.pip')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-cpu"
          :label="t('nav.bot_instances')"
          variant="soft"
          color="primary"
          size="sm"
          to="/strategy-lab/bots/instances"
          :ui="{ label: 'hidden md:block' }"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="load"
        />
      </div>
    </template>

    <template #footer>
      <SharedListFooter :count="instances.length + replays.length" :loading="isLoading" />
    </template>

    <div class="flex flex-col w-full h-full min-h-0 gap-3 pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" />

      <p class="text-[11px] text-dimmed">{{ t('sessions.preSessionHint') }}</p>

      <!-- Durable trading sessions (Slice C) + start form -->
      <UCard :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-layers" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('sessions.durable') }}</h3>
              <UBadge :label="String(sessions.length)" variant="subtle" size="xs" />
            </div>
            <span class="text-[10px] text-dimmed">{{ t('sessions.durableHint') }}</span>
          </div>
        </template>

        <div class="flex flex-col gap-3">
          <div class="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div class="flex flex-col gap-1">
              <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('sessions.kind') }}</span>
              <div class="flex items-center gap-1.5" role="group" :aria-label="t('sessions.kind')">
                <UButton
                  v-for="k in (['live-paper', 'replay'] as const)"
                  :key="k"
                  size="xs"
                  :color="newKind === k ? 'primary' : 'neutral'"
                  :variant="newKind === k ? 'soft' : 'outline'"
                  @click="newKind = k"
                >
                  {{ k }}
                </UButton>
              </div>
            </div>
            <UFormField :label="t('sessions.strategyVersion')" class="flex-1">
              <UInput v-model="newStrategyVersion" size="sm" placeholder="tm-vsa-core@1.3.0" class="w-full font-mono" />
            </UFormField>
            <UFormField :label="t('sessions.account')" class="sm:w-36">
              <UInput v-model="newAccount" size="sm" class="w-full font-mono" />
            </UFormField>
            <UButton
              icon="i-lucide-play"
              :label="t('sessions.start')"
              color="primary"
              variant="soft"
              size="sm"
              class="self-start sm:self-auto shrink-0"
              :loading="starting"
              @click="startSession"
            />
          </div>

          <!-- Filter tabs for sessions -->
          <div v-if="sessions.length" class="flex items-center justify-between gap-2 flex-wrap pt-1">
            <div class="flex items-center gap-1">
              <UButton
                size="xs"
                :color="sessionFilter === 'all' ? 'primary' : 'neutral'"
                :variant="sessionFilter === 'all' ? 'soft' : 'ghost'"
                @click="sessionFilter = 'all'"
              >
                {{ t('sessions.filterAll') }} ({{ sessions.length }})
              </UButton>
              <UButton
                size="xs"
                :color="sessionFilter === 'active' ? 'primary' : 'neutral'"
                :variant="sessionFilter === 'active' ? 'soft' : 'ghost'"
                @click="sessionFilter = 'active'"
              >
                {{ t('sessions.filterActive') }} ({{ activeSessions }})
              </UButton>
              <UButton
                size="xs"
                :color="sessionFilter === 'terminal' ? 'primary' : 'neutral'"
                :variant="sessionFilter === 'terminal' ? 'soft' : 'ghost'"
                @click="sessionFilter = 'terminal'"
              >
                {{ t('sessions.filterTerminal') }} ({{ sessions.length - activeSessions }})
              </UButton>
            </div>
          </div>

          <div v-if="filteredSessions.length" class="flex flex-col">
            <div
              v-for="s in filteredSessions"
              :key="s.sessionId"
              class="flex items-center justify-between gap-2 py-2 px-1.5 min-w-0 rounded border-t border-default/50 first:border-t-0 hover:bg-elevated/40"
              :class="selectedId === s.sessionId ? 'bg-primary/10 ring-1 ring-primary/30' : ''"
            >
              <button
                type="button"
                class="flex items-center gap-2 min-w-0 flex-1 text-left"
                @click="selectedId = selectedId === s.sessionId ? null : s.sessionId"
              >
                <UBadge :label="s.state" :color="stateColor(s.state)" variant="subtle" size="xs" class="shrink-0" />
                <span class="font-mono text-xs text-highlighted font-medium truncate">{{ s.sessionId }}</span>
                <UBadge :label="s.kind" color="neutral" variant="subtle" size="xs" class="shrink-0" />
                <span v-if="s.strategyVersionId" class="text-[10px] text-muted font-mono truncate hidden sm:inline">
                  {{ s.strategyVersionId }}
                </span>
                <span class="text-[10px] text-dimmed font-mono shrink-0 ml-auto">
                  {{ s.counts.orders }}o · {{ s.counts.fills }}f · {{ s.counts.positions }}p
                </span>
              </button>

              <div class="flex items-center gap-1 shrink-0">
                <UButton
                  icon="i-lucide-arrow-up-right"
                  size="xs"
                  color="primary"
                  variant="ghost"
                  :to="`/sessions/${encodeURIComponent(s.sessionId)}`"
                  :title="t('sessions.viewDetail')"
                />
              </div>
            </div>
          </div>
          <AdminEmptyState v-else-if="!isLoading" :title="t('sessions.noDurable')" icon="i-lucide-layers" />

          <!-- Selected session: timeline + legal moves + detail link -->
          <div v-if="selected" class="rounded border border-default bg-elevated/30 p-2.5 flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-mono text-xs text-highlighted font-semibold truncate">{{ selected.sessionId }}</span>
                <UBadge :label="selected.state" :color="stateColor(selected.state)" variant="subtle" size="xs" />
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                <UButton
                  v-for="to in (NEXT[selected.state] ?? [])"
                  :key="to"
                  size="xs"
                  color="primary"
                  variant="soft"
                  :loading="acting"
                  @click="moveSelected(to)"
                >
                  → {{ to }}
                </UButton>
                <span v-if="!(NEXT[selected.state] ?? []).length" class="text-[10px] text-dimmed">{{ t('sessions.terminal') }}</span>
                <UButton
                  icon="i-lucide-arrow-up-right"
                  :label="t('sessions.viewDetail')"
                  size="xs"
                  color="primary"
                  variant="outline"
                  :to="`/sessions/${encodeURIComponent(selected.sessionId)}`"
                />
              </div>
            </div>
            <div v-if="selected.timeline.length" class="flex flex-col max-h-48 overflow-y-auto">
              <div
                v-for="(e, i) in [...selected.timeline].reverse()"
                :key="`${e.t}-${i}`"
                class="flex items-baseline gap-2 py-0.5 text-[11px] border-t border-default/30 first:border-t-0"
              >
                <time class="font-mono text-dimmed shrink-0">{{ fmtTime(e.t) }}</time>
                <UBadge :label="e.kind" color="neutral" variant="subtle" size="xs" class="shrink-0" />
                <span class="text-muted truncate">{{ e.message }}</span>
              </div>
            </div>
            <p v-if="selected.timelineDropped > 0" class="text-[10px] text-dimmed">
              {{ t('sessions.dropped', { n: selected.timelineDropped }) }}
            </p>
          </div>
        </div>
      </UCard>

      <!-- Bot sessions (bot-scoped evidence) -->
      <UCard :ui="{ body: 'p-3 sm:p-3 pr-0 sm:pr-0' }">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-cpu" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('sessions.botSessions') }}</h3>
              <UBadge :label="String(instances.length)" variant="subtle" size="xs" />
            </div>
            <AdminViewModeToggle v-model="viewMode" />
          </div>
        </template>

        <div class="relative h-80">
          <LazyGridList
            :items="instances"
            :columns="columns"
            :loading="isLoading"
            :can-load-more="false"
            v-model:view-mode="viewMode"
            item-key="_id"
            storage-key="sessions-view-mode"
            @refresh="load"
            @click="openInstance"
          >
            <template #instanceId="{ item }">
              <span class="text-[11px] font-mono text-highlighted truncate">{{ item.instanceId }}</span>
            </template>
            <template #state="{ item }">
              <UBadge :label="item.state" :color="stateColor(item.state)" variant="subtle" size="xs" />
            </template>
            <template #startedAt="{ item }">
              <time v-if="item.startedAt" :datetime="new Date(item.startedAt).toISOString()" class="text-[11px] text-muted">
                {{ formatTimeAgo(new Date(item.startedAt)) }}
              </time>
              <span v-else class="text-[11px] text-dimmed">—</span>
            </template>
            <template #counts="{ item }">
              <span class="text-[11px] text-muted">{{ item.counts?.signals ?? 0 }} / {{ item.counts?.orders ?? 0 }} / {{ item.counts?.trades ?? 0 }}</span>
            </template>
            <template #paperPnl="{ item }">
              <span
                class="text-[11px] font-mono"
                :class="item.paperPnl === null ? 'text-dimmed' : item.paperPnl >= 0 ? 'text-success' : 'text-error'"
              >{{ fmtMoney(item.paperPnl) }}</span>
            </template>
            <template #mobile-content="{ item }">
              <div class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 text-xs">
                    <span class="font-semibold text-highlighted font-mono truncate">{{ item.instanceId }}</span>
                    <UBadge :label="item.state" :color="stateColor(item.state)" variant="subtle" size="xs" class="shrink-0" />
                  </div>
                  <div class="text-[11px] text-dimmed mt-0.5 truncate">{{ item.botProfileId || '—' }} · {{ item.mode }}</div>
                </div>
                <div class="text-right shrink-0 text-[11px] font-mono" :class="item.paperPnl === null ? 'text-dimmed' : item.paperPnl >= 0 ? 'text-success' : 'text-error'">
                  {{ fmtMoney(item.paperPnl) }}
                </div>
              </div>
            </template>
            <template #empty>
              <AdminEmptyState
                :title="t('strategyLab.bots.instancesEmpty')"
                :description="t('strategyLab.bots.instancesEmptyHint')"
                icon="i-lucide-cpu"
              />
            </template>
          </LazyGridList>
        </div>
      </UCard>

      <!-- Replay actives (in-memory, die with the server process) -->
      <UCard :ui="{ body: 'p-3 sm:p-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-history" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('sessions.replaySessions') }}</h3>
              <UBadge :label="String(replays.length)" variant="subtle" size="xs" />
            </div>
            <UButton
              icon="i-lucide-arrow-up-right"
              :label="t('testCenter.builder.openReplay')"
              variant="ghost"
              color="primary"
              size="xs"
              to="/test-center/replay"
            />
          </div>
        </template>

        <div v-if="replays.length" class="flex flex-col">
          <NuxtLink
            v-for="r in replays"
            :key="r.id"
            to="/test-center/replay"
            class="flex items-center gap-2 py-1.5 px-1 min-w-0 rounded border-t border-default/50 first:border-t-0 hover:bg-elevated/40"
          >
            <UBadge :label="r.mode" color="info" variant="subtle" size="xs" class="shrink-0" />
            <span class="flex-1 min-w-0 font-mono text-[11px] text-highlighted truncate">{{ r.symbol }} · {{ r.interval }}</span>
            <span class="text-[10px] text-dimmed font-mono shrink-0">{{ r.cursor }}/{{ r.total }}</span>
          </NuxtLink>
        </div>
        <AdminEmptyState
          v-else-if="!isLoading"
          :title="t('sessions.noReplays')"
          :description="t('sessions.noReplaysHint')"
          icon="i-lucide-history"
        />
      </UCard>
    </div>
  </BasePage>
</template>
