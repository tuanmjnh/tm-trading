<script setup lang="ts">
const { t } = useI18n()
const { hubFetch } = useHub()

interface AuditLogItem {
  _id?: string
  appId: string
  docId: string
  modelName: string
  action: string
  by?: {
    _id?: string
    name?: string
    email?: string
    username?: string
  }
  source?: string
  ip?: string
  userAgent?: string
  at: number
  changes?: Record<string, { old: any, new: any }>
}

interface LogsResponse {
  success: boolean
  data: AuditLogItem[]
  nextCursor: number | null
}

const open = defineModel<boolean>('open', { default: false })

const props = withDefaults(defineProps<{
  appId: string
  docId: string
  modelName?: string
  description?: string
}>(), {
  modelName: undefined,
  description: undefined
})

const logs = ref<AuditLogItem[]>([])
const nextCursor = ref<number | null>(null)
const isLoading = ref(false)
const hasMore = computed(() => !!nextCursor.value)

async function fetchLogs(reset = true) {
  if (!props.appId || !props.docId) return
  if (isLoading.value) return
  if (!reset && !nextCursor.value) return

  isLoading.value = true
  try {
    const query: Record<string, unknown> = { limit: 20, docId: props.docId }
    if (!reset && nextCursor.value) query.cursor = nextCursor.value

    const res = await hubFetch<LogsResponse>(
      `/api/v1/apps/${encodeURIComponent(props.appId)}/logs`,
      { query }
    )
    if (res.success && Array.isArray(res.data)) {
      logs.value = reset ? res.data : [...logs.value, ...res.data]
      nextCursor.value = res.nextCursor ?? null
    }
  } catch {
    logs.value = []
    nextCursor.value = null
  } finally {
    isLoading.value = false
  }
}

watch(open, (val) => {
  if (val) {
    logs.value = []
    nextCursor.value = null
    fetchLogs(true)
  }
})
</script>

<template>
  <BaseResponsiveSlideover
    v-model:open="open"
    :title="t('logs.title')"
    :description="description || modelName || docId"
    icon="i-lucide-scroll-text"
    :loading="isLoading"
    :ui="{ content: 'w-screen max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-3">
        <div class="flex items-center gap-2 text-xs text-muted">
          <UIcon name="i-lucide-hash" class="size-3.5" />
          <code class="font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">{{ docId }}</code>
          <UBadge v-if="modelName" :label="modelName" variant="subtle" size="xs" />
        </div>

        <div v-if="isLoading && logs.length === 0" class="flex flex-col items-center justify-center py-12 gap-2">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-primary" />
          <span class="text-xs text-muted">{{ t('common.loading') }}</span>
        </div>

        <div v-else-if="logs.length === 0" class="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <div class="p-3.5 rounded-full bg-primary/10 text-primary">
            <UIcon name="i-lucide-file-x" class="size-6" />
          </div>
          <p class="text-sm text-muted">{{ t('logs.empty') }}</p>
        </div>

        <div v-else class="space-y-2">
          <LogsLogItem v-for="item in logs" :key="item._id || `${item.at}-${item.action}`" :item="item" />

          <div v-if="hasMore" class="flex justify-center pt-2">
            <UButton
              icon="i-lucide-chevron-down"
              :label="t('common.loadMore')"
              variant="soft"
              color="neutral"
              size="sm"
              :loading="isLoading"
              @click="fetchLogs(false)"
            />
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full gap-2">
        <SharedListFooter :count="logs.length" :has-more="hasMore" :loading="isLoading" />
        <UButton :label="t('common.close')" color="neutral" variant="soft" size="sm" @click="open = false" />
      </div>
    </template>
  </BaseResponsiveSlideover>
</template>
