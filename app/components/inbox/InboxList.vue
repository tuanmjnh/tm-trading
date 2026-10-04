<script setup lang="ts">
import { format, isToday } from 'date-fns'
import type { InboxItem } from '~/types/inbox'
import { parseAddress } from '~/utils/inboxHtml'

const { t } = useI18n()

const props = defineProps<{
  messages: InboxItem[]
  loading?: boolean
}>()

const selectedId = defineModel<string | null>('selectedId', { default: null })

const itemsRef = ref<Record<string, Element | null>>({})

watch(selectedId, () => {
  if (!selectedId.value) return
  const ref = itemsRef.value[selectedId.value]
  if (ref) ref.scrollIntoView({ block: 'nearest' })
})

const senderOf = (mail: InboxItem) => {
  const parsed = parseAddress(mail.from)
  return parsed.name || parsed.email || t('inbox.unknownSender')
}

defineShortcuts({
  arrowdown: () => {
    const list = props.messages
    if (!list.length) return
    const index = list.findIndex(m => m.id === selectedId.value)
    if (index === -1) selectedId.value = list[0]?.id || null
    else selectedId.value = list[index + 1]?.id || selectedId.value
  },
  arrowup: () => {
    const list = props.messages
    if (!list.length) return
    const index = list.findIndex(m => m.id === selectedId.value)
    if (index > 0) selectedId.value = list[index - 1]?.id || selectedId.value
  }
})
</script>

<template>
  <div class="h-full overflow-y-auto divide-y divide-default">
    <template v-if="loading && !messages.length">
      <USkeleton v-for="i in 6" :key="i" class="h-20 rounded-none" />
    </template>

    <div v-for="mail in messages" :key="mail.id" :ref="(el) => { itemsRef[mail.id] = el as Element | null }"
      class="p-4 text-sm cursor-pointer border-l-2 transition-colors" :class="[
        mail.unread ? 'text-highlighted' : 'text-toned',
        selectedId === mail.id
          ? 'border-primary bg-primary/10'
          : 'border-bg hover:border-primary hover:bg-primary/5'
      ]" @click="selectedId = mail.id">
      <div class="flex items-center justify-between gap-2" :class="[mail.unread && 'font-semibold']">
        <div class="flex items-center gap-2 min-w-0">
          <UChip color="error" :show="mail.unread" />
          <UIcon v-if="mail.starred" name="i-lucide-star" class="size-3.5 shrink-0 text-warning fill-warning" />
          <span class="truncate">{{ senderOf(mail) }}</span>
        </div>

        <span class="text-[11px] text-muted shrink-0">
          {{ mail.date
            ? (isToday(new Date(mail.date)) ? format(new Date(mail.date), 'HH:mm') : format(new Date(mail.date), 'ddMMM'))
            : '' }}
        </span>
      </div>
      <p class="truncate mt-1" :class="[mail.unread && 'font-semibold']">
        {{ mail.subject || t('inbox.noSubject') }}
      </p>
      <p class="text-dimmed line-clamp-2 text-xs">
        {{ mail.snippet }}
      </p>
    </div>

    <div v-if="!loading && !messages.length" class="p-8 text-center text-sm text-muted">
      {{ t('inbox.emptyList') }}
    </div>
  </div>
</template>
