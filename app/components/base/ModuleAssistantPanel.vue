<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Phase H (§61.12) — reusable read-only contextual assistant panel.
//
//  The client sends only a scope (module + record id) + a question. The server
//  re-fetches the record with an OWNER-SCOPED (or rights-gated news/outlook)
//  read and answers from that bundle (plus the A0 owner-scoped read tools)
//  only, so switching user/account can never carry a previous context over.
//  Conversations (H5) are persisted server-side per owner and loaded on demand;
//  the panel holds no state the next user could inherit. Nothing here mutates
//  trading state.
// =============================================================================

interface AssistantScope {
  type: 'session' | 'signal' | 'provider' | 'news' | 'market_event' | 'outlook'
  id?: string | null
  source?: 'alerts' | 'engine' | null
  group?: string | null
  horizon?: string | null
}

const props = defineProps<{
  sessionId?: string | null
  scope?: AssistantScope | null
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const notify = useNotify()

interface AssistantAnswer {
  answer: string
  model: string | null
  provider: string | null
  scope: Record<string, string | null | undefined>
  refs: Array<{ kind: string, id: string }>
  toolCalls?: string[]
  truncated?: boolean
  conversation?: { id: string, messageCount: number } | null
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  at: number | null
  model?: string | null
  toolCalls: string[]
  refs: Array<{ kind: string, id: string }>
}

interface ConvSummary {
  id: string
  title: string
  messageCount: number
  lastMessageAt: number | null
  scopeType: string
}

const question = ref('')
const asking = ref(false)
const errorMsg = ref<string | null>(null)
const thread = ref<ChatMsg[]>([])
const conversationId = ref<string | null>(null)
const conversations = ref<ConvSummary[]>([])
const loadingHistory = ref(false)
const historyOpen = ref(false)

const effectiveScope = computed<AssistantScope | null>(() => {
  if (props.scope?.type) return props.scope
  const sessionId = String(props.sessionId || '').trim()
  return sessionId ? { type: 'session', id: sessionId } : null
})

const scopeReady = computed(() => {
  const scope = effectiveScope.value
  if (!scope) return false
  if (scope.type === 'provider') return true
  if (scope.type === 'outlook') return Boolean(scope.id || (scope.group && scope.horizon))
  return Boolean(scope.id)
})

const scopeKey = computed(() => `assistant.scope_${effectiveScope.value?.type ?? 'session'}`)

watch(open, (v) => {
  if (v) {
    errorMsg.value = null
    loadConversations()
  }
})

function toMsg(m: Record<string, unknown>): ChatMsg {
  return {
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
    at: (Number(m.at) || null),
    model: (m.model as string | null) ?? null,
    toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls.map(String) : [],
    refs: Array.isArray(m.refs) ? m.refs as Array<{ kind: string, id: string }> : [],
  }
}

async function loadConversations() {
  loadingHistory.value = true
  try {
    const res = await $fetch<{ success: boolean, data: { items: ConvSummary[] } }>('/api/v1/assistant/conversations', { query: { limit: 20 } })
    conversations.value = res.data.items
  } catch {
    conversations.value = []
  } finally {
    loadingHistory.value = false
  }
}

function startNew() {
  conversationId.value = null
  thread.value = []
  question.value = ''
  errorMsg.value = null
}

async function openConversation(id: string) {
  errorMsg.value = null
  try {
    const res = await $fetch<{ success: boolean, data: { id: string, messages: Record<string, unknown>[] } }>(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`)
    conversationId.value = res.data.id
    thread.value = (res.data.messages ?? []).map(toMsg)
    historyOpen.value = false
  } catch (err) {
    errorMsg.value = getErrorMessage(err, key => t(key))
  }
}

async function removeConversation(id: string) {
  try {
    await $fetch(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (conversationId.value === id) startNew()
    await loadConversations()
  } catch (err) {
    notify.error(t('assistant.failed'), getErrorMessage(err, key => t(key)))
  }
}

async function ask() {
  const q = question.value.trim()
  const scope = effectiveScope.value
  if (!q || !scope || !scopeReady.value || asking.value) return
  asking.value = true
  errorMsg.value = null
  thread.value.push({ role: 'user', content: q, at: Date.now(), model: null, toolCalls: [], refs: [] })
  try {
    const res = await $fetch<{ success: boolean, data: AssistantAnswer }>('/api/v1/assistant/ask', {
      method: 'POST',
      body: { scope, question: q, conversationId: conversationId.value }
    })
    thread.value.push({
      role: 'assistant',
      content: res.data.answer,
      at: Date.now(),
      model: res.data.model,
      toolCalls: res.data.toolCalls ?? [],
      refs: res.data.refs ?? [],
    })
    conversationId.value = res.data.conversation?.id ?? conversationId.value
    question.value = ''
    loadConversations()
  } catch (err) {
    // The failed turn was not persisted server-side; drop the optimistic echo.
    const last = thread.value[thread.value.length - 1]
    if (last && last.role === 'user' && last.content === q) thread.value.pop()
    errorMsg.value = getErrorMessage(err, (key) => t(key))
  } finally {
    asking.value = false
  }
}

</script>

<template>
  <BaseResponsiveSlideover v-model:open="open" side="right" icon="i-lucide-sparkles" :title="t('assistant.title')"
    :description="t('assistant.description', { scope: t(scopeKey) })">
    <template #body>
      <div class="flex flex-col gap-4">
        <UAlert color="neutral" variant="subtle" icon="i-lucide-shield-check" :description="t('assistant.guardrail')" />

        <div v-if="thread.length" class="flex flex-col gap-2">
          <div v-for="(m, i) in thread" :key="i" class="rounded-lg border p-3 flex flex-col gap-1.5"
            :class="m.role === 'user' ? 'border-default bg-elevated/40' : 'border-default'">
            <div class="flex items-center gap-2 text-xs text-muted">
              <UIcon :name="m.role === 'user' ? 'i-lucide-user' : 'i-lucide-sparkles'" class="size-3.5" />
              <span v-if="m.role === 'assistant' && m.model" class="font-mono">{{ m.model }}</span>
              <UBadge v-for="toolName in m.toolCalls" :key="`${i}:${toolName}`" variant="subtle" size="xs" color="neutral">
                {{ toolName }}
              </UBadge>
            </div>
            <p class="text-sm whitespace-pre-wrap leading-relaxed"
              :class="m.role === 'user' ? 'text-default' : 'text-highlighted'">{{ m.content }}</p>
            <div v-if="m.role === 'assistant' && m.refs?.length"
              class="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-default">
              <span class="text-[11px] text-muted">{{ t('assistant.citedRecords') }}:</span>
              <UBadge v-for="r in m.refs" :key="`${i}:${r.kind}:${r.id}`" variant="subtle" size="xs" color="neutral">
                {{ r.kind }}:{{ r.id }}
              </UBadge>
            </div>
          </div>
        </div>

        <form class="flex flex-col gap-2" @submit.prevent="ask">
          <UTextarea v-model="question" :rows="3" :placeholder="t('assistant.questionPlaceholder')" :disabled="asking"
            class="w-full" />
          <div class="flex gap-2">
            <UButton type="submit" icon="i-lucide-send" :label="t('assistant.ask')" color="primary" variant="soft"
              :loading="asking" :disabled="!question.trim() || !scopeReady" class="flex-1" />
            <UButton v-if="conversationId || thread.length" icon="i-lucide-plus" color="neutral" variant="soft"
              :aria-label="t('assistant.newConversation')" :title="t('assistant.newConversation')"
              :disabled="asking" @click="startNew" />
          </div>
        </form>

        <UAlert v-if="errorMsg" color="error" variant="subtle" icon="i-lucide-alert-circle"
          :title="t('assistant.failed')" :description="errorMsg" />

        <p v-if="!thread.length && !asking && !errorMsg" class="text-xs text-muted">
          {{ t('assistant.hint', { scope: t(scopeKey) }) }}
        </p>

        <div class="rounded-lg border border-default">
          <button type="button" class="flex w-full items-center justify-between gap-2 p-2.5 text-sm"
            @click="historyOpen = !historyOpen">
            <span class="flex items-center gap-2 text-highlighted">
              <UIcon name="i-lucide-history" class="size-4" />
              {{ t('assistant.history') }}
            </span>
            <UIcon :name="historyOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted" />
          </button>
          <div v-if="historyOpen" class="flex flex-col gap-1 border-t border-default p-2">
            <p v-if="loadingHistory" class="p-2 text-xs text-muted">{{ t('global.loading') }}</p>
            <p v-else-if="!conversations.length" class="p-2 text-xs text-muted">
              {{ t('assistant.conversationsEmpty') }}
            </p>
            <div v-for="c in conversations" v-else :key="c.id"
              class="group flex items-center gap-2 rounded p-2 hover:bg-elevated/60">
              <button type="button" class="min-w-0 flex-1 text-left" @click="openConversation(c.id)">
                <span class="block truncate text-sm text-highlighted">{{ c.title || c.id }}</span>
                <span class="block text-[11px] text-muted">
                  {{ c.scopeType }} · {{ c.messageCount }} ·
                  {{ c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString() : '—' }}
                </span>
              </button>
              <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="xs"
                :aria-label="t('assistant.deleteConversation')" @click="removeConversation(c.id)" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseResponsiveSlideover>
</template>
