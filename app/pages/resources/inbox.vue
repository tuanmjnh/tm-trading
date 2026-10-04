<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
import type { InboxDetail, InboxItem, InboxProfile } from '~/types/inbox'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'
import { parseAddress } from '~/utils/inboxHtml'

const { t } = useI18n()
const toast = useToast()
const { hubFetch, appId: hubAppId } = useHub()
const { title, description } = useAdminPageChrome({
  titleKey: 'inbox.title',
  descKey: 'inbox.description'
})
const mobileBar = useMobileBar()

const appId = computed(() => hubAppId)

const profile = ref<InboxProfile | null>(null)
const connected = computed(() => !!profile.value?.connected)

const messages = ref<InboxItem[]>([])
const nextPageToken = ref<string | null>(null)
const listLoading = ref(false)
const threadLoading = ref(false)

const q = ref('')
const searchInput = ref('')

const selectedId = ref<string | null>(null)
const thread = ref<InboxDetail[]>([])

const base = computed(() =>
  appId.value ? `/api/v1/apps/${encodeURIComponent(appId.value)}/mail/inbox` : ''
)

async function loadProfile() {
  if (!base.value) return
  try {
    const res = await hubFetch<{ success: boolean, data: InboxProfile }>(`${base.value}/profile`)
    profile.value = res.data
  } catch (err) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

async function loadMessages(reset = true) {
  if (!base.value) return
  listLoading.value = true
  try {
    const query: Record<string, string> = { maxResults: '15' }
    if (q.value) query.q = q.value
    if (!reset && nextPageToken.value) query.pageToken = nextPageToken.value

    const res = await hubFetch<{ success: boolean, data: { items: InboxItem[], nextPageToken: string | null } }>(
      `${base.value}/messages`,
      { query }
    )
    messages.value = reset ? res.data.items : [...messages.value, ...res.data.items]
    nextPageToken.value = res.data.nextPageToken
  } catch (err) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    listLoading.value = false
  }
}

function runSearch() {
  q.value = searchInput.value.trim()
  nextPageToken.value = null
  loadMessages(true)
}

function clearSearch() {
  searchInput.value = ''
  if (q.value) runSearch()
}

async function openMessage(item: InboxItem) {
  selectedId.value = item.id
  threadLoading.value = true
  thread.value = []
  try {
    const res = await hubFetch<{ success: boolean, data: { id: string, messages: InboxDetail[] } }>(
      `${base.value}/threads/${encodeURIComponent(item.threadId)}`
    )
    thread.value = res.data.messages
  } catch (err) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    threadLoading.value = false
  }
}

function backToList() {
  selectedId.value = null
  thread.value = []
}

function syncListItem(id: string, patch: Partial<InboxItem>) {
  const item = messages.value.find(m => m.id === id)
  if (item) Object.assign(item, patch)
}

async function setLabels(messageId: string, add: string[], remove: string[]) {
  const res = await hubFetch<{ success: boolean, data: InboxItem }>(
    `${base.value}/messages/${encodeURIComponent(messageId)}/labels`,
    { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } }
  )
  return res.data
}

async function toggleUnread(message: InboxDetail) {
  try {
    const add = message.unread ? ['UNREAD'] : []
    const remove = message.unread ? [] : ['UNREAD']
    const updated = await setLabels(message.id, add, remove)
    message.unread = updated.unread
    message.labels = updated.labels
    syncListItem(message.id, { unread: updated.unread, labels: updated.labels })
  } catch (err) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

async function toggleStar(message: InboxDetail) {
  try {
    const add = message.starred ? [] : ['STARRED']
    const remove = message.starred ? ['STARRED'] : []
    const updated = await setLabels(message.id, add, remove)
    message.starred = updated.starred
    message.labels = updated.labels
    syncListItem(message.id, { starred: updated.starred, labels: updated.labels })
  } catch (err) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

async function sendReply(body: string) {
  const first = thread.value[0]
  if (!first) return
  const subject = /^re:/i.test(first.subject || '') ? first.subject : `Re: ${first.subject || t('inbox.noSubject')}`
  try {
    await hubFetch(`${base.value}/messages/send`, {
      method: 'POST',
      body: {
        to: parseAddress(first.from).email,
        subject,
        body,
        threadId: first.threadId
      }
    })
    toast.add({ title: t('inbox.replySent'), icon: 'i-lucide-check', color: 'success' })
    await openMessage({ ...first })
  } catch (err) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

async function downloadAttachment(message: InboxDetail, attachmentId: string, filename: string, mimeType: string) {
  try {
    const buffer = await hubFetch<ArrayBuffer>(
      `${base.value}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachmentId)}`,
      { query: { filename, mimeType }, responseType: 'arraybuffer' } as never
    )
    const blob = new Blob([buffer], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'refresh',
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: () => {
      loadProfile()
      loadMessages(true)
    }
  }
])

mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value)
]))

onMounted(() => {
  loadProfile().then(() => {
    if (connected.value) loadMessages(true)
  })
})

watch(appId, (next) => {
  if (!next) return
  profile.value = null
  messages.value = []
  selectedId.value = null
  thread.value = []
  loadProfile().then(() => {
    if (connected.value) loadMessages(true)
  })
})

useHead({ title })
</script>

<template>
  <BasePage id="inbox" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge v-if="profile" :label="connected && profile.email ? profile.email : t('inbox.notConnected')"
          :color="connected ? 'success' : 'neutral'" variant="subtle" size="sm" class="max-w-48 truncate" />
        <BaseHeaderActions :actions="headerActions" />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <UInput v-model="searchInput" icon="i-lucide-search" :placeholder="t('inbox.searchPlaceholder')" size="sm"
            class="w-full sm:w-72" :ui="{ trailing: 'pe-1.5' }" @keydown.enter="runSearch">
            <template #trailing>
              <UButton v-if="searchInput" icon="i-lucide-x" color="neutral" variant="ghost" size="xs"
                @click="clearSearch" />
              <UButton v-else icon="i-lucide-arrow-right" color="neutral" variant="ghost" size="xs"
                @click="runSearch" />
            </template>
          </UInput>
        </template>
        <template #right>
          <UBadge v-if="q" :label="t('inbox.filtered', [q])" color="info" variant="subtle" size="sm" />
        </template>
      </UDashboardToolbar>
    </template>

    <div class="flex flex-col w-full h-full min-h-0 pb-24 lg:pb-6">
      <UAlert v-if="profile && !connected" color="info" variant="subtle" icon="i-lucide-plug"
        :title="t('inbox.notConnectedTitle')" :description="t('inbox.notConnectedDesc')">
        <template #actions>
          <UButton :label="t('inbox.goToConnections')" icon="i-lucide-plug" size="sm" color="primary" variant="soft"
            @click="navigateTo('/resources/connections')" />
        </template>
      </UAlert>

      <div v-else-if="connected"
        class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(300px,380px),1fr] border border-default rounded-lg overflow-hidden bg-default">
        <div class="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-default"
          :class="selectedId ? 'hidden lg:flex' : 'flex'">
          <div class="flex-1 min-h-0">
            <InboxList v-model:selected-id="selectedId" :messages="messages" :loading="listLoading" />
          </div>
          <div v-if="nextPageToken" class="p-2 border-t border-default flex justify-center shrink-0">
            <UButton :label="t('inbox.loadMore')" icon="i-lucide-chevron-down" color="neutral" variant="soft" size="xs"
              :loading="listLoading" @click="loadMessages(false)" />
          </div>
        </div>

        <div class="min-h-0" :class="selectedId ? 'block' : 'hidden lg:block'">
          <InboxMail v-if="selectedId" :thread="thread" :loading="threadLoading" @back="backToList" @reply="sendReply"
            @toggle-unread="toggleUnread" @toggle-star="toggleStar"
            @download="(msg, attId, filename, mimeType) => downloadAttachment(msg, attId, filename, mimeType)" />
          <div v-else class="hidden lg:flex h-full items-center justify-center text-sm text-muted">
            {{ t('inbox.selectPrompt') }}
          </div>
        </div>
      </div>

      <USkeleton v-else class="flex-1 min-h-40" />
    </div>
  </BasePage>
</template>
