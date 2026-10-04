<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ decoded: [text: string] }>()

const { t } = useI18n()

const videoEl = ref<HTMLVideoElement | null>(null)
const loading = ref(false)
const error = ref<'denied' | 'generic' | ''>('')

let controls: { stop: () => void } | null = null
let starting = false

async function start() {
  if (starting || controls || !videoEl.value || !open.value) return
  starting = true
  error.value = ''
  loading.value = true
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()
    controls = await reader.decodeFromVideoDevice(undefined, videoEl.value, (result) => {
      if (result) {
        const text = result.getText()
        stop()
        open.value = false
        emit('decoded', text)
      }
    })
    loading.value = false
  }
  catch (e) {
    const err = e as Error
    error.value = err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'generic'
    loading.value = false
  }
  finally {
    starting = false
  }
}

function stop() {
  controls?.stop()
  controls = null
}

watch([open, videoEl], ([isOpen, el]) => {
  if (isOpen && el) {
    start()
  }
  else if (!isOpen) {
    stop()
  }
})

onUnmounted(stop)
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-md' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-scan-line" class="size-5 text-primary" />
        <span class="font-semibold">{{ t('scan.title') }}</span>
      </div>
    </template>
    <template #body>
      <div class="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-elevated">
        <video ref="videoEl" class="absolute inset-0 h-full w-full object-cover" muted playsinline autoplay
          @canplay="loading = false" />

        <div v-if="error" class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-elevated/95 p-6 text-center">
          <UIcon name="i-lucide-camera-off" class="size-8 text-error" />
          <p class="text-sm text-muted">{{ error === 'denied' ? t('scan.denied') : t('scan.error') }}</p>
          <UButton :label="t('scan.retry')" icon="i-lucide-refresh-cw" size="sm" variant="soft" color="neutral"
            @click="start" />
        </div>

        <UIcon v-else-if="loading" name="i-lucide-loader-2"
          class="absolute inset-0 m-auto z-10 size-8 animate-spin text-primary" />

        <div v-else class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div class="relative h-52 w-52">
            <span class="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-md border-l-2 border-t-2 border-primary" />
            <span class="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-md border-r-2 border-t-2 border-primary" />
            <span class="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-md border-b-2 border-l-2 border-primary" />
            <span class="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-md border-b-2 border-r-2 border-primary" />
          </div>
        </div>
      </div>
      <p class="pt-3 text-center text-xs text-muted">{{ t('scan.hint') }}</p>
    </template>
  </UModal>
</template>
