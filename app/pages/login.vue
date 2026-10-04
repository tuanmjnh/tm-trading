<script setup lang="ts">
import { z } from 'zod'
import type { LoginRequest, TotpChallenge } from '~/types/auth'
import { isTotpChallenge } from '~/types/auth'
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({ layout: false })

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { t } = useI18n()
const { isSettingsSlideoverOpen } = useDashboard()

const totpChallenge = ref<TotpChallenge | null>(null)
const totpCode = ref('')
const passkeyLoading = ref(false)

const schema = z.object({
  email: z.string().min(1, t('auth.emailRequired')),
  password: z.string().min(6, t('auth.passwordMin'))
})

const state = reactive({
  email: '',
  password: ''
})

async function onSubmit() {
  try {
    const input: LoginRequest = { email: state.email, password: state.password }
    const result = await auth.login(input)
    if (isTotpChallenge(result)) {
      totpChallenge.value = result
      totpCode.value = ''
      return
    }
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

async function onPasskeyLogin() {
  if (passkeyLoading.value) return
  passkeyLoading.value = true
  try {
    await auth.passkeyLogin()
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name
    if (name === 'NotAllowedError') toast.add({ title: t('auth.passkeyCancelled'), color: 'neutral' })
    else toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    passkeyLoading.value = false
  }
}

async function onVerifyTotp() {
  if (!totpChallenge.value) return
  try {
    await auth.verifyTotp(totpCode.value.trim(), totpChallenge.value.pendingTotpToken)
    const redirect = (route.query.redirect as string) || '/'
    await router.push(redirect)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    totpCode.value = ''
  }
}

function resetTotp() {
  totpChallenge.value = null
  totpCode.value = ''
}

useHead({ title: computed(() => t('auth.signIn')) })
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
          <div
            class="inline-flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mb-3 mx-auto">
            <UIcon v-if="totpChallenge" name="i-lucide-shield-check" class="size-6" />
            <MediaVisual v-else src="/logo.svg" size="size-7" />
          </div>
          <h1 class="text-2xl font-bold text-highlighted">
            {{ totpChallenge ? t('auth.totpTitle') : t('auth.welcomeBack') }}
          </h1>
          <p class="text-sm text-muted mt-1">
            {{ totpChallenge ? t('auth.totpSubtitle', { email: totpChallenge.user.email }) : t('auth.signInToAccount')
            }}
          </p>
        </div>
      </template>

      <UForm v-if="!totpChallenge" :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
        <UFormField :label="t('auth.emailOrUsername')" name="email">
          <UInput v-model="state.email" type="text" :placeholder="t('auth.emailPlaceholder')" class="w-full"
            size="lg" />
        </UFormField>

        <UFormField :label="t('auth.password')" name="password">
          <BasePasswordInput v-model="state.password" :placeholder="t('auth.passwordPlaceholder')" class="w-full"
            size="lg" />
        </UFormField>

        <div class="flex items-center justify-between text-sm py-1">
          <div></div>
          <NuxtLink to="/forgot-password" class="text-primary hover:underline">
            {{ t('auth.forgotPassword') }}
          </NuxtLink>
          <!-- <NuxtLink to="/register" class="text-muted hover:text-highlighted">
            {{ t('auth.signUp') || t('auth.register') || 'Đăng ký' }}
          </NuxtLink> -->
        </div>

        <UButton type="submit" variant="soft" color="primary" block size="lg" :loading="auth.loading.value"
          :disabled="auth.loading.value">
          {{ t('auth.signIn') }}
        </UButton>
      </UForm>

      <div v-if="!totpChallenge" class="mt-4 flex items-center gap-3">
        <USeparator class="flex-1" />
        <span class="text-xs text-muted">{{ t('common.or') || 'hoặc' }}</span>
        <USeparator class="flex-1" />
      </div>

      <UButton v-if="!totpChallenge" class="mt-4" icon="i-lucide-fingerprint" variant="outline" block size="lg"
        :loading="passkeyLoading" :disabled="auth.loading.value" @click="onPasskeyLogin">
        {{ t('auth.passkeySignIn') }}
      </UButton>

      <form v-else class="space-y-4" @submit.prevent="onVerifyTotp">
        <UFormField :label="t('auth.totpCodeLabel')" name="code" required>
          <UInput v-model="totpCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
            :placeholder="t('auth.totpCodePlaceholder')" class="w-full text-center tracking-[0.5em]" size="lg" />
        </UFormField>
        <UButton type="submit" variant="soft" color="primary" block size="lg" :loading="auth.loading.value"
          :disabled="auth.loading.value || totpCode.trim().length < 6">
          {{ t('auth.totpVerify') }}
        </UButton>
        <UButton type="button" color="neutral" variant="ghost" block @click="resetTotp">
          {{ t('auth.totpBack') }}
        </UButton>
      </form>
    </UCard>

    <LazyDashboardSettingsSlideover />
  </div>
</template>
