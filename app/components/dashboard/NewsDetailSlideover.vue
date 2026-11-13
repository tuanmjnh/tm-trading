<script setup lang="ts">
// News detail (V5.0 §3.6) — the item plus its append-only provenance trail.
// The server already enforces the rights allowlist; this panel adds no scoring.
interface NewsDetailItem {
  id: string
  title: string
  excerpt?: string
  url: string
  sourceId: string
  language?: string
  publishedAt: string | null
  firstSeenAt: string | null
  marketGroup?: string
  eventType?: string | null
  tags?: string[]
  level?: 'high' | 'med' | null
  dir?: 'pos' | 'neg' | 'flat' | null
  score?: number | null
}

interface NewsRevision {
  at: string | null
  kind: string
  prev?: { title?: string, excerpt?: string, level?: string | null, dir?: string | null }
}

interface NewsDetailResponse {
  item: NewsDetailItem
  revisions?: NewsRevision[]
}

const { t } = useI18n()
const overlay = useAppOverlay()

const detail = ref<NewsDetailResponse | null>(null)
const loading = ref(false)
const error = ref('')

const open = computed({
  get: () => overlay.kind.value === 'news',
  set: (value: boolean) => { if (!value) overlay.requestClose() }
})

const newsId = computed(() => (overlay.state.value?.kind === 'news' ? overlay.state.value.payload.id : ''))

async function load() {
  detail.value = null
  error.value = ''
  if (!newsId.value) return
  loading.value = true
  try {
    const res = await $fetch<NewsDetailResponse | null>(`/api/v1/news/${encodeURIComponent(newsId.value)}?detail=full`)
    if (!res?.item) error.value = t('dash.news.notFound')
    else detail.value = res
  } catch {
    error.value = t('dash.news.loadFailed')
  } finally {
    loading.value = false
  }
}

// Mounted only while open: `immediate` covers the first open, the id watch covers
// switching items without closing.
watch([open, newsId], () => { if (open.value) void load() }, { immediate: true })

const fmtUtc = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—')
</script>

<template>
  <LazyBaseResponsiveSlideover v-model:open="open" :title="detail?.item.title || t('dash.news.detail')" icon="i-lucide-newspaper" :loading="loading">
    <div v-if="error" class="p-1">
      <UAlert color="warning" variant="subtle" icon="i-lucide-alert-circle" :title="error" :description="t('dash.news.loadFailedHint')" />
    </div>

    <div v-else-if="detail" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge v-if="detail.item.level" :color="detail.item.level === 'high' ? 'error' : 'neutral'" variant="subtle" size="xs" :label="detail.item.level" />
        <UBadge v-if="detail.item.dir" color="neutral" variant="subtle" size="xs" :label="detail.item.dir" />
        <UBadge color="neutral" variant="subtle" size="xs" :label="detail.item.sourceId" />
        <UBadge v-if="detail.item.eventType" color="info" variant="subtle" size="xs" :label="detail.item.eventType" />
        <UBadge v-if="detail.item.score != null" color="neutral" variant="outline" size="xs" :label="`score ${detail.item.score}`" />
      </div>

      <p v-if="detail.item.excerpt" class="text-sm text-toned leading-relaxed whitespace-pre-line">{{ detail.item.excerpt }}</p>

      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.news.publisher') }}</dt>
          <dd class="text-xs text-highlighted">{{ detail.item.sourceId }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.news.published') }}</dt>
          <dd class="text-xs font-mono text-highlighted">{{ fmtUtc(detail.item.publishedAt) }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.news.ingested') }}</dt>
          <dd class="text-xs font-mono text-highlighted">{{ fmtUtc(detail.item.firstSeenAt) }}</dd>
        </div>
        <div>
          <dt class="text-[10px] uppercase tracking-wider text-muted">{{ t('dash.news.category') }}</dt>
          <dd class="text-xs text-highlighted">{{ detail.item.marketGroup ?? '—' }}</dd>
        </div>
      </dl>

      <div v-if="detail.item.tags?.length">
        <h3 class="text-[10px] uppercase tracking-wider text-muted mb-1">{{ t('dash.news.tags') }}</h3>
        <div class="flex flex-wrap gap-1">
          <UBadge v-for="tag in detail.item.tags" :key="tag" color="neutral" variant="subtle" size="xs" :label="tag" />
        </div>
      </div>

      <UButton
        :label="t('dash.news.open')"
        icon="i-lucide-external-link"
        color="primary"
        variant="soft"
        size="sm"
        :to="detail.item.url"
        target="_blank"
        rel="noopener noreferrer"
      />

      <div v-if="detail.revisions?.length" class="rounded border border-default/60 p-3">
        <h3 class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{{ t('dash.news.revisions') }}</h3>
        <ul class="space-y-1.5">
          <li v-for="(rev, i) in detail.revisions" :key="`rev-${i}`" class="text-[11px] text-toned">
            <span class="font-mono text-dimmed">{{ fmtUtc(rev.at) }}</span>
            <span class="mx-1">·</span>{{ rev.kind }}
            <span v-if="rev.prev?.title" class="block text-muted line-clamp-1">{{ rev.prev.title }}</span>
          </li>
        </ul>
      </div>
    </div>
  </LazyBaseResponsiveSlideover>
</template>
