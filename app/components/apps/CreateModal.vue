<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const appsStore = useAppsStore()

const open = defineModel<boolean>('open', { default: false })

const props = defineProps<{
  /** Prefill step-1 fields for the row "Copy" action (nuxt4-cms duplicate pattern). */
  initialData?: { name?: string, description?: string, allowedOrigins?: string, isActive?: boolean } | null
}>()

const schema = z.object({
  id: z.string().min(1, t('error.required')).refine(val => isValidAppId(val), t('error.validation')),
  name: z.string().min(1, t('error.required')),
  description: z.string().optional(),
  allowedOrigins: z.string().optional(),
  isActive: z.boolean()
})

type Schema = z.output<typeof schema>

const state = reactive<Schema>({
  id: '',
  name: '',
  description: '',
  allowedOrigins: '',
  isActive: true
})

const createStep = ref<1 | 2 | 3>(1)
const isSubmitting = ref(false)
const formModalRef = ref<{ submit?: () => void } | null>(null)

const standardConfigs = reactive({
  APP_PORT: '3000',
  APP_ENV: 'production',
  AI_PROVIDER: 'openai',
  AI_MODEL: 'gpt-4o-mini',
  AI_API_KEY: '',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: ''
})

const customConfigs = ref<Array<{ key: string, value: string }>>([])

function addCustomConfig() {
  customConfigs.value.push({ key: '', value: '' })
}

function removeCustomConfig(index: number) {
  customConfigs.value.splice(index, 1)
}

function loadSamplePresets() {
  standardConfigs.APP_PORT = '3000'
  standardConfigs.APP_ENV = 'production'
  standardConfigs.AI_PROVIDER = 'openai'
  standardConfigs.AI_MODEL = 'gpt-4o-mini'
  standardConfigs.AI_API_KEY = 'sk-proj-demo-api-key-replace-me'
  standardConfigs.CLOUDINARY_CLOUD_NAME = 'demo-cloud'
  standardConfigs.CLOUDINARY_API_KEY = '1234567890'
  standardConfigs.CLOUDINARY_API_SECRET = 'demo-cloudinary-secret'
  notify.success(t('apps.loadTemplate'))
}

function resetForm() {
  createStep.value = 1
  state.id = generateSecureId('app', 8)
  state.name = ''
  state.description = ''
  state.allowedOrigins = 'http://localhost:3000, app://electron, *'
  state.isActive = true

  standardConfigs.APP_PORT = '3000'
  standardConfigs.APP_ENV = 'production'
  standardConfigs.AI_PROVIDER = 'openai'
  standardConfigs.AI_MODEL = 'gpt-4o-mini'
  standardConfigs.AI_API_KEY = ''
  standardConfigs.CLOUDINARY_CLOUD_NAME = ''
  standardConfigs.CLOUDINARY_API_KEY = ''
  standardConfigs.CLOUDINARY_API_SECRET = ''
  customConfigs.value = []
}

watch(open, (val) => {
  if (val) {
    resetForm()
    if (props.initialData) {
      state.name = props.initialData.name ?? state.name
      state.description = props.initialData.description ?? state.description
      state.allowedOrigins = props.initialData.allowedOrigins ?? state.allowedOrigins
      state.isActive = props.initialData.isActive ?? state.isActive
      // Keep id unique: regenerate from the copied name (name watcher only fires on change).
      if (state.name) state.id = generateAppId(state.name)
    }
  }
})

watch(() => state.name, (newName) => {
  if (newName && (!state.id || state.id.startsWith('app_'))) {
    state.id = generateAppId(newName)
  }
})

function goToPrevStep() {
  if (createStep.value > 1) {
    createStep.value = (createStep.value - 1) as 1 | 2
  }
}

const compiledCreateConfigs = computed(() => {
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(standardConfigs)) {
    if (val && val.trim()) {
      result[key] = val.trim()
    }
  }
  for (const item of customConfigs.value) {
    if (item.key && item.key.trim() && item.value && item.value.trim()) {
      result[item.key.trim()] = item.value.trim()
    }
  }
  return result
})

async function onSubmit(_event: FormSubmitEvent<Record<string, unknown>>) {
  if (createStep.value < 3) {
    createStep.value = (createStep.value + 1) as 2 | 3
    return
  }

  if (isSubmitting.value) return
  isSubmitting.value = true
  try {
    const origins = state.allowedOrigins
      ? state.allowedOrigins.split(',').map(s => s.trim()).filter(Boolean)
      : ['*']

    await appsStore.createApp({
      id: state.id.trim(),
      name: state.name.trim(),
      description: (state.description || '').trim(),
      allowedOrigins: origins,
      isActive: state.isActive,
      configs: compiledCreateConfigs.value
    })

    notify.success(t('apps.createSuccess'))
    open.value = false
  } catch (err: any) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <BaseFormModal ref="formModalRef" v-model:open="open" :title="t('apps.newApp')" :description="t('apps.description')"
    :schema="schema" :state="state" :loading="isSubmitting" :ui="{ content: 'sm:max-w-2xl' }" @submit="onSubmit">
    <!-- Step Indicator Header -->
    <div class="flex items-center justify-between pb-4 mb-4 border-b border-neutral-100 dark:border-neutral-800">
      <div class="flex items-center gap-2">
        <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          :class="createStep >= 1 ? 'bg-primary text-white shadow-xs' : 'bg-neutral-100 dark:bg-neutral-800 text-muted'">
          1
        </span>
        <div class="text-left hidden sm:block">
          <div class="text-xs font-semibold" :class="createStep === 1 ? 'text-primary' : 'text-muted'">
            {{ t('apps.step1') }}
          </div>
          <div class="text-[10px] text-muted">{{ t('apps.step1Desc') }}</div>
        </div>
      </div>

      <div class="h-0.5 flex-1 mx-3 bg-neutral-200 dark:bg-neutral-800" />

      <div class="flex items-center gap-2">
        <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          :class="createStep >= 2 ? 'bg-primary text-white shadow-xs' : 'bg-neutral-100 dark:bg-neutral-800 text-muted'">
          2
        </span>
        <div class="text-left hidden sm:block">
          <div class="text-xs font-semibold" :class="createStep === 2 ? 'text-primary' : 'text-muted'">
            {{ t('apps.step2') }}
          </div>
          <div class="text-[10px] text-muted">{{ t('apps.step2Desc') }}</div>
        </div>
      </div>

      <div class="h-0.5 flex-1 mx-3 bg-neutral-200 dark:bg-neutral-800" />

      <div class="flex items-center gap-2">
        <span class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          :class="createStep === 3 ? 'bg-primary text-white shadow-xs' : 'bg-neutral-100 dark:bg-neutral-800 text-muted'">
          3
        </span>
        <div class="text-left hidden sm:block">
          <div class="text-xs font-semibold" :class="createStep === 3 ? 'text-primary' : 'text-muted'">
            {{ t('apps.step3') }}
          </div>
          <div class="text-[10px] text-muted">{{ t('apps.step3Desc') }}</div>
        </div>
      </div>
    </div>

    <!-- STEP 1: Basic App Information -->
    <div v-if="createStep === 1" class="space-y-4 py-1">
      <UFormField :label="t('apps.appName')" name="name" required>
        <UInput v-model="state.name" :placeholder="t('apps.enterName')" icon="i-lucide-box" class="w-full" autofocus />
      </UFormField>

      <UFormField :label="t('apps.appId')" name="id" required>
        <InputsAppId v-model="state.id" :source-name="state.name" />
      </UFormField>

      <UFormField :label="t('apps.allowedOrigins')" name="allowedOrigins" :description="t('apps.originsHint')">
        <UInput v-model="state.allowedOrigins" :placeholder="t('apps.enterOrigins')" icon="i-lucide-globe"
          class="w-full" />
      </UFormField>

      <UFormField :label="t('apps.appDescription')" name="description">
        <UTextarea v-model="state.description" :placeholder="t('apps.enterDescPlaceholder')" :rows="2" class="w-full" />
      </UFormField>

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

    <!-- STEP 2: Service Configurations -->
    <div v-else-if="createStep === 2" class="space-y-4 py-1 max-h-[60vh] overflow-y-auto pe-1">
      <!-- Preset action toolbar -->
      <div class="flex items-center justify-between p-2.5 rounded-lg bg-primary/5 border border-primary/20">
        <div class="text-xs text-primary font-medium flex items-center gap-1.5">
          <UIcon name="i-lucide-sparkles" class="w-4 h-4" />
          <span>{{ t('apps.step2Desc') }}</span>
        </div>
        <UButton icon="i-lucide-wand-2" :label="t('apps.loadTemplate')" variant="soft" color="primary" size="xs"
          type="button" @click="loadSamplePresets" />
      </div>

      <!-- General / Server Config -->
      <div class="space-y-2 pt-1">
        <div class="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <UIcon name="i-lucide-server" class="w-3.5 h-3.5 text-primary" />
          <span>{{ t('apps.generalSettings') }}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField :label="t('apps.appPort')">
            <UInput v-model="standardConfigs.APP_PORT" placeholder="3000" class="w-full font-mono text-xs" />
          </UFormField>
          <UFormField :label="t('apps.appEnv')">
            <UInput v-model="standardConfigs.APP_ENV" placeholder="production" class="w-full font-mono text-xs" />
          </UFormField>
        </div>
      </div>

      <!-- AI LLM Config -->
      <div class="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <div class="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <UIcon name="i-lucide-bot" class="w-3.5 h-3.5 text-emerald-500" />
          <span>{{ t('apps.aiSettings') }}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField :label="t('apps.aiProvider')">
            <UInput v-model="standardConfigs.AI_PROVIDER" placeholder="openai" class="w-full font-mono text-xs" />
          </UFormField>
          <UFormField :label="t('apps.aiModel')">
            <UInput v-model="standardConfigs.AI_MODEL" placeholder="gpt-4o-mini" class="w-full font-mono text-xs" />
          </UFormField>
        </div>
        <UFormField :label="t('apps.aiApiKey')">
          <UInput v-model="standardConfigs.AI_API_KEY" type="password" placeholder="sk-..."
            class="w-full font-mono text-xs" />
        </UFormField>
      </div>

      <!-- Cloudinary Media Config -->
      <div class="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <div class="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <UIcon name="i-lucide-cloud-upload" class="w-3.5 h-3.5 text-amber-500" />
          <span>{{ t('apps.mediaSettings') }}</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField :label="t('apps.cloudinaryCloud')">
            <UInput v-model="standardConfigs.CLOUDINARY_CLOUD_NAME" placeholder="cloud-name"
              class="w-full font-mono text-xs" />
          </UFormField>
          <UFormField :label="t('apps.cloudinaryApiKey')">
            <UInput v-model="standardConfigs.CLOUDINARY_API_KEY" placeholder="1234567890"
              class="w-full font-mono text-xs" />
          </UFormField>
        </div>
        <UFormField :label="t('apps.cloudinarySecret')">
          <UInput v-model="standardConfigs.CLOUDINARY_API_SECRET" type="password" placeholder="secret-key"
            class="w-full font-mono text-xs" />
        </UFormField>
      </div>

      <!-- Custom Configs section -->
      <div class="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <div class="flex items-center justify-between">
          <div class="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
            <UIcon name="i-lucide-sliders" class="w-3.5 h-3.5 text-cyan-500" />
            <span>{{ t('apps.customConfigs') }}</span>
          </div>
          <UButton icon="i-lucide-plus" :label="t('apps.addConfig')" variant="ghost" color="primary" size="xs"
            type="button" @click="addCustomConfig" />
        </div>

        <div v-if="customConfigs.length === 0" class="text-xs text-neutral-400 italic py-1">
          {{ t('apps.noConfigsYet') }}
        </div>

        <div v-for="(item, idx) in customConfigs" :key="idx" class="flex items-center gap-2">
          <UInput v-model="item.key" :placeholder="t('apps.configKey')" class="flex-1 font-mono text-xs" />
          <UInput v-model="item.value" :placeholder="t('apps.configValue')" class="flex-1 font-mono text-xs" />
          <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" type="button"
            @click="removeCustomConfig(idx)" />
        </div>
      </div>
    </div>

    <!-- STEP 3: Review & Summary -->
    <div v-else-if="createStep === 3" class="space-y-4 py-1">
      <div class="p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-elevated/40 space-y-2.5">
        <div class="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <UIcon name="i-lucide-check-circle" class="w-4 h-4 text-primary" />
          <span>{{ t('apps.summaryTitle') }}</span>
        </div>
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span class="text-muted">{{ t('apps.appName') }}:</span>
            <div class="font-semibold text-sm text-highlighted mt-0.5">{{ state.name }}</div>
          </div>
          <div>
            <span class="text-muted">{{ t('apps.appId') }}:</span>
            <div class="font-mono text-primary font-semibold text-sm mt-0.5">{{ state.id }}</div>
          </div>
          <div>
            <span class="text-muted">{{ t('apps.status') }}:</span>
            <div class="mt-0.5">
              <UBadge :color="state.isActive ? 'success' : 'neutral'"
                :label="state.isActive ? t('apps.active') : t('apps.inactive')" size="xs" variant="subtle" />
            </div>
          </div>
          <div>
            <span class="text-muted">{{ t('apps.allowedOrigins') }}:</span>
            <div class="font-mono text-[11px] truncate mt-0.5">{{ state.allowedOrigins || '*' }}</div>
          </div>
        </div>
        <div v-if="state.description"
          class="text-xs pt-1 text-muted border-t border-neutral-100 dark:border-neutral-800">
          {{ state.description }}
        </div>
      </div>

      <!-- Summary Configs Count -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="font-semibold uppercase tracking-wider text-muted">{{ t('apps.summaryConfigs') }}</span>
          <UBadge :label="t('apps.configsCount', { count: Object.keys(compiledCreateConfigs).length })" variant="subtle"
            size="xs" />
        </div>

        <div
          class="border border-neutral-200 dark:border-neutral-800 rounded-lg max-h-44 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800 text-xs font-mono">
          <div v-for="(val, key) in compiledCreateConfigs" :key="key"
            class="flex justify-between items-center px-3 py-1.5">
            <span class="text-primary font-medium">{{ key }}</span>
            <span class="text-muted truncate max-w-xs">{{ key.includes('SECRET') || key.includes('KEY') ? '••••••••' :
              val }}</span>
          </div>
          <div v-if="Object.keys(compiledCreateConfigs).length === 0" class="px-3 py-2 text-muted italic">
            {{ t('apps.noConfigsYet') }}
          </div>
        </div>
      </div>
    </div>

    <template #actions>
      <div class="flex items-center justify-between w-full">
        <div>
          <UButton v-if="createStep > 1" type="button" variant="ghost" color="neutral" :label="t('apps.prevStep')"
            icon="i-lucide-arrow-left" :disabled="isSubmitting" @click="goToPrevStep" />
          <UButton v-else type="button" variant="ghost" color="neutral" :label="t('common.cancel')"
            :disabled="isSubmitting" @click="open = false" />
        </div>

        <div class="flex items-center gap-2">
          <UButton v-if="createStep < 3" type="button" color="primary" :label="t('apps.nextStep')"
            trailing-icon="i-lucide-arrow-right" @click="formModalRef?.submit?.()" />
          <UButton v-else type="button" color="primary" :label="t('common.create')" icon="i-lucide-check"
            :loading="isSubmitting" @click="formModalRef?.submit?.()" />
        </div>
      </div>
    </template>
  </BaseFormModal>
</template>
