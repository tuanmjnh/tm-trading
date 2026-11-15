<script setup lang="ts">
import { HeaderActions as TmHeaderActions } from '@tuanmjnh/tm-ui'
import type { HeaderAction, HeaderActionChild } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  actions: HeaderAction[]
  maxInline?: number
}>(), {
  maxInline: 3
})

const { t } = useI18n()

export type { HeaderAction, HeaderActionChild }
</script>

<template>
  <TmHeaderActions :actions="actions" :max-inline="maxInline" :more-label="t('common.more')" v-bind="$attrs" />
</template>
