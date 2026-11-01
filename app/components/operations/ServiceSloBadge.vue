<script setup lang="ts">
import type { OperationsSloStatus } from '#shared/types/operations'

// =============================================================================
//  ServiceSloBadge (V4.2 §17.13) — the SLO verdict for one service.
//
//  Rendered honestly: `unknown` (not measured) is neutral grey and is never
//  dressed up as a pass, and every colour has a label so it does not rely on
//  colour alone.
// =============================================================================

const props = defineProps<{ status: OperationsSloStatus }>()

const { t } = useI18n()

const COLOR: Record<OperationsSloStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  ok: 'success',
  'at-risk': 'warning',
  breached: 'error',
  unknown: 'neutral',
}
</script>

<template>
  <UBadge
    :color="COLOR[props.status]"
    variant="subtle"
    size="xs"
    :title="t('operations.services.slo.title')"
    :label="t(`operations.services.slo.${props.status}`)"
  />
</template>
