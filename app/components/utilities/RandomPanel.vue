<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="gen in randomGens"
        :key="gen.id"
        :label="t(`utilities.random.types.${gen.id}`)"
        :icon="gen.icon"
        size="sm"
        :color="randomType === gen.id ? 'primary' : 'neutral'"
        :variant="randomType === gen.id ? 'solid' : 'soft'"
        @click="randomType = gen.id"
      />
    </div>

    <div v-if="randomType === 'password'" class="space-y-3 rounded-xl border border-default p-4">
      <div class="flex items-center gap-3">
        <label class="w-24 text-sm text-muted">{{ t('utilities.random.length') }}</label>
        <USlider v-model="pwOptions.length" :min="4" :max="64" class="flex-1" />
        <span class="w-8 text-right font-mono text-sm">{{ pwOptions.length }}</span>
      </div>
      <div class="flex flex-wrap gap-4">
        <UCheckbox v-model="pwOptions.upper" :label="t('utilities.random.upper')" />
        <UCheckbox v-model="pwOptions.lower" :label="t('utilities.random.lower')" />
        <UCheckbox v-model="pwOptions.digits" :label="t('utilities.random.digits')" />
        <UCheckbox v-model="pwOptions.symbols" :label="t('utilities.random.symbols')" />
        <UCheckbox v-model="pwOptions.excludeAmbiguous" :label="t('utilities.random.excludeAmbiguous')" />
      </div>
      <div class="flex items-center gap-3">
        <label class="w-24 text-sm text-muted">{{ t('utilities.random.count') }}</label>
        <UInput v-model.number="genCount" type="number" :min="1" :max="20" size="xs" class="w-20" />
      </div>
    </div>

    <div v-if="randomType === 'username'" class="space-y-3 rounded-xl border border-default p-4">
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="style in usernameStyles"
          :key="style.id"
          :label="t(`utilities.random.styles.${style.id}`)"
          size="xs"
          :color="usernameStyle === style.id ? 'primary' : 'neutral'"
          :variant="usernameStyle === style.id ? 'solid' : 'soft'"
          @click="usernameStyle = style.id"
        />
      </div>
      <UCheckbox v-model="usernameSuffix" :label="t('utilities.random.suffix')" />
      <div class="flex items-center gap-3">
        <label class="w-24 text-sm text-muted">{{ t('utilities.random.count') }}</label>
        <UInput v-model.number="genCount" type="number" :min="1" :max="20" size="xs" class="w-20" />
      </div>
    </div>

    <div class="flex gap-2">
      <UButton
        :label="t('utilities.random.generate')"
        icon="i-lucide-dices"
        color="neutral"
        variant="soft"
        @click="generate"
      />
      <UButton
        v-if="genResults.length"
        :label="t('utilities.random.copyAll')"
        icon="i-lucide-copy"
        color="neutral"
        variant="soft"
        @click="copyAll"
      />
    </div>

    <div v-if="genResults.length" class="space-y-2">
      <div
        v-for="(item, idx) in genResults"
        :key="idx"
        class="flex items-center gap-2 rounded-lg bg-default/50 px-3 py-2"
      >
        <code class="flex-1 font-mono text-sm break-all">{{ item }}</code>
        <UButton
          icon="i-lucide-copy"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="copyOne(item)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const toast = useToast()
const {
  generatePasswordBatch,
  generatePin,
  generateUuid,
  generateToken,
  generateApiKey,
  generateUsernameBatch
} = useRandomGen()

type RandomType = 'password' | 'username' | 'pin' | 'uuid' | 'token' | 'apiKey'

const randomGens: { id: RandomType; icon: string }[] = [
  { id: 'password', icon: 'i-lucide-key-round' },
  { id: 'username', icon: 'i-lucide-user' },
  { id: 'pin', icon: 'i-lucide-lock' },
  { id: 'uuid', icon: 'i-lucide-fingerprint' },
  { id: 'token', icon: 'i-lucide-shield' },
  { id: 'apiKey', icon: 'i-lucide-badge' }
]

const randomType = ref<RandomType>('password')
const genCount = ref(5)
const genResults = ref<string[]>([])

const pwOptions = reactive({
  length: 16,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false
})

const usernameStyle = ref<'word' | 'name' | 'handle' | 'email-like'>('handle')
const usernameSuffix = ref(true)
const usernameStyles = [
  { id: 'word' as const },
  { id: 'name' as const },
  { id: 'handle' as const },
  { id: 'email-like' as const }
]

function generate() {
  const count = Math.min(Math.max(genCount.value || 1, 1), 20)
  switch (randomType.value) {
    case 'password':
      genResults.value = generatePasswordBatch(count, pwOptions)
      break
    case 'username':
      genResults.value = generateUsernameBatch(count, {
        style: usernameStyle.value,
        suffix: usernameSuffix.value
      })
      break
    case 'pin':
      genResults.value = Array.from({ length: count }, () => generatePin(6))
      break
    case 'uuid':
      genResults.value = Array.from({ length: count }, () => generateUuid())
      break
    case 'token':
      genResults.value = Array.from({ length: count }, () => generateToken(32))
      break
    case 'apiKey':
      genResults.value = Array.from({ length: count }, () => generateApiKey('tm'))
      break
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('utilities.text.copied'), color: 'success', icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const copyOne = copyText
const copyAll = () => copyText(genResults.value.join('\n'))
</script>
