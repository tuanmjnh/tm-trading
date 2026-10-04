<script setup lang="ts">
import { format } from 'date-fns'
import type { InboxDetail } from '~/types/inbox'
import { parseAddress, sanitizeEmailHtml, formatBytes } from '~/utils/inboxHtml'

const { t } = useI18n()

const props = defineProps<{
  thread: InboxDetail[]
  loading?: boolean
}>()

const emit = defineEmits<{
  back: []
  reply: [body: string]
  toggleUnread: [message: InboxDetail]
  toggleStar: [message: InboxDetail]
  download: [message: InboxDetail, attachmentId: string, filename: string, mimeType: string]
}>()

const subject = computed(() => props.thread[0]?.subject || t('inbox.noSubject'))

const reply = ref('')
const sending = ref(false)

function onReply() {
  const body = reply.value.trim()
  if (!body || sending.value) return
  sending.value = true
  emit('reply', body)
  reply.value = ''
  // sending is reset from page after send completes - safety timeout
  setTimeout(() => {
    sending.value = false
  }, 1500)
}

function senderOf(msg: InboxDetail) {
  const parsed = parseAddress(msg.from)
  return { name: parsed.name || parsed.email, email: parsed.email }
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div class="flex items-center gap-2 px-4 py-3 border-b border-default shrink-0">
      <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" class="lg:hidden -ms-1.5"
        @click="emit('back')" />
      <h2 class="font-semibold text-highlighted text-sm truncate flex-1">
        {{ subject }}
      </h2>
      <UBadge v-if="thread[0]" :label="`${thread.length}`" color="neutral" variant="subtle" size="sm" />
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <USkeleton v-if="loading && !thread.length" class="h-40 rounded-none" />

      <article v-for="msg in thread" :key="msg.id" class="border-b border-default p-4 sm:p-6">
        <header class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-highlighted truncate">
              {{ senderOf(msg).name }}
            </p>
            <p class="text-xs text-muted truncate">
              {{ senderOf(msg).email }}
              <template v-if="msg.to">
                · {{ t('inbox.to') }}: {{ msg.to }}
              </template>
            </p>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <time v-if="msg.date" :datetime="msg.date" class="text-[11px] text-muted">
              {{ format(new Date(msg.date), 'dd MMM yyyy, HH:mm') }}
            </time>
            <UTooltip :text="msg.unread ? t('inbox.markRead') : t('inbox.markUnread')">
              <UButton :icon="msg.unread ? 'i-lucide-mail-open' : 'i-lucide-mail'" color="neutral" variant="ghost"
                size="xs" @click="emit('toggleUnread', msg)" />
            </UTooltip>
            <UTooltip :text="msg.starred ? t('inbox.unstar') : t('inbox.star')">
              <UButton :icon="msg.starred ? 'i-lucide-star' : 'i-lucide-star'"
                :color="msg.starred ? 'warning' : 'neutral'" :class="msg.starred ? 'fill-warning' : ''" variant="ghost"
                size="xs" @click="emit('toggleStar', msg)" />
            </UTooltip>
          </div>
        </header>

        <div v-if="msg.bodyHtml" class="text-sm text-default leading-relaxed email-body"
          v-html="sanitizeEmailHtml(msg.bodyHtml)" />
        <p v-else class="text-sm text-default leading-relaxed whitespace-pre-wrap">
          {{ msg.bodyText }}
        </p>

        <div v-if="msg.attachments.length" class="flex flex-wrap gap-2 mt-4">
          <button v-for="att in msg.attachments" :key="att.filename + (att.id || '')" type="button" variant="soft"
            class="flex items-center gap-2 rounded-lg bg-default ring ring-default px-3 py-1.5 text-xs hover:bg-elevated/50 transition-colors"
            :disabled="!att.id" @click="att.id && emit('download', msg, att.id, att.filename, att.mimeType)">
            <UIcon name="i-lucide-paperclip" class="size-3.5 text-muted" />
            <span class="truncate max-w-40">{{ att.filename }}</span>
            <span class="text-muted">{{ formatBytes(att.size) }}</span>
          </button>
        </div>
      </article>

      <div v-if="!loading && !thread.length" class="p-8 text-center text-sm text-muted">
        {{ t('inbox.emptyThread') }}
      </div>
    </div>

    <div class="p-4 sm:px-6 border-t border-default shrink-0">
      <UCard variant="subtle" :ui="{ header: 'flex items-center gap-1.5 text-dimmed' }">
        <template #header>
          <UIcon name="i-lucide-reply" class="size-4" />
          <span class="text-sm truncate">
            {{ t('inbox.replyTo', [senderOf(thread[thread.length - 1] || ({ from: '' } as InboxDetail)).email]) }}
          </span>
        </template>

        <form @submit.prevent="onReply">
          <UTextarea v-model="reply" color="neutral" variant="none" required autoresize
            :placeholder="t('inbox.replyPlaceholder')" :rows="3" :disabled="sending || !thread.length" class="w-full"
            :ui="{ base: 'p-0 resize-none' }" />

          <div class="flex items-center justify-end gap-2 mt-2">
            <UButton type="submit" color="primary" variant="soft" :loading="sending" :disabled="!thread.length"
              :label="t('inbox.send')" icon="i-lucide-send" size="sm" />
          </div>
        </form>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
.email-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
}

.email-body :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
}

.email-body :deep(table) {
  max-width: 100%;
}
</style>
