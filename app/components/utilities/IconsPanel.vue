<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <UInput
        v-model="search"
        :placeholder="t('utilities.icons.searchPlaceholder')"
        icon="i-lucide-search"
        class="flex-1"
        :loading="isFetching"
      />
      <div class="flex flex-wrap gap-1.5">
        <UButton
          v-for="c in collections"
          :key="c.value"
          :label="c.label"
          size="xs"
          :color="collection === c.value ? 'primary' : 'neutral'"
          :variant="collection === c.value ? 'solid' : 'soft'"
          @click="collection = c.value"
        />
        <UButton
          v-if="showFavorites"
          :label="t('utilities.icons.favorites')"
          icon="i-lucide-star"
          size="xs"
          color="warning"
          variant="soft"
          @click="showFavorites = false"
        />
        <UButton
          v-else
          :label="`${t('utilities.icons.favorites')} (${favorites.length})`"
          icon="i-lucide-star"
          size="xs"
          color="neutral"
          variant="soft"
          @click="showFavorites = true"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-4 text-xs text-muted">
      <div class="flex items-center gap-2">
        <span>{{ t('utilities.icons.size') }}</span>
        <USlider v-model="previewSize" :min="16" :max="48" class="w-28" />
        <span class="w-8 font-mono">{{ previewSize }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span>{{ t('utilities.icons.color') }}</span>
        <input v-model="previewColor" type="color" class="h-6 w-8 cursor-pointer rounded border border-default bg-transparent" />
      </div>
      <span v-if="!showFavorites">
        <b class="text-highlighted">{{ icons.length }}</b> {{ t('utilities.icons.iconCount') }}
      </span>
      <span v-else>
        <b class="text-highlighted">{{ favorites.length }}</b> {{ t('utilities.icons.iconCount') }}
      </span>
    </div>

    <div
      ref="scrollParent"
      class="max-h-[60vh] overflow-y-auto rounded-xl border border-default p-3"
    >
      <div class="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
        <button
          v-for="icon in displayedIcons"
          :key="icon"
          type="button"
          class="group relative flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-transparent p-2 transition-all hover:border-primary/40 hover:bg-elevated"
          :class="{ 'border-primary bg-primary/10': selected === icon }"
          :title="icon"
          @click="selected = icon"
          @dblclick="copyName(icon)"
        >
          <UIcon
            :name="icon"
            :style="{ width: previewSize + 'px', height: previewSize + 'px', color: previewColor }"
          />
          <span class="w-full truncate text-[9px] leading-tight text-muted group-hover:text-highlighted">
            {{ shortName(icon) }}
          </span>
          <UButton
            :icon="isFavorite(icon) ? 'i-lucide-star' : 'i-lucide-star-off'"
            size="xs"
            color="warning"
            variant="ghost"
            class="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100"
            :aria-label="isFavorite(icon) ? t('utilities.icons.removeFromFavorites') : t('utilities.icons.addToFavorites')"
            @click.stop="toggleFavorite(icon)"
          />
        </button>
      </div>

      <div v-if="isFetching" class="col-span-full flex justify-center py-6">
        <UIcon name="i-lucide-loader-2" class="h-6 w-6 animate-spin text-primary" />
      </div>
      <div v-else-if="!displayedIcons.length" class="col-span-full py-12 text-center text-sm text-muted">
        <template v-if="showFavorites">
          {{ t('utilities.icons.noIconsFound') }}
        </template>
        <template v-else>
          <p>{{ t('utilities.icons.noIconsFound') }}</p>
          <p class="mt-1 text-xs">{{ t('utilities.icons.tryAnotherQuery') }}</p>
        </template>
      </div>
      <div v-else-if="!hasMore && !showFavorites" class="col-span-full py-3 text-center text-xs text-dimmed">
        {{ t('utilities.icons.loading') }}
      </div>
    </div>

    <!-- Detail / snippets -->
    <div v-if="selected" class="space-y-3 rounded-xl border border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-3">
          <UIcon :name="selected" :style="{ width: '32px', height: '32px', color: previewColor }" />
          <div>
            <div class="font-mono text-sm font-semibold text-highlighted">{{ selected }}</div>
            <div class="text-xs text-muted">{{ t('utilities.icons.previewDetails') }}</div>
          </div>
        </div>
        <UButton
          :label="t('utilities.icons.addToFavorites')"
          icon="i-lucide-star"
          size="xs"
          color="warning"
          variant="soft"
          @click="toggleFavorite(selected)"
        />
      </div>

      <div class="space-y-2">
        <div class="text-xs font-semibold text-muted">{{ t('utilities.icons.snippets') }}</div>
        <div class="grid gap-2 lg:grid-cols-3">
          <div v-for="snip in snippets" :key="snip.label" class="space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted">{{ snip.label }}</span>
              <UButton
                icon="i-lucide-copy"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="copyText(snip.code, t('utilities.icons.copiedNotification', { name: selected }))"
              />
            </div>
            <pre class="overflow-auto rounded-lg bg-default/50 p-2 font-mono text-[11px]">{{ snip.code }}</pre>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          :label="t('utilities.icons.copyName')"
          icon="i-lucide-tag"
          size="xs"
          color="neutral"
          variant="soft"
          @click="copyName(selected)"
        />
        <UButton
          :label="t('utilities.icons.copyVue')"
          icon="i-lucide-code-xml"
          size="xs"
          color="neutral"
          variant="soft"
          @click="copySnippet('vue')"
        />
        <UButton
          :label="t('utilities.icons.copyButton')"
          icon="i-lucide-square"
          size="xs"
          color="neutral"
          variant="soft"
          @click="copySnippet('button')"
        />
        <UButton
          :label="t('utilities.icons.copyClass')"
          icon="i-lucide-braces"
          size="xs"
          color="neutral"
          variant="soft"
          @click="copySnippet('class')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useDebounceFn, useInfiniteScroll } from '@vueuse/core'

const { t } = useI18n()
const toast = useToast()

const search = ref('')
const collection = ref('lucide')
const showFavorites = ref(false)
const selected = ref('')
const previewSize = ref(24)
const previewColor = ref('#64748b')

const collections = [
  { label: 'Lucide', value: 'lucide' },
  { label: 'Simple Icons', value: 'simple-icons' }
]

const icons = ref<string[]>([])
const isFetching = ref(false)
const hasMore = ref(false)
const cursor = ref('')
const scrollParent = ref<HTMLElement | null>(null)

const FAVORITES_KEY = 'tm-hub:icon-favorites'
const favorites = ref<string[]>([])
try {
  favorites.value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
} catch { favorites.value = [] }

function persistFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.value))
}

function isFavorite(icon: string) {
  return favorites.value.includes(icon)
}

function toggleFavorite(icon: string) {
  const idx = favorites.value.indexOf(icon)
  if (idx >= 0) favorites.value.splice(idx, 1)
  else favorites.value.push(icon)
  persistFavorites()
}

const displayedIcons = computed(() => {
  if (showFavorites.value) return favorites.value
  return icons.value
})

function shortName(icon: string) {
  return icon.replace(/^i-[a-z-]+-/, '')
}

async function fetchIcons(isLoadMore = false) {
  if (isFetching.value) return
  isFetching.value = true
  try {
    if (!isLoadMore) cursor.value = ''
    const data = await $fetch<{ icons: string[], nextCursor: string, hasMore: boolean }>('/api/icons', {
      query: {
        search: search.value,
        collection: collection.value,
        cursor: cursor.value,
        limit: 100
      }
    })
    if (isLoadMore) icons.value.push(...(data.icons || []))
    else icons.value = data.icons || []
    cursor.value = data.nextCursor || ''
    hasMore.value = data.hasMore
  } catch (e) {
    console.error('Fetch icons error:', e)
  } finally {
    isFetching.value = false
  }
}

const debouncedFetch = useDebounceFn(() => fetchIcons(false), 500)

useInfiniteScroll(
  scrollParent,
  () => {
    if (hasMore.value && !isFetching.value && !showFavorites.value) fetchIcons(true)
  },
  { distance: 80 }
)

watch(collection, () => {
  search.value = ''
  fetchIcons(false)
})
watch(search, () => {
  if (!showFavorites.value) debouncedFetch()
})

onMounted(() => fetchIcons())

const snippets = computed(() => {
  if (!selected.value) return []
  const name = selected.value
  return [
    { label: t('utilities.icons.copyName'), code: name },
    { label: t('utilities.icons.copyVue'), code: `<UIcon name="${name}" />` },
    { label: t('utilities.icons.copyButton'), code: `<UButton icon="${name}" label="..." />` },
    { label: t('utilities.icons.copyClass'), code: `class="${name}"` },
    { label: t('utilities.icons.copyClass'), code: `icon="${name}"` }
  ]
})

async function copyText(text: string, msg?: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: msg || t('utilities.icons.copiedNotification', { name: text }), color: 'success', icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function copyName(icon: string) {
  copyText(icon, t('utilities.icons.copiedNotification', { name: icon }))
}

function copySnippet(kind: 'vue' | 'button' | 'class') {
  const name = selected.value
  if (!name) return
  const code =
    kind === 'vue' ? `<UIcon name="${name}" />`
    : kind === 'button' ? `<UButton icon="${name}" />`
    : name
  copyText(code, t('utilities.icons.copiedNotification', { name }))
}
</script>
