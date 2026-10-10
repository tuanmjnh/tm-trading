<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { App } from '~~/types'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const appsStore = useAppsStore()
const appsApi = useAppsApi()

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  app: App | null
}>()

const schema = z.object({
  name: z.string().min(1, t('error.required')),
  description: z.string().optional(),
  allowedOrigins: z.string().optional(),
  isActive: z.boolean()
})

type Schema = z.output<typeof schema>

const state = reactive<Schema>({
  name: '',
  description: '',
  allowedOrigins: '',
  isActive: true
})

const isLoadingEditData = ref(false)
const isSubmitting = ref(false)
const editingAppId = ref<string | null>(null)

watch(open, async (val) => {
  if (!val) {
    editingAppId.value = null
    isLoadingEditData.value = false
    return
  }

  const app = props.app
  if (!app) return

  editingAppId.value = app.id
  state.name = app.name
  state.description = app.description || ''
  state.allowedOrigins = (app.allowedOrigins || []).join(', ')
  state.isActive = app.isActive

  isLoadingEditData.value = true
  try {
    const res = await appsApi.getApp(app.id)
    if (res.success && res.data) {
      state.name = res.data.name
      state.description = res.data.description || ''
      state.allowedOrigins = (res.data.allowedOrigins || []).join(', ')
      state.isActive = res.data.isActive
    }
  } catch {
    // Keep app fallback info
  } finally {
    isLoadingEditData.value = false
  }
})

async function onSubmit(_event: FormSubmitEvent<Record<string, unknown>>) {
  if (!editingAppId.value || isLoadingEditData.value || isSubmitting.value) return

  isSubmitting.value = true
  try {
    const origins = state.allowedOrigins
      ? state.allowedOrigins.split(',').map(s => s.trim()).filter(Boolean)
      : ['*']

    await appsStore.updateApp(editingAppId.value, {
      name: state.name.trim(),
      description: (state.description || '').trim(),
      allowedOrigins: origins,
      isActive: state.isActive
    })

    notify.success(t('apps.updateSuccess'))
    open.value = false
    editingAppId.value = null
  } catch (err: any) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <BaseFormModal v-model:open="open" :title="t('apps.editApp')" :description="t('apps.editAppDesc')" :schema="schema"
    :state="state" :loading="isSubmitting || isLoadingEditData" :submit-label="t('common.save')"
    :ui="{ content: 'sm:max-w-2xl' }" @submit="onSubmit">
    <div v-if="isLoadingEditData" class="flex flex-col items-center justify-center py-12 space-y-3">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      <span class="text-xs text-muted">{{ t('common.loading') }}</span>
    </div>

    <div v-else class="space-y-4 py-1 overflow-y-auto pe-1">
      <!-- App Basic Info Section -->
      <div class="space-y-3">
        <div class="text-xs font-semibold uppercase tracking-wider text-muted">
          {{ t('apps.step1') }}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField :label="t('apps.appName')" name="name" required>
            <UInput v-model="state.name" :placeholder="t('apps.enterName')" class="w-full" />
          </UFormField>
          <UFormField :label="t('apps.appId')">
            <UInput :model-value="editingAppId || ''" disabled
              class="w-full font-mono text-xs bg-neutral-50 dark:bg-neutral-900" />
          </UFormField>
        </div>

        <UFormField :label="t('apps.allowedOrigins')" name="allowedOrigins">
          <UInput v-model="state.allowedOrigins" placeholder="https://myapp.com, *" class="w-full font-mono text-xs" />
        </UFormField>

        <UFormField :label="t('apps.appDescription')" name="description">
          <UTextarea v-model="state.description" :rows="2" class="w-full text-xs" />
        </UFormField>

        <!-- Active Status Toggle Switch inside edit modal -->
        <div
          class="flex items-center justify-between p-3 rounded-lg bg-neutral-100/50 dark:bg-neutral-800/40 border border-neutral-200 dark:border-neutral-800">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              :class="state.isActive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-neutral-500/10 text-neutral-400'">
              <UIcon :name="state.isActive ? 'i-lucide-check-circle-2' : 'i-lucide-pause-circle'" class="w-4 h-4" />
            </div>
            <div class="space-y-0.5">
              <div class="text-xs font-medium text-highlighted">{{ t('apps.status') }}</div>
              <div class="text-[11px] text-muted">
                {{ state.isActive ? t('apps.active') : t('apps.inactive') }}
              </div>
            </div>
          </div>
          <USwitch v-model="state.isActive" name="isActive" color="primary" />
        </div>
      </div>
    </div>
  </BaseFormModal>
</template>
