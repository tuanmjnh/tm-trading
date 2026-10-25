<script setup lang="ts">
// =============================================================================
//  VenueChip — which exchange(s) list this symbol.
//
//  Shows the brand mark when the installed icon collection provides one, and a
//  compact text label otherwise (never a missing glyph, never a fake logo). A
//  `+N` suffix (full venue list in the tooltip) marks rows the universe lists
//  on more than one venue.
// =============================================================================
import { venueMeta } from '~/utils/venueMeta'

const props = withDefaults(defineProps<{
  /** Venue ids, first one is the badge (universe union order). */
  venues?: string[] | null
  /** Fallback provenance id when no venue list is known. */
  source?: string | null
  /** Tighter padding/label for dense lists (watchlist rows). */
  dense?: boolean
}>(), { venues: null, source: null, dense: false })

const venueId = computed<string | null>(() => {
  const first = props.venues?.find((v) => !!v)
  return first ?? props.source ?? null
})

const meta = computed(() => venueMeta(venueId.value))

const extra = computed(() => Math.max((props.venues?.length ?? 0) - 1, 0))

const title = computed(() => {
  const list = (props.venues?.length ? props.venues : [props.source ?? '']).filter(Boolean)
  return list.map((v) => venueMeta(v).label).join(' · ')
})
</script>

<template>
  <span
    v-if="venueId"
    class="flex items-center gap-1 rounded bg-elevated/60 font-medium text-muted shrink-0 max-w-full overflow-hidden"
    :class="dense ? 'px-1 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'"
    :title="title"
    data-testid="venue-chip"
    :data-venue="meta.id"
  >
    <UIcon v-if="meta.icon" :name="meta.icon!" class="size-3 shrink-0" />
    <!-- Dense (watchlist) keeps only the logo when there is one and drops the
         word and the +N, so a narrow column is not eaten by the chip. -->
    <span v-if="!dense || !meta.icon" class="truncate">{{ meta.short }}</span>
    <span v-if="extra && !dense" class="text-dimmed shrink-0">+{{ extra }}</span>
  </span>
</template>
