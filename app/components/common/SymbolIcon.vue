<script setup lang="ts">
/**
 * Coin icon for a trading symbol — resolves the BASE asset (NEARUSDT.P ->
 * NEAR) against the community icon CDN, falling back to a two-letter avatar
 * when the asset has no icon (new/small listings).
 */
const props = withDefaults(defineProps<{
  symbol: string
  /** Tailwind size class, default size-4. */
  size?: string
}>(), { size: 'size-4' })

const failed = ref(false)

const base = computed(() => props.symbol
  .replace(/\.(P|K)$/i, '')
  .replace(/(USDT|USDC|FDUSD|BUSD|TUSD|USD|PERP)$/i, '')
  .toUpperCase())

const src = computed(() =>
  `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${base.value.toLowerCase()}.png`)
</script>

<template>
  <img
    v-if="!failed && base"
    :src="src"
    :alt="base"
    :class="[size, 'shrink-0 rounded-full']"
    loading="lazy"
    @error="failed = true"
  >
  <span
    v-else
    :class="[size, 'shrink-0 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center text-[7px] font-bold uppercase']"
  >{{ base.slice(0, 2) || '?' }}</span>
</template>
