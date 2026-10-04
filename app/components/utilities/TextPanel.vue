<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-1.5">
      <template v-for="cat in categories" :key="cat.id">
        <UButton
          v-for="op in cat.ops"
          :key="op.id"
          :label="t(`utilities.text.actions.${op.id}`)"
          size="xs"
          color="neutral"
          variant="soft"
          @click="apply(op.id)"
        />
        <USeparator v-if="cat.id !== categories[categories.length - 1]!.id" orientation="vertical" class="mx-1 h-6" />
      </template>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <UtilitiesTextPane
        v-model="input"
        :label="t('utilities.text.inputLabel')"
        :placeholder="t('utilities.text.inputPlaceholder')"
        :rows="10"
        allow-download
      >
        <template #footer>
          <div class="flex flex-wrap gap-3 text-xs text-muted">
            <span>{{ t('utilities.text.stats.chars') }}: <b class="text-highlighted">{{ stats.chars }}</b></span>
            <span>{{ t('utilities.text.stats.words') }}: <b class="text-highlighted">{{ stats.words }}</b></span>
            <span>{{ t('utilities.text.stats.lines') }}: <b class="text-highlighted">{{ stats.lines }}</b></span>
            <span>{{ t('utilities.text.stats.paragraphs') }}: <b class="text-highlighted">{{ stats.paragraphs }}</b></span>
            <span>{{ t('utilities.text.stats.readingTime') }}: <b class="text-highlighted">{{ stats.readingTimeMinutes }}m</b></span>
          </div>
        </template>
      </UtilitiesTextPane>

      <UtilitiesTextPane
        v-model="output"
        :label="t('utilities.text.outputLabel')"
        :placeholder="t('utilities.text.outputPlaceholder')"
        :rows="10"
        readonly
        allow-download
      >
        <template #footer>
          <div class="flex gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-arrow-right-left"
              :label="t('utilities.text.swap')"
              @click="swap"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-file-text"
              :label="t('utilities.text.sampleText')"
              @click="loadSample"
            />
          </div>
        </template>
      </UtilitiesTextPane>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const {
  toUpperCase,
  toLowerCase,
  toCapitalize,
  toSentenceCase,
  toCamelCase,
  toPascalCase,
  toKebabCase,
  toSnakeCase,
  toConstantCase,
  toAlternatingCase,
  toInverseCase,
  removeVietnameseAccents,
  toSlug,
  cleanSpaces,
  removeEmptyLines,
  removeDuplicateLines,
  sortLinesAsc,
  sortLinesDesc,
  reverseLines,
  reverseCharacters,
  numberLines,
  encodeBase64,
  decodeBase64,
  encodeUrl,
  decodeUrl,
  escapeHtml,
  unescapeHtml,
  countStats
} = useTextTransform()

type ActionId =
  | 'upper' | 'lower' | 'capitalize' | 'sentence'
  | 'camel' | 'pascal' | 'kebab' | 'snake' | 'constant'
  | 'alternating' | 'inverse'
  | 'removeAccents' | 'slug'
  | 'cleanSpaces' | 'removeEmptyLines' | 'removeDuplicates'
  | 'sortAsc' | 'sortDesc' | 'reverseLines' | 'reverseCharacters' | 'numberLines'
  | 'base64Encode' | 'base64Decode' | 'urlEncode' | 'urlDecode' | 'htmlEscape' | 'htmlUnescape'

const categories: { id: string; ops: { id: ActionId }[] }[] = [
  {
    id: 'case',
    ops: [
      { id: 'upper' }, { id: 'lower' }, { id: 'capitalize' }, { id: 'sentence' },
      { id: 'camel' }, { id: 'pascal' }, { id: 'kebab' }, { id: 'snake' }, { id: 'constant' },
      { id: 'alternating' }, { id: 'inverse' }
    ]
  },
  {
    id: 'vietnamese',
    ops: [{ id: 'removeAccents' }, { id: 'slug' }]
  },
  {
    id: 'lines',
    ops: [
      { id: 'cleanSpaces' }, { id: 'removeEmptyLines' }, { id: 'removeDuplicates' },
      { id: 'sortAsc' }, { id: 'sortDesc' }, { id: 'reverseLines' },
      { id: 'reverseCharacters' }, { id: 'numberLines' }
    ]
  },
  {
    id: 'encode',
    ops: [
      { id: 'base64Encode' }, { id: 'base64Decode' },
      { id: 'urlEncode' }, { id: 'urlDecode' },
      { id: 'htmlEscape' }, { id: 'htmlUnescape' }
    ]
  }
]

const input = ref('')
const output = ref('')

const stats = computed(() => countStats(input.value))

function apply(op: ActionId) {
  const src = input.value
  if (!src) return
  const map: Record<ActionId, (s: string) => string> = {
    upper: toUpperCase,
    lower: toLowerCase,
    capitalize: toCapitalize,
    sentence: toSentenceCase,
    camel: toCamelCase,
    pascal: toPascalCase,
    kebab: toKebabCase,
    snake: toSnakeCase,
    constant: toConstantCase,
    alternating: toAlternatingCase,
    inverse: toInverseCase,
    removeAccents: removeVietnameseAccents,
    slug: toSlug,
    cleanSpaces,
    removeEmptyLines,
    removeDuplicates: removeDuplicateLines,
    sortAsc: sortLinesAsc,
    sortDesc: sortLinesDesc,
    reverseLines,
    reverseCharacters,
    numberLines,
    base64Encode: encodeBase64,
    base64Decode: decodeBase64,
    urlEncode: encodeUrl,
    urlDecode: decodeUrl,
    htmlEscape: escapeHtml,
    htmlUnescape: unescapeHtml
  }
  output.value = map[op]!(src)
}

function swap() {
  if (!output.value) return
  const tmp = input.value
  input.value = output.value
  output.value = tmp
}

function loadSample() {
  input.value = t('utilities.text.sampleContent')
  output.value = ''
}
</script>
