<script setup lang="ts">
import type { GridColumn } from '~/components/gridList/Index.vue'
import type { MetricItem } from '~/components/MetricRibbon.vue'
import type { FilterChip } from '~/components/FilterChips.vue'
import type { AiAgent, AiAgentDetail, AiAgentsStatus, AiAgentValidation, AiPolicyLevel } from '~~/types/ai'
import { formatTimeAgo } from '@vueuse/core'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  AI Agents (V3.5 §59.15 Slice D — governance).
//
//  Two layers, both backed by real data:
//   - registry: agents, their immutable versions, autonomy level, lifecycle
//     state and derived health;
//   - audit: the append-only action ledger, including BLOCKED actions.
//
//  The autonomy ladder and the tool allowlist are rendered from the API policy
//  table (never hardcoded). Every lifecycle/validation decision is made
//  server-side; this page only requests it and shows the policy code it returns.
// =============================================================================
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'aiAgents.title',
  descKey: 'aiAgents.desc'
})
const agentsApi = useAiAgents()
const { viewMode } = useAdminGridView('ai-agents-view-mode')

const status = ref<AiAgentsStatus | null>(null)
const agents = ref<AiAgent[]>([])
const policy = ref<AiPolicyLevel[]>([])
const stateFilter = ref('')
const isLoading = ref(true)

const selectedId = ref<string | null>(null)
const detail = ref<AiAgentDetail | null>(null)
const detailLoading = ref(false)
const validation = ref<AiAgentValidation | null>(null)
const acting = ref(false)

// ---- modals ---------------------------------------------------------------
const showCreate = ref(false)
const showPublish = ref(false)
const showRisk = ref(false)
const showDisable = ref(false)

const createForm = ref({ name: '', description: '', autonomy: 'A0' })
const publishForm = ref({ autonomy: 'A0', system: '', tools: [] as string[], note: '' })
const riskForm = ref({ evidence: '', tests: '' })

async function load() {
  isLoading.value = true
  try {
    const [s, list] = await Promise.all([agentsApi.status(), agentsApi.agents({ limit: 100 })])
    status.value = s
    agents.value = list.agents
    policy.value = list.policy
    if (selectedId.value && !list.agents.some(a => a.agentId === selectedId.value)) {
      selectedId.value = null
      detail.value = null
    } else if (selectedId.value) {
      await refreshDetail()
    }
  } finally {
    isLoading.value = false
  }
}

async function refreshDetail() {
  if (!selectedId.value) return
  detailLoading.value = true
  try {
    detail.value = await agentsApi.agent(selectedId.value)
  } finally {
    detailLoading.value = false
  }
}

async function selectAgent(item: AiAgent) {
  selectedId.value = item.agentId
  validation.value = null
  await refreshDetail()
}

onMounted(load)

/** Policy row for a level — read from the server table, never guessed. */
const levelPolicy = (level: string): AiPolicyLevel | undefined => policy.value.find(p => p.level === level)

/** Tools selectable in the publish form = what the chosen level allows. */
const publishTools = computed(() => levelPolicy(publishForm.value.autonomy)?.tools ?? [])

watch(() => publishForm.value.autonomy, () => {
  publishForm.value.tools = publishForm.value.tools.filter(tool => publishTools.value.includes(tool))
})

function openPublish() {
  const level = detail.value?.activeVersion?.autonomy ?? detail.value?.agent.autonomy ?? 'A0'
  publishForm.value = {
    autonomy: level,
    system: detail.value?.activeVersion?.prompts.system ?? '',
    tools: detail.value?.activeVersion?.tools ? [...detail.value.activeVersion.tools] : [],
    note: ''
  }
  showPublish.value = true
}

async function submitCreate() {
  acting.value = true
  try {
    const created = await agentsApi.create({
      name: createForm.value.name.trim(),
      description: createForm.value.description.trim(),
      autonomy: createForm.value.autonomy
    })
    showCreate.value = false
    createForm.value = { name: '', description: '', autonomy: 'A0' }
    notify.success(t('aiAgents.created'))
    await load()
    selectedId.value = created.agentId
    await refreshDetail()
  } catch (err) {
    notify.error(t('aiAgents.createTitle'), getErrorMessage(err, key => t(key)))
  } finally {
    acting.value = false
  }
}

async function submitPublish() {
  if (!selectedId.value) return
  acting.value = true
  try {
    detail.value = await agentsApi.publishVersion(selectedId.value, {
      autonomy: publishForm.value.autonomy,
      prompts: { system: publishForm.value.system },
      tools: publishForm.value.tools,
      note: publishForm.value.note
    })
    showPublish.value = false
    notify.success(t('aiAgents.versionPublished'))
    await load()
  } catch (err) {
    notify.error(t('aiAgents.publishTitle'), getErrorMessage(err, key => t(key)))
  } finally {
    acting.value = false
  }
}

async function submitValidation() {
  if (!selectedId.value) return
  acting.value = true
  try {
    validation.value = await agentsApi.validateVersion(selectedId.value)
    notify.success(t('aiAgents.versionValidated'))
  } catch (err) {
    notify.error(t('aiAgents.validate'), getErrorMessage(err, key => t(key)))
  } finally {
    acting.value = false
  }
}

async function move(action: 'start' | 'pause' | 'resume' | 'disable') {
  if (!selectedId.value) return
  acting.value = true
  try {
    await agentsApi.move(selectedId.value, action)
    notify.success(t('aiAgents.moved'))
    await load()
  } catch (err) {
    notify.error(t('aiAgents.moved'), getErrorMessage(err, key => t(key)))
  } finally {
    acting.value = false
  }
}

async function confirmDisable() {
  showDisable.value = false
  await move('disable')
}

async function submitRisk() {
  if (!selectedId.value) return
  acting.value = true
  try {
    detail.value = await agentsApi.recordRiskIntegration(selectedId.value, {
      passed: true,
      tests: riskForm.value.tests.split(',').map(s => s.trim()).filter(Boolean),
      evidence: riskForm.value.evidence.trim()
    })
    showRisk.value = false
    notify.success(t('aiAgents.riskRecorded'))
    await load()
  } catch (err) {
    notify.error(t('aiAgents.riskIntegrationTitle'), getErrorMessage(err, key => t(key)))
  } finally {
    acting.value = false
  }
}

// ---- presentation ---------------------------------------------------------
const stateColor = (s: string): 'success' | 'neutral' | 'warning' | 'error' | 'info' => {
  switch (s) {
    case 'active': return 'success'
    case 'validated': return 'info'
    case 'paused': return 'warning'
    case 'disabled': return 'error'
    default: return 'neutral'
  }
}

const healthColor = (h: string): 'success' | 'neutral' | 'warning' => {
  switch (h) {
    case 'ok': return 'success'
    case 'stale': return 'warning'
    default: return 'neutral'
  }
}

const levelColor = (level: string): 'primary' | 'info' | 'warning' | 'error' | 'neutral' =>
  level === 'A2' ? 'info' : level === 'A3' || level === 'A4' ? 'error' : level === 'A1' ? 'primary' : 'neutral'

const stateLabel = (s: string) => t(`aiAgents.stateLabels.${s}`)
const healthLabel = (h: string) => t(`aiAgents.healthLabels.${h}`)

const counts = computed(() => {
  const c = { total: agents.value.length, active: 0, paused: 0, blocked: 0, allowed: 0 }
  for (const a of agents.value) {
    if (a.state === 'active') c.active++
    if (a.state === 'paused') c.paused++
    c.blocked += Number(a.actionCounts?.blocked ?? 0)
    c.allowed += Number(a.actionCounts?.allowed ?? 0)
  }
  return c
})

const metrics = computed<MetricItem[]>(() => [
  { key: 'agents', label: t('aiAgents.agents'), value: String(counts.value.total), tone: 'primary' },
  { key: 'active', label: t('aiAgents.activeAgents'), value: String(counts.value.active), tone: counts.value.active ? 'success' : 'default' },
  { key: 'blocked', label: t('aiAgents.blockedActions'), value: String(counts.value.blocked), tone: counts.value.blocked ? 'warning' : 'default', hint: t('aiAgents.auditHint') },
  {
    key: 'gateway',
    label: t('aiAgents.gateway'),
    value: status.value?.gateway.configured ? t('aiAgents.yes') : t('aiAgents.no'),
    hint: status.value ? `${status.value.gateway.provider} · ${status.value.gateway.model}` : undefined,
    tone: status.value?.gateway.configured ? 'success' : 'warning'
  }
])

const stateChips = computed<FilterChip[]>(() => {
  const byState = (s: string) => agents.value.filter(a => a.state === s).length
  return [
    { value: '', label: t('common.all'), count: counts.value.total },
    { value: 'active', label: stateLabel('active'), count: byState('active') },
    { value: 'paused', label: stateLabel('paused'), count: byState('paused') },
    { value: 'validated', label: stateLabel('validated'), count: byState('validated') },
    { value: 'draft', label: stateLabel('draft'), count: byState('draft') },
    { value: 'disabled', label: stateLabel('disabled'), count: byState('disabled') }
  ]
})

const filtered = computed(() =>
  stateFilter.value ? agents.value.filter(a => a.state === stateFilter.value) : agents.value
)

const autonomyOptions = computed(() =>
  policy.value.map(p => ({
    label: `${p.level} · ${p.label}${p.enabled ? '' : ` — ${t('aiAgents.off')}`}`,
    value: String(p.level)
  }))
)

/** Toggle one tool in the publish form (UCheckbox emits boolean | 'indeterminate'). */
function toggleTool(tool: string, value: boolean | 'indeterminate') {
  if (value === true) {
    if (!publishForm.value.tools.includes(tool)) publishForm.value.tools = [...publishForm.value.tools, tool]
  } else {
    publishForm.value.tools = publishForm.value.tools.filter(x => x !== tool)
  }
}

const columns = computed<GridColumn[]>(() => [
  { key: 'name', label: t('common.name'), class: 'w-56' },
  { key: 'autonomy', label: t('aiAgents.level'), class: 'w-24' },
  { key: 'state', label: t('aiAgents.state'), class: 'w-28' },
  // Health is derived server-side from the heartbeat (engine/agentPolicy.mjs
  // agentHealth) and shown in the detail panel only — the list never guesses.
  { key: 'versions', label: t('aiAgents.version'), class: 'w-20' },
  { key: 'last', label: t('aiAgents.lastEvent'), class: 'w-32' }
])

const trail = computed(() => [{ label: title.value }])

const agentActions = computed(() => {
  const a = detail.value?.agent
  if (!a) return []
  const buttons: Array<{ key: string; label: string; icon: string; onSelect: () => void; color?: 'primary' | 'warning' | 'error' }> = []
  // Start requires `validated`: validation is the only door out of `draft`,
  // so offering start on a draft agent would offer a 409 (see the hint below).
  if (a.state === 'validated') {
    buttons.push({ key: 'start', label: t('aiAgents.start'), icon: 'i-lucide-play', onSelect: () => move('start'), color: 'primary' })
  }
  if (a.state === 'active') {
    buttons.push({ key: 'pause', label: t('aiAgents.pause'), icon: 'i-lucide-pause', onSelect: () => move('pause'), color: 'warning' })
  }
  if (a.state === 'paused') {
    buttons.push({ key: 'resume', label: t('aiAgents.resume'), icon: 'i-lucide-play', onSelect: () => move('resume'), color: 'primary' })
  }
  if (a.state !== 'disabled') {
    buttons.push({ key: 'disable', label: t('aiAgents.disable'), icon: 'i-lucide-ban', onSelect: () => { showDisable.value = true }, color: 'error' })
  }
  return buttons
})

const canRecordRisk = computed(() => {
  const v = detail.value?.activeVersion
  return !!v && v.autonomy === 'A2' && v.riskIntegration?.passed !== true
})

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-plus', label: t('aiAgents.createAgent'), onSelect: () => { showCreate.value = true } },
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))

useHead({ title })
</script>

<template>
  <BasePage id="ai-agents" :title="title" :description="description">
    <template #eyebrow>
      <PageEyebrow :trail="trail" :pip="t('aiAgents.pipGovernance')" />
    </template>

    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="status && status.mongo === 'down'"
          :label="t('aiAgents.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-plus"
          :label="t('aiAgents.createAgent')"
          color="primary"
          variant="soft"
          size="sm"
          :ui="{ label: 'hidden md:block' }"
          @click="showCreate = true"
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

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <MetricRibbon :items="metrics" />

      <!-- Autonomy policy — rendered from the server table, never hardcoded -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-shield-check" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('aiAgents.policyTitle') }}</h3>
            <span class="text-[11px] text-dimmed">{{ t('aiAgents.policyHint') }}</span>
          </div>
        </template>

        <div v-if="policy.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
          <div
            v-for="p in policy"
            :key="p.level"
            class="rounded border border-default p-3 flex flex-col gap-1.5 min-w-0"
            :class="p.enabled ? 'bg-elevated' : 'bg-elevated/40'"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-xs font-semibold text-highlighted">{{ p.level }}</span>
              <UBadge
                :label="p.enabled ? t('aiAgents.on') : t('aiAgents.off')"
                :color="p.enabled ? 'success' : 'error'"
                variant="subtle"
                size="xs"
              />
            </div>
            <span class="text-[11px] text-muted truncate">{{ p.label }}</span>
            <div class="text-[10px] text-dimmed">
              {{ t('aiAgents.maxAction') }}:
              <span class="font-mono text-muted">{{ p.maxAction ?? t('aiAgents.maxActionNone') }}</span>
            </div>
            <div v-if="p.requiresRiskIntegration" class="text-[10px] text-warning">
              {{ t('aiAgents.requiresRiskEvidence') }}
            </div>
            <div class="flex flex-wrap gap-1 pt-0.5">
              <span
                v-for="tool in p.tools"
                :key="tool"
                class="font-mono text-[9px] px-1 rounded bg-accented text-muted"
              >{{ tool }}</span>
              <span v-if="!p.tools.length" class="text-[10px] text-dimmed">{{ t('aiAgents.maxActionNone') }}</span>
            </div>
          </div>
        </div>
        <AdminEmptyState
          v-else-if="!isLoading"
          :title="t('aiAgents.empty')"
          :description="t('aiAgents.emptyHint')"
          icon="i-lucide-shield-check"
        />
      </UCard>

      <!-- Registry -->
      <div class="flex flex-col gap-3">
        <FilterChips v-model="stateFilter" :items="stateChips" />

        <LazyGridList
          :items="filtered"
          :columns="columns"
          :loading="isLoading"
          :can-load-more="false"
          v-model:view-mode="viewMode"
          item-key="agentId"
          storage-key="ai-agents-view-mode"
          @refresh="load"
          @click="selectAgent"
        >
          <template #name="{ item }">
            <div class="flex flex-col min-w-0">
              <span class="font-semibold text-xs text-highlighted truncate">{{ item.name }}</span>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.agentId }}</span>
            </div>
          </template>

          <template #autonomy="{ item }">
            <UBadge :label="item.autonomy" :color="levelColor(item.autonomy)" variant="subtle" size="xs" />
          </template>

          <template #state="{ item }">
            <UBadge :label="stateLabel(item.state)" :color="stateColor(item.state)" variant="subtle" size="xs" />
          </template>

          <template #versions="{ item }">
            <span class="font-mono text-[11px] text-muted">{{ item.versionCount }}</span>
          </template>

          <template #last="{ item }">
            <time v-if="item.lastEventAt" :datetime="new Date(item.lastEventAt).toISOString()" class="text-[11px] text-muted">
              {{ formatTimeAgo(new Date(item.lastEventAt)) }}
            </time>
            <span v-else class="text-[11px] text-dimmed">—</span>
          </template>

          <template #mobile-content="{ item }">
            <div class="flex flex-col gap-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-xs text-highlighted truncate">{{ item.name }}</span>
                <UBadge :label="item.autonomy" :color="levelColor(item.autonomy)" variant="subtle" size="xs" class="shrink-0" />
                <UBadge :label="stateLabel(item.state)" :color="stateColor(item.state)" variant="subtle" size="xs" class="shrink-0" />
              </div>
              <span class="text-[10px] text-dimmed font-mono truncate">{{ item.agentId }}</span>
              <span class="text-[10px] text-muted">
                {{ t('aiAgents.version') }} {{ item.versionCount }} ·
                {{ t('aiAgents.allowed') }} {{ item.actionCounts?.allowed ?? 0 }} ·
                {{ t('aiAgents.blocked') }} {{ item.actionCounts?.blocked ?? 0 }}
              </span>
            </div>
          </template>

          <template #empty>
            <AdminEmptyState
              :title="t('aiAgents.agentsEmpty')"
              :description="t('aiAgents.agentsEmptyHint')"
              icon="i-lucide-bot"
            />
          </template>
        </LazyGridList>
      </div>

      <!-- Detail: versions + lifecycle + ledger -->
      <UCard v-if="selectedId">
        <template #header>
          <div class="flex flex-wrap items-center gap-2">
            <UIcon name="i-lucide-bot" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm truncate">{{ detail?.agent.name ?? selectedId }}</h3>
            <UBadge v-if="detail" :label="detail.agent.autonomy" :color="levelColor(detail.agent.autonomy)" variant="subtle" size="xs" />
            <UBadge v-if="detail" :label="stateLabel(detail.agent.state)" :color="stateColor(detail.agent.state)" variant="subtle" size="xs" />
            <UBadge v-if="detail" :label="`${t('aiAgents.health')}: ${healthLabel(detail.health)}`" :color="healthColor(detail.health)" variant="subtle" size="xs" />
            <span v-if="detailLoading" class="text-[11px] text-dimmed">{{ t('common.loading_text') }}</span>
          </div>
        </template>

        <div v-if="detail" class="flex flex-col gap-4">
          <!-- lifecycle -->
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              v-for="action in agentActions"
              :key="action.key"
              :label="action.label"
              :icon="action.icon"
              :color="action.color ?? 'neutral'"
              variant="soft"
              size="xs"
              :disabled="acting"
              @click="action.onSelect()"
            />
            <UButton
              :label="t('aiAgents.publishVersion')"
              icon="i-lucide-file-plus-2"
              color="primary"
              variant="soft"
              size="xs"
              :disabled="acting"
              @click="openPublish"
            />
            <UButton
              :label="t('aiAgents.validate')"
              icon="i-lucide-badge-check"
              color="neutral"
              variant="soft"
              size="xs"
              :loading="acting"
              @click="submitValidation"
            />
            <UButton
              v-if="canRecordRisk"
              :label="t('aiAgents.riskIntegration')"
              icon="i-lucide-shield-plus"
              color="warning"
              variant="soft"
              size="xs"
              :disabled="acting"
              @click="showRisk = true"
            />
          </div>

          <p v-if="detail.agent.state === 'draft'" class="text-[11px] text-warning">
            {{ t('aiAgents.validateFirst') }}
          </p>

          <!-- validation result -->
          <div v-if="validation" class="rounded border p-3 text-xs" :class="validation.ok ? 'border-success/40 bg-success/5' : 'border-error/40 bg-error/5'">
            <div class="flex items-center gap-2">
              <UIcon :name="validation.ok ? 'i-lucide-check-circle-2' : 'i-lucide-triangle-alert'" class="w-3.5 h-3.5" :class="validation.ok ? 'text-success' : 'text-error'" />
              <span :class="validation.ok ? 'text-success' : 'text-error'">
                {{ validation.ok ? t('aiAgents.validationOk') : t('aiAgents.validationIssues') }}
              </span>
            </div>
            <ul v-if="validation.errors.length" class="mt-1.5 ml-5 list-disc text-[11px] text-muted">
              <li v-for="(e, i) in validation.errors" :key="i">{{ e }}</li>
            </ul>
          </div>

          <!-- versions -->
          <div class="flex flex-col gap-2">
            <h4 class="text-xs font-semibold text-highlighted">{{ t('aiAgents.versionHistory') }}</h4>
            <div v-if="detail.versions.length" class="flex flex-col divide-y divide-default/50">
              <div v-for="v in detail.versions" :key="v.versionId" class="flex flex-wrap items-center gap-2 py-2">
                <span class="font-mono text-[11px] text-highlighted">v{{ v.version }}</span>
                <UBadge :label="v.autonomy" :color="levelColor(v.autonomy)" variant="subtle" size="xs" />
                <span class="font-mono text-[10px] text-dimmed truncate">{{ v.hash }}</span>
                <span class="text-[10px] text-muted">{{ v.tools.join(', ') || '—' }}</span>
                <UBadge
                  v-if="v.riskIntegration?.passed"
                  :label="t('aiAgents.riskEvidenceRecorded')"
                  color="success"
                  variant="subtle"
                  size="xs"
                />
                <UBadge
                  v-if="v.versionId === detail.agent.activeVersionId"
                  :label="t('aiAgents.activeVersion')"
                  color="primary"
                  variant="subtle"
                  size="xs"
                />
              </div>
            </div>
            <p v-else class="text-[11px] text-dimmed">{{ t('aiAgents.noVersion') }}</p>
          </div>

          <!-- ledger -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <h4 class="text-xs font-semibold text-highlighted">{{ t('aiAgents.auditTitle') }}</h4>
              <span class="text-[11px] text-dimmed">{{ t('aiAgents.auditHint') }}</span>
            </div>
            <div v-if="detail.actions.length" class="flex flex-col divide-y divide-default/50">
              <div v-for="a in detail.actions" :key="a.actionId" class="flex flex-wrap items-center gap-2 py-2 text-[11px]">
                <UBadge
                  :label="a.status === 'allowed' ? t('aiAgents.allowed') : t('aiAgents.blocked')"
                  :color="a.status === 'allowed' ? 'success' : 'error'"
                  variant="subtle"
                  size="xs"
                />
                <span class="font-mono text-highlighted">{{ a.type }}</span>
                <span v-if="a.code !== 'OK'" class="font-mono text-error">{{ a.code }}</span>
                <span v-if="a.sessionId" class="text-muted">{{ t('aiAgents.session') }}: <span class="font-mono">{{ a.sessionId }}</span></span>
                <span class="text-dimmed truncate">{{ a.message }}</span>
                <time v-if="a.at" :datetime="new Date(a.at).toISOString()" class="text-[10px] text-muted ml-auto">
                  {{ formatTimeAgo(new Date(a.at)) }}
                </time>
              </div>
            </div>
            <p v-else class="text-[11px] text-dimmed">{{ t('aiAgents.auditEmpty') }}</p>
          </div>
        </div>

        <AdminEmptyState
          v-else-if="!detailLoading"
          :title="t('aiAgents.empty')"
          :description="t('aiAgents.selectAgent')"
          icon="i-lucide-bot"
        />
      </UCard>
      <p v-else class="text-[11px] text-dimmed">{{ t('aiAgents.selectAgent') }}</p>

      <!-- gateway + tools (Slice B observability) -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-cpu" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('aiAgents.gateway') }}</h3>
              <UBadge
                v-if="status"
                :label="status.gateway.configured ? t('aiAgents.configured') : t('aiAgents.notConfigured')"
                :color="status.gateway.configured ? 'success' : 'warning'"
                variant="subtle"
                size="xs"
              />
            </div>
          </template>

          <dl v-if="status" class="grid grid-cols-1 gap-y-3 text-xs">
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('aiAgents.provider') }}</dt>
              <dd class="font-mono text-highlighted">{{ status.gateway.provider }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('aiAgents.model') }}</dt>
              <dd class="font-mono text-highlighted">{{ status.gateway.model }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('aiAgents.proposals') }}</dt>
              <dd class="text-muted">{{ status.counts.proposals }}</dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-muted">{{ t('aiAgents.experiments') }}</dt>
              <dd class="text-muted">{{ status.counts.experiments }}</dd>
            </div>
          </dl>
          <AdminEmptyState
            v-else-if="!isLoading"
            :title="t('aiAgents.empty')"
            :description="t('aiAgents.emptyHint')"
            icon="i-lucide-cpu"
          />
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-wrench" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('aiAgents.tools') }}</h3>
              <UBadge :label="String(status?.tools.length ?? 0)" variant="subtle" size="xs" />
            </div>
          </template>

          <div v-if="status?.tools.length" class="flex flex-col">
            <div
              v-for="tool in status.tools"
              :key="tool.name"
              class="flex flex-col gap-0.5 py-2 border-t border-default/50 first:border-t-0"
            >
              <span class="font-mono text-xs text-highlighted">{{ tool.name }}</span>
              <span class="text-[11px] text-muted">{{ tool.description || '—' }}</span>
            </div>
          </div>
          <AdminEmptyState
            v-else-if="!isLoading"
            :title="t('aiAgents.noTools')"
            icon="i-lucide-wrench"
          />
        </UCard>
      </div>

      <p class="text-[11px] text-dimmed">{{ t('aiAgents.noRuntimeHint') }}</p>
    </div>

    <!-- Register agent -->
    <UModal v-model:open="showCreate" :title="t('aiAgents.createTitle')">
      <template #body>
        <div class="space-y-4">
          <p class="text-xs text-muted">{{ t('aiAgents.createHint') }}</p>
          <UFormField :label="t('aiAgents.nameLabel')" required>
            <UInput v-model="createForm.name" :placeholder="t('aiAgents.namePlaceholder')" class="w-full" />
          </UFormField>
          <UFormField :label="t('aiAgents.descLabel')">
            <UTextarea v-model="createForm.description" :placeholder="t('aiAgents.descPlaceholder')" :rows="3" class="w-full" />
          </UFormField>
          <UFormField :label="t('aiAgents.autonomyLabel')">
            <USelect v-model="createForm.autonomy" :items="autonomyOptions" value-key="value" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="soft" :label="t('common.cancel')" @click="showCreate = false" />
          <UButton
            color="primary"
            variant="soft"
            :label="t('aiAgents.createAgent')"
            :loading="acting"
            :disabled="!createForm.name.trim()"
            @click="submitCreate"
          />
        </div>
      </template>
    </UModal>

    <!-- Publish immutable version -->
    <UModal v-model:open="showPublish" :title="t('aiAgents.publishTitle')">
      <template #body>
        <div class="space-y-4">
          <p class="text-xs text-muted">{{ t('aiAgents.publishHint') }}</p>
          <UFormField :label="t('aiAgents.autonomyLabel')">
            <USelect v-model="publishForm.autonomy" :items="autonomyOptions" value-key="value" class="w-full" />
          </UFormField>
          <UFormField :label="t('aiAgents.systemPrompt')" required>
            <UTextarea v-model="publishForm.system" :placeholder="t('aiAgents.systemPromptPlaceholder')" :rows="6" class="w-full font-mono text-[11px]" />
          </UFormField>
          <UFormField :label="t('aiAgents.toolsLabel')" :help="t('aiAgents.toolsHint')">
            <div class="flex flex-wrap gap-2">
              <UCheckbox
                v-for="tool in publishTools"
                :key="tool"
                :model-value="publishForm.tools.includes(tool)"
                :label="tool"
                @update:model-value="(value: boolean | 'indeterminate') => toggleTool(tool, value)"
              />
              <span v-if="!publishTools.length" class="text-[11px] text-dimmed">{{ t('aiAgents.maxActionNone') }}</span>
            </div>
          </UFormField>
          <UFormField :label="t('aiAgents.note')">
            <UInput v-model="publishForm.note" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="soft" :label="t('common.cancel')" @click="showPublish = false" />
          <UButton
            color="primary"
            variant="soft"
            :label="t('aiAgents.publishVersion')"
            :loading="acting"
            :disabled="!publishForm.system.trim()"
            @click="submitPublish"
          />
        </div>
      </template>
    </UModal>

    <!-- Record A2 risk-integration evidence -->
    <UModal v-model:open="showRisk" :title="t('aiAgents.riskIntegrationTitle')">
      <template #body>
        <div class="space-y-4">
          <p class="text-xs text-warning">{{ t('aiAgents.riskIntegrationHint') }}</p>
          <UFormField :label="t('aiAgents.riskTests')" required>
            <UInput v-model="riskForm.tests" :placeholder="t('aiAgents.riskTestsPlaceholder')" class="w-full font-mono text-[11px]" />
          </UFormField>
          <UFormField :label="t('aiAgents.riskEvidenceProvided')">
            <UTextarea v-model="riskForm.evidence" :rows="3" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="soft" :label="t('common.cancel')" @click="showRisk = false" />
          <UButton
            color="warning"
            variant="soft"
            :label="t('aiAgents.riskIntegration')"
            :loading="acting"
            :disabled="!riskForm.tests.trim()"
            @click="submitRisk"
          />
        </div>
      </template>
    </UModal>

    <LazyBaseConfirmModal
      v-model:open="showDisable"
      :title="t('aiAgents.disableConfirmTitle')"
      :description="t('aiAgents.disableConfirm')"
      @confirm="confirmDisable"
    />
  </BasePage>
</template>
