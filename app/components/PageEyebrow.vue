<script setup lang="ts">
// Obsidian Apex eyebrow strip (mockup: breadcrumb trail + status pip + engine
// meta, rendered above the page title bar). Presentational only.
export interface EyebrowTrailItem {
  label: string
  to?: string
}

export interface EyebrowMetaItem {
  icon?: string
  label: string
}

withDefaults(defineProps<{
  trail?: EyebrowTrailItem[]
  /** Status pip label (e.g. "V3.3 Immutable Architecture"). */
  pip?: string
  /** Right-hand meta chips. */
  meta?: EyebrowMetaItem[]
}>(), {
  trail: () => [],
  meta: () => []
})
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 pt-3 text-xs">
    <div class="flex items-center gap-2 min-w-0">
      <template v-for="(item, i) in trail" :key="i">
        <span v-if="i" class="text-dimmed">/</span>
        <NuxtLink
          v-if="item.to"
          :to="item.to"
          class="text-dimmed hover:text-toned transition-colors"
        >{{ item.label }}</NuxtLink>
        <span v-else class="text-highlighted font-medium truncate">{{ item.label }}</span>
      </template>
      <span
        v-if="pip"
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-accented text-[10px] uppercase tracking-wide text-info font-semibold shrink-0"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-info" />
        {{ pip }}
      </span>
    </div>
    <div v-if="meta.length" class="flex items-center gap-2 shrink-0">
      <span
        v-for="(m, i) in meta"
        :key="i"
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted text-[11px] text-muted"
      >
        <UIcon v-if="m.icon" :name="m.icon" class="w-3.5 h-3.5" />
        {{ m.label }}
      </span>
    </div>
  </div>
</template>
