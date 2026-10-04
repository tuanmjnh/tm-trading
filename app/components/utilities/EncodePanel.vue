<template>
  <div class="space-y-4">
    <!-- 1. Encode / Decode -->
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-arrow-left-right" class="h-5 w-5 text-primary" />
            <div>
              <h3 class="text-sm font-semibold text-highlighted">
                {{ t('utilities.crypto.encodeTitle') }}
              </h3>
              <p class="text-xs text-muted">{{ t('utilities.crypto.encodeDesc') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <UButton
              v-for="op in encodeOps"
              :key="op.id"
              :label="t(`utilities.crypto.actions.${op.id}`)"
              :icon="op.icon"
              size="xs"
              :color="encodeOp === op.id ? 'primary' : 'neutral'"
              :variant="encodeOp === op.id ? 'solid' : 'soft'"
              @click="encodeOp = op.id"
            />
          </div>
        </div>
      </template>

      <div class="grid gap-4 lg:grid-cols-2">
        <UtilitiesTextPane
          v-model="encodeInput"
          :label="t('utilities.crypto.input')"
          :placeholder="t('utilities.crypto.inputPlaceholder')"
          :rows="6"
        />
        <UtilitiesTextPane
          :model-value="encodeOutput"
          :label="t('utilities.crypto.output')"
          :placeholder="t('utilities.crypto.outputPlaceholder')"
          :rows="6"
          readonly
          allow-download
        >
          <template #footer>
            <p v-if="encodeError" class="text-xs text-error">{{ encodeError }}</p>
            <p v-else-if="!encodeInput" class="text-xs text-dimmed">
              {{ t('utilities.crypto.hintInput') }}
            </p>
          </template>
        </UtilitiesTextPane>
      </div>
    </UCard>

    <!-- 2. Hash -->
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-fingerprint" class="h-5 w-5 text-primary" />
            <div>
              <h3 class="text-sm font-semibold text-highlighted">
                {{ t('utilities.crypto.hash.title') }}
              </h3>
              <p class="text-xs text-muted">{{ t('utilities.crypto.hash.desc') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <USelect v-model="hashAlgo" :items="hashAlgorithms" size="xs" class="w-36" />
            <UButton
              :label="t('utilities.crypto.hash.generate')"
              icon="i-lucide-hash"
              size="xs"
              color="neutral"
              variant="soft"
              :loading="hashLoading"
              :disabled="!hashInput.trim()"
              @click="runHash"
            />
          </div>
        </div>
      </template>

      <div class="space-y-3">
        <UtilitiesTextPane
          v-model="hashInput"
          :label="t('utilities.crypto.hash.inputLabel')"
          :placeholder="t('utilities.crypto.hash.inputPlaceholder')"
          :rows="3"
        />
        <div v-if="hashResult" class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-muted">{{ hashAlgo }}</span>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="soft"
              @click="copyText(hashResult)"
            />
          </div>
          <div class="rounded-lg bg-default/50 p-3 font-mono text-xs break-all">
            {{ hashResult }}
          </div>
        </div>
        <p v-else class="text-xs text-dimmed">{{ t('utilities.crypto.hash.hint') }}</p>
      </div>
    </UCard>

    <!-- 3. JWT -->
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-key-round" class="h-5 w-5 text-primary" />
            <div>
              <h3 class="text-sm font-semibold text-highlighted">JWT</h3>
              <p class="text-xs text-muted">{{ t('utilities.crypto.jwt.desc') }}</p>
            </div>
          </div>
          <UFieldGroup>
            <UButton
              :label="t('utilities.crypto.jwt.modeEncode')"
              icon="i-lucide-lock"
              size="xs"
              :color="jwtMode === 'encode' ? 'primary' : 'neutral'"
              :variant="jwtMode === 'encode' ? 'solid' : 'soft'"
              @click="jwtMode = 'encode'"
            />
            <UButton
              :label="t('utilities.crypto.jwt.modeDecode')"
              icon="i-lucide-lock-open"
              size="xs"
              :color="jwtMode === 'decode' ? 'primary' : 'neutral'"
              :variant="jwtMode === 'decode' ? 'solid' : 'soft'"
              @click="jwtMode = 'decode'"
            />
          </UFieldGroup>
        </div>
      </template>

      <!-- ENCODE mode -->
      <div v-if="jwtMode === 'encode'" class="space-y-3">
        <div class="grid gap-3 lg:grid-cols-2">
          <div class="space-y-2">
            <label class="text-xs font-medium text-muted">{{ t('utilities.crypto.jwt.payloadJson') }}</label>
            <UTextarea
              v-model="jwtPayloadJson"
              :placeholder="t('utilities.crypto.jwt.payloadPlaceholder')"
              :rows="6"
              class="w-full font-mono text-xs"
            />
            <p v-if="jwtPayloadError" class="text-xs text-error">{{ jwtPayloadError }}</p>
          </div>
          <div class="space-y-2">
            <label class="text-xs font-medium text-muted">{{ t('utilities.crypto.jwt.headerJson') }}</label>
            <UTextarea
              v-model="jwtHeaderJson"
              :placeholder="t('utilities.crypto.jwt.headerPlaceholder')"
              :rows="6"
              class="w-full font-mono text-xs"
            />
            <p v-if="jwtHeaderError" class="text-xs text-error">{{ jwtHeaderError }}</p>
          </div>
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div class="space-y-1">
            <label class="text-xs font-medium text-muted">Algorithm</label>
            <USelect v-model="jwtAlgo" :items="['HS256', 'none']" size="sm" class="w-32" />
          </div>
          <div v-if="jwtAlgo === 'HS256'" class="flex-1 min-w-48 space-y-1">
            <label class="text-xs font-medium text-muted">{{ t('utilities.crypto.jwt.secret') }}</label>
            <UInput
              v-model="jwtSecret"
              :placeholder="t('utilities.crypto.jwt.secretPlaceholder')"
              type="password"
              size="sm"
              class="w-full"
            />
          </div>
          <UButton
            :label="t('utilities.crypto.jwt.encode')"
            icon="i-lucide-key"
            color="neutral"
            variant="soft"
            :disabled="!jwtPayloadJson.trim() || !!jwtPayloadError || (jwtAlgo === 'HS256' && !jwtSecret)"
            :loading="jwtEncoding"
            @click="doEncodeJwt"
          />
        </div>

        <div v-if="jwtEncoded" class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-muted">Token</span>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="soft"
              @click="copyText(jwtEncoded)"
            />
          </div>
          <div class="rounded-lg bg-default/50 p-3 font-mono text-xs break-all">
            {{ jwtEncoded }}
          </div>
        </div>
        <p v-else class="text-xs text-dimmed">{{ t('utilities.crypto.jwt.encodeHint') }}</p>
      </div>

      <!-- DECODE mode -->
      <div v-else class="space-y-3">
        <UtilitiesTextPane
          v-model="jwtInput"
          :label="t('utilities.crypto.jwt.inputLabel')"
          :placeholder="t('utilities.crypto.jwt.inputPlaceholder')"
          :rows="3"
        />

        <div class="flex justify-end">
          <UButton
            :label="t('utilities.crypto.jwt.decode')"
            icon="i-lucide-play"
            size="xs"
            color="neutral"
            variant="soft"
            :disabled="!jwtInput.trim()"
            @click="doDecodeJwt"
          />
        </div>

        <UAlert
          v-if="jwtResult && !jwtResult.valid"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="t('utilities.crypto.jwt.invalid')"
        />

        <div v-if="jwtResult?.header" class="rounded-lg border border-default bg-default/30 p-3">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs font-semibold text-muted">Header</span>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="soft"
              @click="copyText(JSON.stringify(jwtResult.header, null, 2))"
            />
          </div>
          <pre class="overflow-auto font-mono text-xs">{{ JSON.stringify(jwtResult.header, null, 2) }}</pre>
        </div>

        <div v-if="jwtResult?.payload" class="rounded-lg border border-default bg-default/30 p-3">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs font-semibold text-muted">Payload</span>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="soft"
              @click="copyText(JSON.stringify(jwtResult.payload, null, 2))"
            />
          </div>
          <pre class="overflow-auto font-mono text-xs">{{ JSON.stringify(jwtResult.payload, null, 2) }}</pre>
          <div v-if="expHint" class="mt-2 text-xs text-muted">{{ expHint }}</div>
        </div>

        <p v-if="!jwtResult && !jwtInput" class="text-xs text-dimmed">
          {{ t('utilities.crypto.jwt.hint') }}
        </p>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const toast = useToast()
const {
  encodeBase64,
  decodeBase64,
  encodeUrl,
  decodeUrl,
  escapeHtml,
  unescapeHtml,
  encodeHex,
  decodeHex,
  encodeBinary,
  decodeBinary,
  rot13,
  runHash: hashText,
  decodeJwt,
  encodeJwt
} = useEncoding()

type EncodeOp =
  | 'base64Encode' | 'base64Decode'
  | 'urlEncode' | 'urlDecode'
  | 'htmlEscape' | 'htmlUnescape'
  | 'hexEncode' | 'hexDecode'
  | 'binaryEncode' | 'binaryDecode'
  | 'rot13'

const encodeOps: { id: EncodeOp; icon: string }[] = [
  { id: 'base64Encode', icon: 'i-lucide-lock' },
  { id: 'base64Decode', icon: 'i-lucide-lock-open' },
  { id: 'urlEncode', icon: 'i-lucide-link' },
  { id: 'urlDecode', icon: 'i-lucide-unlink' },
  { id: 'htmlEscape', icon: 'i-lucide-code-xml' },
  { id: 'htmlUnescape', icon: 'i-lucide-code' },
  { id: 'hexEncode', icon: 'i-lucide-hash' },
  { id: 'hexDecode', icon: 'i-lucide-unplug' },
  { id: 'binaryEncode', icon: 'i-lucide-binary' },
  { id: 'binaryDecode', icon: 'i-lucide-list-ordered' },
  { id: 'rot13', icon: 'i-lucide-refresh-cw' }
]

// ── Encode/Decode ──────────────────────────────────
const encodeOp = ref<EncodeOp>('base64Encode')
const encodeInput = ref('')
const encodeError = ref('')

const encodeOutput = computed(() => {
  const input = encodeInput.value
  if (!input) return ''
  try {
    encodeError.value = ''
    switch (encodeOp.value) {
      case 'base64Encode': return encodeBase64(input)
      case 'base64Decode': return decodeBase64(input)
      case 'urlEncode': return encodeUrl(input)
      case 'urlDecode': return decodeUrl(input)
      case 'htmlEscape': return escapeHtml(input)
      case 'htmlUnescape': return unescapeHtml(input)
      case 'hexEncode': return encodeHex(input)
      case 'hexDecode': return decodeHex(input)
      case 'binaryEncode': return encodeBinary(input)
      case 'binaryDecode': return decodeBinary(input)
      case 'rot13': return rot13(input)
      default: return ''
    }
  } catch (e) {
    encodeError.value = e instanceof Error ? e.message : String(e)
    return ''
  }
})

// ── Hash ───────────────────────────────────────────
const hashInput = ref('')
const hashAlgo = ref<'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'>('SHA-256')
const hashAlgorithms = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']
const hashResult = ref('')
const hashLoading = ref(false)

async function runHash() {
  if (!hashInput.value.trim()) return
  hashLoading.value = true
  try {
    hashResult.value = await hashText(hashAlgo.value, hashInput.value)
  } finally {
    hashLoading.value = false
  }
}

// ── JWT ────────────────────────────────────────────
const jwtMode = ref<'encode' | 'decode'>('encode')
const jwtInput = ref('')
const jwtResult = ref<ReturnType<typeof decodeJwt> | null>(null)

// encode state
const jwtPayloadJson = ref('{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}')
const jwtHeaderJson = ref('')
const jwtSecret = ref('')
const jwtAlgo = ref<'HS256' | 'none'>('HS256')
const jwtEncoded = ref('')
const jwtEncoding = ref(false)
const jwtPayloadError = ref('')
const jwtHeaderError = ref('')

function parseJwtJson(raw: string, isPayload: boolean): Record<string, unknown> | null {
  if (!raw.trim()) {
    if (isPayload) jwtPayloadError.value = ''
    else jwtHeaderError.value = ''
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const err = t('utilities.crypto.jwt.jsonMustBeObject')
      if (isPayload) jwtPayloadError.value = err
      else jwtHeaderError.value = err
      return null
    }
    if (isPayload) jwtPayloadError.value = ''
    else jwtHeaderError.value = ''
    return parsed as Record<string, unknown>
  } catch {
    const err = t('utilities.crypto.jwt.jsonInvalid')
    if (isPayload) jwtPayloadError.value = err
    else jwtHeaderError.value = err
    return null
  }
}

watch(jwtPayloadJson, v => parseJwtJson(v, true))
watch(jwtHeaderJson, v => parseJwtJson(v, false))

async function doEncodeJwt() {
  const payload = parseJwtJson(jwtPayloadJson.value, true)
  if (!payload) return
  const header = parseJwtJson(jwtHeaderJson.value, false)
  if (jwtHeaderJson.value.trim() && !header) return
  jwtEncoding.value = true
  try {
    jwtEncoded.value = await encodeJwt(payload, {
      algorithm: jwtAlgo.value,
      secret: jwtAlgo.value === 'HS256' ? jwtSecret.value : undefined,
      header: header ?? undefined
    })
  } catch (e) {
    jwtEncoded.value = ''
    toast.add({ title: e instanceof Error ? e.message : String(e), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    jwtEncoding.value = false
  }
}

const expHint = computed(() => {
  const exp = jwtResult.value?.payload?.exp
  if (typeof exp !== 'number') return ''
  const d = new Date(exp * 1000)
  const expired = d.getTime() < Date.now()
  const label = expired ? t('utilities.crypto.jwt.expired') : t('utilities.crypto.jwt.validUntil')
  return `${label}: ${d.toLocaleString()}`
})

function doDecodeJwt() {
  jwtResult.value = decodeJwt(jwtInput.value)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: t('utilities.text.copied'), color: 'success', icon: 'i-lucide-check' })
  } catch {
    toast.add({ title: 'Copy failed', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
</script>
