<script setup lang="ts">
const { t } = useI18n()

const { title, description } = useAdminPageChrome({
  titleKey: 'nav.docs',
  descKey: 'docs.description'
})

useHead({ title })

const apis = computed(() => [
  { module: 'Auth (IAM)', method: 'POST', path: '/api/v1/auth/login', desc: t('docs.api.login') },
  { module: 'Auth (IAM)', method: 'POST', path: '/api/v1/auth/refresh', desc: t('docs.api.refresh') },
  { module: 'Auth (IAM)', method: 'GET', path: '/api/v1/auth/me', desc: t('docs.api.me') },
  { module: 'Auth (IAM)', method: 'GET', path: '/api/v1/auth/routes', desc: t('docs.api.routes') },
  { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs', desc: t('docs.api.getConfigs') },
  { module: 'Remote Configs', method: 'PUT', path: '/api/v1/apps/:appId/configs', desc: t('docs.api.updateConfigs') },
  { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs/public', desc: t('docs.api.getPublicConfigs') },
  { module: 'Media Gateway', method: 'GET', path: '/api/v1/apps/:appId/media/folders', desc: t('docs.api.getMediaFolders') },
  { module: 'Media Gateway', method: 'GET', path: '/api/v1/apps/:appId/media/resources', desc: t('docs.api.getMediaResources') },
  { module: 'Media Gateway', method: 'POST', path: '/api/v1/apps/:appId/media/signature', desc: t('docs.api.getMediaSignature') },
  { module: 'Media Gateway', method: 'DELETE', path: '/api/v1/apps/:appId/media/resources', desc: t('docs.api.deleteMediaResource') },
  { module: 'Notifications', method: 'POST', path: '/api/v1/apps/:appId/notifications/subscribe', desc: t('docs.api.subscribeNotification') },
  { module: 'Notifications', method: 'GET', path: '/api/v1/apps/:appId/notifications', desc: t('docs.api.getNotifications') },
  { module: 'Notifications', method: 'POST', path: '/api/v1/apps/:appId/notifications/send', desc: t('docs.api.sendNotification') }
])

const searchQuery = ref('')
const selectedModule = ref('ALL')

const modulesList = computed(() => {
  const set = new Set(apis.value.map(a => a.module))
  return ['ALL', ...Array.from(set)]
})

const filteredApis = computed(() => {
  return apis.value.filter((api) => {
    const matchModule = selectedModule.value === 'ALL' || api.module === selectedModule.value
    const q = searchQuery.value.trim().toLowerCase()
    const matchQuery = !q
      || api.path.toLowerCase().includes(q)
      || api.desc.toLowerCase().includes(q)
      || api.module.toLowerCase().includes(q)
    return matchModule && matchQuery
  })
})

function getMethodBadgeColor(method: string) {
  switch (method) {
    case 'GET': return 'success'
    case 'POST': return 'primary'
    case 'PUT': return 'warning'
    case 'DELETE': return 'error'
    default: return 'neutral'
  }
}

const mobileBar = useMobileBar()
mobileBar.registerInfo(computed(() => ({
  count: filteredApis.value.length
})))
</script>

<template>
  <BasePage id="docs" :title="title" :description="description">
    <template #right>
      <UButton icon="i-lucide-refresh-cw" variant="soft" size="sm" @click="reloadNuxtApp()" />
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <UInput v-model="searchQuery" icon="i-lucide-search" :placeholder="t('docs.searchPlaceholder')" size="sm"
              class="flex-1 min-w-0 sm:flex-none sm:w-64" />
            <USelect v-model="selectedModule"
              :items="modulesList.map(m => ({ label: m === 'ALL' ? t('docs.allModules') : m, value: m }))" size="sm"
              class="w-36 shrink-0 sm:w-40" />
          </div>
        </template>
        <template #right>
          <div class="hidden sm:flex">
            <UBadge :label="t('docs.endpointsCount', { filtered: filteredApis.length, total: apis.length })"
              variant="subtle" size="sm" />
          </div>
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter :count="filteredApis.length" />
    </template>

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <!-- 1. Core Architecture Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <UCard class="hover:border-primary/40 transition-colors">
          <div class="flex items-center gap-3">
            <div class="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
              <UIcon name="i-lucide-shield-check" class="flex w-5 h-5" />
            </div>
            <div class="space-y-1 min-w-0">
              <h3 class="font-semibold text-sm truncate">{{ t('docs.architecture.iamTitle') }}</h3>
              <p class="text-xs text-muted leading-relaxed line-clamp-3">
                {{ t('docs.architecture.iamDesc') }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard class="hover:border-emerald-500/40 transition-colors">
          <div class="flex items-center gap-3">
            <div class="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
              <UIcon name="i-lucide-sliders" class="flex w-5 h-5" />
            </div>
            <div class="space-y-1 min-w-0">
              <h3 class="font-semibold text-sm truncate">{{ t('docs.architecture.remoteConfigsTitle') }}</h3>
              <p class="text-xs text-muted leading-relaxed line-clamp-3">
                {{ t('docs.architecture.remoteConfigsDesc') }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard class="hover:border-amber-500/40 transition-colors">
          <div class="flex items-center gap-3">
            <div class="p-2.5 rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
              <UIcon name="i-lucide-cloud-upload" class="flex w-5 h-5" />
            </div>
            <div class="space-y-1 min-w-0">
              <h3 class="font-semibold text-sm truncate">{{ t('docs.architecture.mediaGatewayTitle') }}</h3>
              <p class="text-xs text-muted leading-relaxed line-clamp-3">
                {{ t('docs.architecture.mediaGatewayDesc') }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard class="hover:border-rose-500/40 transition-colors">
          <div class="flex items-center gap-3">
            <div class="p-2.5 rounded-lg bg-rose-500/10 text-rose-500 shrink-0">
              <UIcon name="i-lucide-bell-ring" class="flex w-5 h-5" />
            </div>
            <div class="space-y-1 min-w-0">
              <h3 class="font-semibold text-sm truncate">{{ t('docs.architecture.notificationsTitle') }}</h3>
              <p class="text-xs text-muted leading-relaxed line-clamp-3">
                {{ t('docs.architecture.notificationsDesc') }}
              </p>
            </div>
          </div>
        </UCard>
      </div>

      <!-- 2. Client SDK Usage -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-terminal" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('docs.sdk.title') }}</h3>
          </div>
        </template>

        <div class="space-y-3">
          <p class="text-xs text-neutral-600 dark:text-neutral-300">
            {{ t('docs.sdk.description', { app: 'tm-tools' }) }}
          </p>
          <pre class="bg-neutral-900 text-neutral-100 p-4 rounded-lg text-xs overflow-x-auto font-mono">
        <code>
          import { createHubClient } from 'tm-hub-client'

          export const hub = createHubClient({
          baseUrl: process.env.NUXT_PUBLIC_HUB_API_URL || 'http://localhost:4000',
          appId: 'tm-tools'
          })

          // 1. Fetch Remote Configs
          const configs = await hub.configs.getAll()

          // 2. IAM Login
          const session = await hub.auth.login({ email: 'admin@example.com', password: 'password' })
        </code>
      </pre>
        </div>
      </UCard>

      <!-- 3. REST API Specifications -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-network" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('docs.api.title') }}</h3>
            </div>
            <UBadge :label="t('docs.api.prefix')" variant="subtle" size="xs" />
          </div>
        </template>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-neutral-200 dark:border-neutral-800 text-muted font-medium">
                <th class="py-2.5 px-3">{{ t('docs.api.module') }}</th>
                <th class="py-2.5 px-3">{{ t('docs.api.method') }}</th>
                <th class="py-2.5 px-3 font-mono">{{ t('docs.api.endpoint') }}</th>
                <th class="py-2.5 px-3">{{ t('docs.api.description') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800/60">
              <tr v-for="api in filteredApis" :key="api.path + api.method"
                class="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/50 transition-colors">
                <td class="py-2.5 px-3 font-medium whitespace-nowrap text-highlighted">{{ api.module }}</td>
                <td class="py-2.5 px-3 whitespace-nowrap">
                  <UBadge :color="getMethodBadgeColor(api.method)" variant="subtle" size="xs">
                    {{ api.method }}
                  </UBadge>
                </td>
                <td class="py-2.5 px-3 font-mono text-primary font-medium whitespace-nowrap">{{ api.path }}</td>
                <td class="py-2.5 px-3 text-muted">{{ api.desc }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>
  </BasePage>
</template>
