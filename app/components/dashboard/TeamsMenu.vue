<script setup lang="ts">
defineProps<{
  collapsed?: boolean
}>()
const { t } = useI18n()
const appConfig = useAppConfig()
</script>

<template>
  <div class="flex items-center gap-2 px-1 py-1.5 select-none w-full min-h-10"
    :class="collapsed ? 'justify-center' : 'justify-between'">
    <div class="flex items-center gap-2.5 min-w-0">
      <!-- Brand Logo Icon -->
      <MediaVisual src="/logo.svg" size="w-7 h-7" />

      <!-- Brand Name & Version (hidden when collapsed) -->
      <Transition enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200" enter-from-class="opacity-0" leave-to-class="opacity-0">
        <div v-if="!collapsed" class="flex flex-col min-w-0 leading-tight">
          <span class="text-sm font-bold text-highlighted truncate tracking-wide">
            {{ appConfig.system.app_name }}
          </span>
          <span class="text-[10px] text-muted tracking-wider uppercase font-semibold truncate whitespace-nowrap">
            v{{ appConfig.system.app_version }}
          </span>
        </div>
      </Transition>
    </div>

    <!-- Live indicator badge with icon and i18n -->
    <!-- <div v-if="!collapsed" class="shrink-0 flex items-center">
      <UBadge color="success" variant="subtle" size="xs" class="gap-1.5 font-medium px-2 py-0.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>{{ t('dashboard.ready') }}</span>
      </UBadge>
    </div> -->
  </div>
</template>
