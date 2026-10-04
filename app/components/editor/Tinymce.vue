<script setup lang="ts">
import Editor from '@tinymce/tinymce-vue'

interface Props {
  modelValue: string | null
  height?: number
  placeholder?: string
}

const props = defineProps<Props>()
const emit = defineEmits(['update:modelValue'])

const content = ref(props.modelValue ? String(props.modelValue) : '')

watch(() => props.modelValue, (val) => {
  const s = val ? String(val) : ''
  if (s !== content.value) content.value = s
})

function handleChange(v: string) {
  emit('update:modelValue', v)
}

const plugins = `
  anchor autolink charmap code codesample directionality emoticons fullscreen
  help image importcss insertdatetime link lists media preview quickbars searchreplace
  table visualblocks visualchars wordcount advlist
`

const toolbar = `
  undo redo | restoredraft | blocks fontfamily fontsize | bold italic underline strikethrough |
  forecolor backcolor | alignleft aligncenter alignright alignjustify alignnone |
  bullist numlist checklist | outdent indent | link image media | preview fullscreen |
  charmap emoticons | codesample code | table tabledelete tableprops tablemergecells tablesplitcells tableinsertrowbefore tableinsertrowafter
  tabledeleterow tableinsertcolbefore tableinsertcolafter tabledeletecol | searchreplace | removeformat | help
`
const themes = computed(() => {
  const isDark = document.documentElement.classList.contains('dark')
  return {
    skin: isDark ? 'oxide-dark' : 'oxide',
    content_css: isDark ? 'dark' : 'default'
  }
})
</script>

<template>
  <Editor v-model="content" api-key="jl2ow90w9fkj758bcj3uw58sntbsdrtnpg8pj5x8cm2zilea" :init="{
    height: props.height || 500,
    menubar: true,
    plugins,
    toolbar,
    // fix context error
    inline: false,
    fixed_toolbar_container: null,
    relative_urls: false,
    remove_script_host: false,
    placeholder: props.placeholder || $t('editor.placeholder'),
    image_caption: true,
    quickbars_selection_toolbar: 'bold italic underline | quicklink h2 h3 blockquote | forecolor backcolor',
    quickbars_insert_toolbar: 'image media table | hr',
    content_style: 'body { font-family: Inter, sans-serif; font-size: 14px; line-height: 1.6; }',
    skin: themes.skin,
    content_css: themes.content_css
  }" @update:modelValue="handleChange" />
</template>

<style>
.tox {
  /* z-index: 2000 !important; */
  width: 100%;
}

.tox-tinymce-aux,
.tox-dialog-wrap,
.tox-dialog {
  z-index: 2001 !important;
}
</style>
