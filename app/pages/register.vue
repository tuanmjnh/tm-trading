<script setup lang="ts">
import { z } from 'zod'
import type { RegisterRequest } from '~/types/auth'
import { getErrorMessage } from '~/shared/utils/errors'
import { useAuth } from '~/composables/useAuth'

definePageMeta({ layout: false })

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { t } = useI18n()
const { isSettingsSlideoverOpen } = useDashboard()

useHead({ title: computed(() => t('auth.register')) })

const schema = z.object({
  name: z.string().min(1, t('auth.nameRequired')),
  email: z.string().email(t('auth.emailInvalid')),
  password: z.string().min(6, t('auth.passwordMin')),
  confirmPassword: z.string().min(6, t('auth.passwordMin'))
}).refine(data => data.password === data.confirmPassword, {
  message: t('auth.passwordsNotMatch'),
  path: ['confirmPassword']
})

const state = reactive({
  name: '',
  email: '',
  password: '',
  confirmPassword: ''
})

async function onSubmit() {
  try {
    const input: RegisterRequest = {
      email: state.email,
      password: state.password,
      name: state.name
    }
    await auth.register(input)
    toast.add({ title: t('auth.registerSuccess'), color: 'success' })
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-default px-4 relative">
    <div class="absolute top-4 right-4 flex items-center gap-2">
      <UButton icon="i-lucide-settings" color="neutral" variant="soft" size="sm" :aria-label="t('settings.title')"
        @click="isSettingsSlideoverOpen = true" />
    </div>

    <UCard class="w-full max-w-sm sm:max-w-md">
      <template #header>
        <div class="text-center">
          <div class="inline-flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mb-3">
            <UIcon name="i-lucide-user-plus" class="size-6" />
          </div>
          <h1 class="text-2xl font-bold text-highlighted">{{ t('auth.createAccount') }}</h1>
          <p class="text-sm text-muted mt-1">{{ t('auth.enterDetailsToRegister') }}</p>
        </div>
      </template>

      <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField :label="t('auth.name')" name="name">
          <UInput v-model="state.name" type="text" :placeholder="t('auth.namePlaceholder')" class="w-full"
            size="lg" />
        </UFormField>

        <UFormField :label="t('auth.email')" name="email">
          <UInput v-model="state.email" type="email" :placeholder="t('auth.emailPlaceholder')" class="w-full"
            size="lg" />
        </UFormField>

        <UFormField :label="t('auth.password')" name="password">
          <BasePasswordInput v-model="state.password" :placeholder="t('auth.passwordPlaceholder')" class="w-full"
            size="lg" />
        </UFormField>

        <UFormField :label="t('auth.confirmPassword')" name="confirmPassword">
          <BasePasswordInput v-model="state.confirmPassword" :placeholder="t('auth.confirmPasswordPlaceholder')" class="w-full"
            size="lg" />
        </UFormField>

        <UButton type="submit" variant="soft" color="primary" block size="lg" :loading="auth.loading.value"
          :disabled="auth.loading.value">
          {{ t('auth.register') }}
        </UButton>
      </UForm>

      <div class="text-center mt-6">
        <p class="text-sm text-muted">
          {{ t('auth.alreadyHaveAccount') }}
          <NuxtLink to="/login" class="text-primary hover:underline ml-1">{{ t('auth.signIn') }}</NuxtLink>
        </p>
      </div>
    </UCard>

    <LazyDashboardSettingsSlideover />
  </div>
</template>