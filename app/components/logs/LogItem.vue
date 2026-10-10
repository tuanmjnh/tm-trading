<script setup lang="ts">
import { formatTimeAgo } from '@vueuse/core'

export interface AuditLogItem {
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

defineProps<{ item: AuditLogItem }>()

const { t } = useI18n()

const expanded = ref(false)

const actionColor = (action: string): 'primary' | 'success' | 'error' | 'warning' | 'neutral' => {
  if (action.includes('delete') || action.includes('failed')) return 'error'
  if (action.includes('create') || action.includes('register')) return 'success'
  if (action.includes('pin')) return 'warning'
  if (action.includes('login') || action.includes('refresh')) return 'primary'
  return 'neutral'
}
</script>

<template>
  <div class="rounded-lg border border-default overflow-hidden bg-elevated/20">
    <button
      type="button"
      class="w-full flex items-center gap-3 p-3 text-left hover:bg-elevated/40 transition-colors"
      @click="expanded = !expanded"
    >
      <UBadge
        :label="item.action"
        :color="actionColor(item.action)"
        variant="subtle"
        size="sm"
        class="shrink-0 font-mono"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 text-xs">
          <span class="font-semibold text-highlighted truncate">{{ item.modelName }}</span>
          <span class="text-muted truncate font-mono">{{ item.docId }}</span>
        </div>
        <div class="flex items-center gap-2 text-[11px] text-dimmed mt-0.5">
          <span>{{ item.by?.name || item.by?.email || 'system' }}</span>
          <span v-if="item.source">· {{ item.source }}</span>
          <span v-if="item.ip">· {{ item.ip }}</span>
        </div>
      </div>
      <time :datetime="new Date(item.at).toISOString()" class="text-[11px] text-muted shrink-0">
        {{ formatTimeAgo(new Date(item.at)) }}
      </time>
      <UIcon
        :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="w-4 h-4 text-muted shrink-0"
      />
    </button>

    <div v-if="expanded" class="px-3 pb-3 border-t border-default pt-2">
      <p v-if="!item.changes" class="text-xs text-muted italic">{{ t('logs.noChanges') }}</p>
      <template v-else>
        <p class="text-[11px] font-semibold text-dimmed uppercase mb-1.5">{{ t('logs.changes') }}</p>
        <div class="space-y-1.5">
          <div
            v-for="(change, field) in item.changes"
            :key="field"
            class="grid grid-cols-12 gap-2 text-xs font-mono"
          >
            <span class="col-span-3 text-dimmed truncate">{{ field }}</span>
            <div class="col-span-4 rounded bg-error/10 text-error px-2 py-1 break-all">
              {{ change.old === null || change.old === undefined ? '—' : JSON.stringify(change.old) }}
            </div>
            <div class="col-span-4 rounded bg-success/10 text-success px-2 py-1 break-all">
              {{ change.new === null || change.new === undefined ? '—' : JSON.stringify(change.new) }}
            </div>
          </div>
        </div>
      </template>
      <div v-if="item.userAgent" class="mt-2 text-[11px] text-dimmed break-all">
        UA: {{ item.userAgent }}
      </div>
    </div>
  </div>
</template>
