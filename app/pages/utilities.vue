<template>
  <BasePage
    id="utilities"
    :title="t('utilities.title')"
    :description="t('utilities.subtitle')"
  >
    <div class="space-y-4">
      <UtilitiesToolTabs
        v-if="route.path !== '/utilities/editor'"
        :active="activeTab"
        @select="onSelect"
      />
      <NuxtPage />
    </div>
  </BasePage>
</template>

<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const activeTab = computed(() => {
  const seg = route.path.split('/').pop() || ''
  return ['text', 'icons', 'encode', 'random'].includes(seg) ? seg : 'text'
})

const pageTitle = computed(() => {
  const seg = route.path.split('/').pop() || ''
  switch (seg) {
    case 'editor': return t('utilities.editor.title')
    case 'icons': return t('utilities.icons.title')
    case 'encode': return t('utilities.crypto.title')
    case 'random': return t('utilities.random.title')
    case 'text': return t('utilities.text.title')
    default: return t('utilities.title')
  }
})

useHead({ title: pageTitle })

function onSelect(v: string) {
  router.push(`/utilities/${v}`)
}
</script>
