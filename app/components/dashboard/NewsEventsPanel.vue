<script setup lang="ts">
// News & Events panel (V5.0 §3.6). Reads the durable news envelope and the
// sourced market-event store; the source/license/dedupe logic stays server-side.
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const { news, marketEvents, loading, failed, newsFreshness } = useDashboardFeed()
const overlay = useAppOverlay()

const tab = ref<'news' | 'events'>('news')

const freshnessColor = computed(() => (newsFreshness.value === 'fresh' ? 'success' : newsFreshness.value === 'stale' ? 'warning' : 'neutral'))
</script>

<template>
  <UCard :ui="{ body: 'p-3 sm:p-4' }">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <UIcon name="i-lucide-newspaper" class="size-4 text-primary" />
        <h2 class="text-sm font-semibold text-highlighted">{{ t('dash.news.title') }}</h2>
        <UBadge
          :color="freshnessColor"
          variant="subtle"
          size="xs"
          :label="t(`dash.freshness.${newsFreshness}`)"
        />
        <UBadge v-if="failed.news" color="warning" variant="subtle" size="xs" icon="i-lucide-database-zap"
          :label="t('intel.mongoDown')" />
        <div class="ms-auto flex gap-1">
          <UButton
            :label="t('dash.news.headlines')"
            size="xs"
            :color="tab === 'news' ? 'primary' : 'neutral'"
            :variant="tab === 'news' ? 'soft' : 'ghost'"
            @click="tab = 'news'"
          />
          <UButton
            :label="t('dash.news.events')"
            size="xs"
            :color="tab === 'events' ? 'primary' : 'neutral'"
            :variant="tab === 'events' ? 'soft' : 'ghost'"
            @click="tab = 'events'"
          />
        </div>
      </div>
    </template>

    <div v-if="loading.news" class="space-y-2">
      <USkeleton v-for="n in 5" :key="n" class="h-8 w-full" />
    </div>

    <template v-else-if="tab === 'news'">
      <AdminEmptyState v-if="!news.length" :title="t('dash.news.empty')" :description="t('dash.news.emptyHint')" icon="i-lucide-newspaper" />
      <ul v-else class="divide-y divide-default/60">
        <li v-for="item in news.slice(0, 12)" :key="item.id" class="py-1.5 min-w-0">
          <button
            type="button"
            class="w-full text-left rounded px-1 py-0.5 hover:bg-elevated/40 min-w-0"
            :aria-label="`${t('dash.news.detail')}: ${item.title}`"
            @click="overlay.open('news', { id: item.id })"
          >
            <p class="text-xs text-highlighted line-clamp-2">{{ item.title }}</p>
            <p class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
              <UBadge :color="item.level === 'high' ? 'error' : 'neutral'" variant="subtle" size="xs" :label="item.level" />
              <span class="font-mono">{{ item.sourceId }}</span>
              <span>·</span>
              <span>{{ item.publishedAt ? formatTimeAgo(new Date(item.publishedAt)) : t('common.unknown') }}</span>
              <span v-if="item.eventType">· {{ item.eventType }}</span>
              <span v-if="item.tags.length" class="text-dimmed">· {{ item.tags.slice(0, 3).join(', ') }}</span>
            </p>
          </button>
        </li>
      </ul>
    </template>

    <template v-else>
      <AdminEmptyState v-if="!marketEvents.length" :title="t('dash.news.noEvents')" :description="t('dash.news.emptyHint')" icon="i-lucide-calendar-clock" />
      <ul v-else class="divide-y divide-default/60">
        <li v-for="ev in marketEvents.slice(0, 12)" :key="ev.id" class="py-1.5 min-w-0">
          <div class="flex items-start gap-2 min-w-0">
            <div class="min-w-0 flex-1">
              <p class="text-xs text-highlighted line-clamp-2">{{ ev.title }}</p>
              <p class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                <UBadge
                  :color="ev.corroboration === 'multi_source' ? 'success' : ev.corroboration === 'contradicted' ? 'error' : 'neutral'"
                  variant="subtle"
                  size="xs"
                  :label="ev.corroboration"
                />
                <span>{{ ev.eventType ?? ev.marketGroup }}</span>
                <span>·</span>
                <span>{{ ev.firstSeenAt ? formatTimeAgo(new Date(ev.firstSeenAt)) : '—' }}</span>
                <span>· {{ ev.independentSources }} {{ t('dash.news.sources') }}</span>
                <span v-if="ev.itemCount" class="text-dimmed">· {{ ev.itemCount }} {{ t('dash.news.items') }}</span>
              </p>
            </div>
            <UBadge v-if="ev.status !== 'active'" color="warning" variant="outline" size="xs" :label="ev.status" />
          </div>
        </li>
      </ul>
    </template>
  </UCard>
</template>
