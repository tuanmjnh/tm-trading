<script setup lang="ts">
import type {
  EditorCustomHandlers,
  EditorToolbarItem,
  EditorSuggestionMenuItem,
  EditorMentionMenuItem,
  EditorEmojiMenuItem,
  DropdownMenuItem
} from '@nuxt/ui'
import type { Editor, JSONContent } from '@tiptap/vue-3'
import { upperFirst } from 'scule'
// Import lightweight utils statically
import { mapEditorItems } from '@nuxt/ui/utils/editor'

// 0. Props & Emits
const props = defineProps<{
  modelValue?: string | JSONContent
  contentType?: 'html' | 'json' | 'markdown'
  isBubble?: boolean
  placeholder?: string
  class?: string
}>()

// 1. IMPORTANT: Use shallowRef to save Editor instance
// Avoid Vue reactivity which slows down the editor and consumes memory
const editorInstance = shallowRef()
const extensions = shallowRef<any[]>([])
const emojiItems = shallowRef<EditorEmojiMenuItem[]>([])

// 2. Dynamically load heavy modules
onMounted(async () => {
  // Only load when on Client
  const [
    { TextAlign },
    { Table, TableRow, TableCell, TableHeader },
    { Youtube },
    // { EditorLinkPopover },
    { MediaGallery },
    { EditorImage },
    { gitHubEmojis }
  ] = await Promise.all([
    import('@tiptap/extension-text-align'),
    import('@tiptap/extension-table'),
    import('@tiptap/extension-youtube'),
    // import('./EditorLinkPopover'),
    import('./EditorMediaGallery'),
    import('./EditorImage'),
    import('@tiptap/extension-emoji')
  ])

  extensions.value = [
    TextAlign.configure({ types: ['heading', 'paragraph', 'youtube'] }),
    MediaGallery,
    EditorImage.configure({ inline: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Youtube.configure({
      width: 480,
      controls: false,
      autoplay: false,
      nocookie: false
    })
  ]

  // Populate Emojis
  emojiItems.value = gitHubEmojis.filter((emoji: any) => !emoji.name.startsWith('regional_indicator_'))
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | JSONContent): void
}>()

const value = computed({
  get: () => props.modelValue,
  set: (val) => {
    if (val !== undefined) {
      emit('update:modelValue', val)
    }
  }
})
// const value = ref('')
const editorRef = useTemplateRef('editorRef')
// const { extension: completionExtension, handlers: aiHandlers, isLoading: aiLoading } = useEditorCompletion(editorRef)
// const extensions = [
//   // Emoji, // Disabled to prevent Canvas2D warning
//   TextAlign.configure({ types: ['heading', 'paragraph', 'youtube'] }),
//   MediaGallery,
//   EditorImage.configure({ inline: true }),
//   Table.configure({ resizable: true }),
//   TableRow,
//   TableHeader,
//   TableCell,
//   Youtube.configure({
//     autoplay: false,
//     width: 480, // Default width
//     controls: false,
//     nocookie: false,
//   }),
//   // completionExtension
// ]

const customHandlers = {
  imageUpload: {
    canExecute: (editor: Editor) => editor.can().insertContent({ type: 'imageUpload' }),
    execute: (editor: Editor) => editor.chain().focus().insertContent({ type: 'imageUpload' }),
    isActive: (editor: Editor) => editor.isActive('imageUpload'),
    isDisabled: undefined
  },
  mediaGallery: {
    canExecute: (editor: Editor) => editor.can().insertContent({ type: 'mediaGallery' }),
    execute: (editor: Editor) => editor.chain().focus().insertContent({ type: 'mediaGallery' }),
    isActive: (editor: Editor) => editor.isActive('mediaGallery'),
    isDisabled: undefined
  },
  youtube: {
    canExecute: (editor: Editor) => true, // editor.can().setYoutubeVideo({ src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    execute: (editor: Editor) => editor.chain().focus(), // Dummy chain, actual logic in onClick
    isActive: (editor: Editor) => editor.isActive('youtube'),
    isDisabled: undefined
  },
  insertTable: {
    canExecute: (editor: Editor) => editor?.can()?.insertTable ? editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }) : false,
    execute: (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    isActive: (editor: Editor) => editor.isActive('table'),
    isDisabled: undefined
  }
} satisfies EditorCustomHandlers

const isFullscreen = ref(false)
const isTogglingFullscreen = ref(false)

const fixedToolbarItems = computed(() => [[{
  kind: 'undo',
  icon: 'i-lucide-undo',
  tooltip: { text: $t('editor.undo') }
}, {
  kind: 'redo',
  icon: 'i-lucide-redo',
  tooltip: { text: $t('editor.redo') }
}], [{
  icon: 'i-lucide-heading',
  tooltip: { text: $t('editor.heading') },
  content: {
    align: 'start'
  },
  items: [{
    kind: 'heading',
    level: 1,
    icon: 'i-lucide-heading-1',
    label: $t('editor.h1')
  }, {
    kind: 'heading',
    level: 2,
    icon: 'i-lucide-heading-2',
    label: $t('editor.h2')
  }, {
    kind: 'heading',
    level: 3,
    icon: 'i-lucide-heading-3',
    label: $t('editor.h3')
  }, {
    kind: 'heading',
    level: 4,
    icon: 'i-lucide-heading-4',
    label: $t('editor.h4')
  }]
}, {
  icon: 'i-lucide-list',
  tooltip: { text: $t('editor.list') },
  content: {
    align: 'start'
  },
  items: [{
    kind: 'bulletList',
    icon: 'i-lucide-list',
    label: $t('editor.bullet_list')
  }, {
    kind: 'orderedList',
    icon: 'i-lucide-list-ordered',
    label: $t('editor.ordered_list')
  }]
}, {
  kind: 'blockquote',
  icon: 'i-lucide-text-quote',
  tooltip: { text: $t('editor.quote') }
}, {
  kind: 'codeBlock',
  icon: 'i-lucide-square-code',
  tooltip: { text: $t('editor.code_block') }
}], [{
  kind: 'insertTable',
  icon: 'i-lucide-table',
  tooltip: { text: $t('editor.table') }
}, {
  slot: 'youtube' as const,
  icon: 'i-lucide-youtube',
  tooltip: { text: $t('editor.youtube') }
}],
[{
  kind: 'mark',
  mark: 'bold',
  icon: 'i-lucide-bold',
  tooltip: { text: $t('editor.bold') }
}, {
  kind: 'mark',
  mark: 'italic',
  icon: 'i-lucide-italic',
  tooltip: { text: $t('editor.italic') }
}, {
  kind: 'mark',
  mark: 'underline',
  icon: 'i-lucide-underline',
  tooltip: { text: $t('editor.underline') }
}, {
  kind: 'mark',
  mark: 'strike',
  icon: 'i-lucide-strikethrough',
  tooltip: { text: $t('editor.strike') }
}, {
  kind: 'mark',
  mark: 'code',
  icon: 'i-lucide-code',
  tooltip: { text: $t('editor.code') }
}], [{
  slot: 'link' as const,
  icon: 'i-lucide-link'
}, {
  kind: 'mediaGallery',
  icon: 'i-lucide-image',
  tooltip: { text: $t('editor.image') }
}],
[{
  icon: 'i-lucide-align-justify',
  tooltip: { text: $t('editor.align') },
  content: {
    align: 'end'
  },
  items: [{
    kind: 'textAlign',
    align: 'left',
    icon: 'i-lucide-align-left',
    label: $t('editor.align_left')
  }, {
    kind: 'textAlign',
    align: 'center',
    icon: 'i-lucide-align-center',
    label: $t('editor.align_center')
  }, {
    kind: 'textAlign',
    align: 'right',
    icon: 'i-lucide-align-right',
    label: $t('editor.align_right')
  }, {
    kind: 'textAlign',
    align: 'justify',
    icon: 'i-lucide-align-justify',
    label: $t('editor.align_justify')
  }]
}],
[{
  icon: isFullscreen.value ? 'i-lucide-minimize' : 'i-lucide-maximize',
  tooltip: { text: isFullscreen.value ? $t('editor.exit_fullscreen') : $t('editor.fullscreen') },
  onClick: () => {
    if (isTogglingFullscreen.value) return
    isTogglingFullscreen.value = true
    setTimeout(() => { isTogglingFullscreen.value = false }, 300)
    isFullscreen.value = !isFullscreen.value
  }
}]])

const bubbleToolbarItems = [[{
  label: $t('editor.turn_into'),
  trailingIcon: 'i-lucide-chevron-down',
  activeColor: 'neutral',
  activeVariant: 'ghost',
  tooltip: { text: $t('editor.turn_into') },
  content: {
    align: 'start'
  },
  ui: {
    label: 'text-xs'
  },
  items: [{
    type: 'label',
    label: $t('editor.turn_into')
  }, {
    kind: 'paragraph',
    label: $t('editor.paragraph'),
    icon: 'i-lucide-type'
  }, {
    kind: 'heading',
    level: 1,
    icon: 'i-lucide-heading-1',
    label: $t('editor.h1')
  }, {
    kind: 'heading',
    level: 2,
    icon: 'i-lucide-heading-2',
    label: $t('editor.h2')
  }, {
    kind: 'heading',
    level: 3,
    icon: 'i-lucide-heading-3',
    label: $t('editor.h3')
  }, {
    kind: 'heading',
    level: 4,
    icon: 'i-lucide-heading-4',
    label: $t('editor.h4')
  }, {
    kind: 'bulletList',
    icon: 'i-lucide-list',
    label: $t('editor.bullet_list')
  }, {
    kind: 'orderedList',
    icon: 'i-lucide-list-ordered',
    label: $t('editor.ordered_list')
  }, {
    kind: 'blockquote',
    icon: 'i-lucide-text-quote',
    label: $t('editor.quote')
  }, {
    kind: 'codeBlock',
    icon: 'i-lucide-square-code',
    label: $t('editor.code_block')
  }]
}], [{
  kind: 'mark',
  mark: 'bold',
  icon: 'i-lucide-bold',
  tooltip: { text: $t('editor.bold') }
}, {
  kind: 'mark',
  mark: 'italic',
  icon: 'i-lucide-italic',
  tooltip: { text: $t('editor.italic') }
}, {
  kind: 'mark',
  mark: 'underline',
  icon: 'i-lucide-underline',
  tooltip: { text: $t('editor.underline') }
}, {
  kind: 'mark',
  mark: 'strike',
  icon: 'i-lucide-strikethrough',
  tooltip: { text: $t('editor.strike') }
}, {
  kind: 'mark',
  mark: 'code',
  icon: 'i-lucide-code',
  tooltip: { text: $t('editor.code') }
}], [{
  slot: 'link' as const,
  icon: 'i-lucide-link'
}, {
  kind: 'mediaGallery',
  icon: 'i-lucide-image',
  tooltip: { text: $t('editor.image') }
}], [{
  icon: 'i-lucide-align-justify',
  tooltip: { text: $t('editor.align') },
  content: {
    align: 'end'
  },
  items: [{
    kind: 'textAlign',
    align: 'left',
    icon: 'i-lucide-align-left',
    label: $t('editor.align_left')
  }, {
    kind: 'textAlign',
    align: 'center',
    icon: 'i-lucide-align-center',
    label: $t('editor.align_center')
  }, {
    kind: 'textAlign',
    align: 'right',
    icon: 'i-lucide-align-right',
    label: $t('editor.align_right')
  }, {
    kind: 'textAlign',
    align: 'justify',
    icon: 'i-lucide-align-justify',
    label: $t('editor.align_justify')
  }]
}]] satisfies EditorToolbarItem<typeof customHandlers>[][]

const imageToolbarItems = (editor: Editor, isLabel: boolean = false, nodePos?: number): EditorToolbarItem[][] => {
  const { state } = editor
  const pos = nodePos ?? state.selection.from
  const node = state.doc.nodeAt(pos)

  return [[{
    icon: 'i-lucide-download',
    to: node?.attrs?.src,
    target: '_blank',
    download: true,
    // tooltip: { text: t('editor.download') },
    label: isLabel ? $t('editor.download') : undefined
  }, {
    icon: 'i-lucide-refresh-cw',
    // tooltip: { text: t('editor.replace') },
    label: isLabel ? $t('editor.replace') : undefined,
    onClick: () => {
      const targetNode = editor.state.doc.nodeAt(pos)

      if (targetNode && (targetNode.type.name === 'image' || targetNode.type.name === 'editorImage' || targetNode.type.name === 'mediaGallery')) {
        editor.chain().focus().deleteRange({ from: pos, to: pos + targetNode.nodeSize }).insertContentAt(pos, { type: 'mediaGallery' }).run()
      }
    }
  }], [{
    icon: 'i-lucide-trash',
    // tooltip: { text: t('editor.delete') },
    label: isLabel ? $t('editor.delete') : undefined,
    onClick: () => {
      const targetNode = editor.state.doc.nodeAt(pos)

      if (targetNode && (targetNode.type.name === 'image' || targetNode.type.name === 'editorImage' || targetNode.type.name === 'mediaGallery')) {
        editor.chain().focus().deleteRange({ from: pos, to: pos + targetNode.nodeSize }).run()
      }
    }
  }]]
}

// const youtubeToolbarItems = (editor: Editor, isLabel?: boolean): EditorToolbarItem[][] => {
//   return [[{
//     label: t('editor.video_width_small'),
//     icon: 'i-lucide-monitor-smartphone',
//     onClick: () => { editor.chain().focus().updateAttributes('youtube', { width: '50%' }).run() }
//   }, {
//     label: t('editor.video_width_medium'),
//     icon: 'i-lucide-monitor',
//     onClick: () => { editor.chain().focus().updateAttributes('youtube', { width: '75%' }).run() }
//   }, {
//     label: t('editor.video_width_full'),
//     icon: 'i-lucide-maximize',
//     onClick: () => { editor.chain().focus().updateAttributes('youtube', { width: '100%' }).run() }
//   }], [{
//     icon: 'i-lucide-align-left',
//     tooltip: { text: t('editor.align_left') },
//     label: isLabel ? t('editor.align_left') : undefined,
//     onClick: () => { editor.chain().focus().setTextAlign('left').run() },
//     active: editor.isActive({ textAlign: 'left' })
//   }, {
//     icon: 'i-lucide-align-center',
//     tooltip: { text: t('editor.align_center') },
//     label: isLabel ? t('editor.align_center') : undefined,
//     onClick: () => { editor.chain().focus().setTextAlign('center').run() },
//     active: editor.isActive({ textAlign: 'center' })
//   }, {
//     icon: 'i-lucide-align-right',
//     tooltip: { text: t('editor.align_right') },
//     label: isLabel ? t('editor.align_right') : undefined,
//     onClick: () => { editor.chain().focus().setTextAlign('right').run() },
//     active: editor.isActive({ textAlign: 'right' })
//   }], [{
//     icon: 'i-lucide-trash',
//     tooltip: { text: t('editor.delete') },
//     label: isLabel ? t('editor.delete') : undefined,
//     onClick: () => { editor.chain().focus().deleteSelection().run() }
//   }]]
// }

const selectedNode = ref<{ node: JSONContent, pos: number }>()

const dragHandleItems = (editor: Editor): DropdownMenuItem[][] => {
  if (!selectedNode.value?.node?.type) {
    return []
  }
  let targetNode = selectedNode.value.node
  let targetPos = selectedNode.value.pos

  // Check if selected node is a paragraph containing a single image/mediaGallery
  if (targetNode.type === 'paragraph' && targetNode.content?.length === 1) {
    const child = targetNode.content[0]
    if (child?.type === 'image' || child?.type === 'editorImage' || child?.type === 'mediaGallery') {
      targetNode = child
      targetPos += 1
    }
  }

  const items: DropdownMenuItem[][] = [
    [{
      type: 'label',
      label: upperFirst(selectedNode.value.node.type)
    }]
  ]

  if (targetNode.type === 'youtube') {
    // items.push(...youtubeToolbarItems(editor, true))
    items.push(
      [{
        label: $t('editor.size'),
        icon: 'i-lucide-scaling',
        content: {
          align: 'end'
        },
        children: [{
          label: $t('editor.video_width_small'),
          icon: 'i-lucide-monitor-smartphone',
          onClick: () => { editor.chain().focus().updateAttributes('youtube', { width: '50%' }).run() }
        }, {
          label: $t('editor.video_width_medium'),
          icon: 'i-lucide-monitor',
          onClick: () => { editor.chain().focus().updateAttributes('youtube', { width: '75%' }).run() }
        }, {
          label: $t('editor.video_width_full'),
          icon: 'i-lucide-maximize',
          onClick: () => { editor.chain().focus().updateAttributes('youtube', { width: '100%' }).run() }
        }]
      }]
    )
  }
  if (targetNode.type === 'image' || targetNode.type === 'editorImage' || targetNode.type === 'mediaGallery') {
    // items.push(...imageToolbarItems(editor, true, targetPos))
    items.push(
      [{
        label: $t('editor.options'),
        icon: 'i-lucide-ellipsis-vertical',
        content: {
          align: 'end'
        },
        children: [{
          icon: 'i-lucide-download',
          to: targetNode?.attrs?.src,
          target: '_blank',
          download: true,
          label: $t('editor.download')
        }, {
          icon: 'i-lucide-refresh-cw',
          label: $t('editor.replace'),
          onClick: () => {
            const currentNode = editor.state.doc.nodeAt(targetPos)

            if (currentNode && (currentNode.type.name === 'image' || currentNode.type.name === 'editorImage' || currentNode.type.name === 'mediaGallery')) {
              editor.chain().focus().deleteRange({ from: targetPos, to: targetPos + currentNode.nodeSize }).insertContentAt(targetPos, { type: 'mediaGallery' }).run()
            }
          }
        }]
      }]
    )
  }

  items.push(...mapEditorItems(editor, [[
    {
      icon: 'i-lucide-align-justify',
      label: $t('editor.align'),
      content: {
        align: 'end'
      },
      children: [{
        kind: 'textAlign',
        align: 'left',
        icon: 'i-lucide-align-left',
        label: $t('editor.align_left')
      }, {
        kind: 'textAlign',
        align: 'center',
        icon: 'i-lucide-align-center',
        label: $t('editor.align_center')
      }, {
        kind: 'textAlign',
        align: 'right',
        icon: 'i-lucide-align-right',
        label: $t('editor.align_right')
      }, {
        kind: 'textAlign',
        align: 'justify',
        icon: 'i-lucide-align-justify',
        label: $t('editor.align_justify')
      }]
    },
    {
      label: $t('editor.turn_into'),
      icon: 'i-lucide-repeat-2',
      children: [
        { kind: 'paragraph', label: $t('editor.paragraph'), icon: 'i-lucide-type' },
        { kind: 'heading', level: 1, label: $t('editor.h1'), icon: 'i-lucide-heading-1' },
        { kind: 'heading', level: 2, label: $t('editor.h2'), icon: 'i-lucide-heading-2' },
        { kind: 'heading', level: 3, label: $t('editor.h3'), icon: 'i-lucide-heading-3' },
        { kind: 'heading', level: 4, label: $t('editor.h4'), icon: 'i-lucide-heading-4' },
        { kind: 'bulletList', label: $t('editor.bullet_list'), icon: 'i-lucide-list' },
        { kind: 'orderedList', label: $t('editor.ordered_list'), icon: 'i-lucide-list-ordered' },
        { kind: 'blockquote', label: $t('editor.quote'), icon: 'i-lucide-text-quote' },
        { kind: 'codeBlock', label: $t('editor.code_block'), icon: 'i-lucide-square-code' }
      ]
    },
    {
      kind: 'clearFormatting',
      pos: selectedNode.value?.pos,
      label: $t('editor.reset_formatting'),
      icon: 'i-lucide-rotate-ccw'
    }
  ], [
    {
      kind: 'duplicate',
      pos: selectedNode.value?.pos,
      label: $t('editor.duplicate'),
      icon: 'i-lucide-copy'
    },
    {
      label: $t('editor.copy_to_clipboard'),
      icon: 'i-lucide-clipboard',
      onSelect: async () => {
        if (!selectedNode.value) return

        const pos = selectedNode.value.pos
        const node = editor.state.doc.nodeAt(pos)
        if (node) {
          await navigator.clipboard.writeText(node.textContent)
        }
      }
    }
  ], [
    {
      kind: 'moveUp',
      pos: selectedNode.value?.pos,
      label: $t('editor.move_up'),
      icon: 'i-lucide-arrow-up'
    },
    {
      kind: 'moveDown',
      pos: selectedNode.value?.pos,
      label: $t('editor.move_down'),
      icon: 'i-lucide-arrow-down'
    }
  ], [
    {
      kind: 'delete',
      pos: selectedNode.value?.pos,
      label: $t('editor.delete'),
      icon: 'i-lucide-trash'
    }
  ]], customHandlers) as DropdownMenuItem[][])

  return items
}

const suggestionItems = [[{
  type: 'label',
  label: $t('editor.style')
}, {
  kind: 'paragraph',
  label: $t('editor.paragraph'),
  icon: 'i-lucide-type'
}, {
  kind: 'heading',
  level: 1,
  label: $t('editor.h1'),
  icon: 'i-lucide-heading-1'
}, {
  kind: 'heading',
  level: 2,
  label: $t('editor.h2'),
  icon: 'i-lucide-heading-2'
}, {
  kind: 'heading',
  level: 3,
  label: $t('editor.h3'),
  icon: 'i-lucide-heading-3'
}, {
  kind: 'bulletList',
  label: $t('editor.bullet_list'),
  icon: 'i-lucide-list'
}, {
  kind: 'orderedList',
  label: $t('editor.ordered_list'),
  icon: 'i-lucide-list-ordered'
}, {
  kind: 'blockquote',
  label: $t('editor.quote'),
  icon: 'i-lucide-text-quote'
}, {
  kind: 'codeBlock',
  label: $t('editor.code_block'),
  icon: 'i-lucide-square-code'
}], [{
  type: 'label',
  label: $t('editor.insert')
}, {
  kind: 'mention',
  label: $t('editor.mention'),
  icon: 'i-lucide-at-sign'
}, {
  kind: 'emoji',
  label: $t('editor.emoji'),
  icon: 'i-lucide-smile-plus'
}, {
  kind: 'mediaGallery',
  label: $t('editor.image'),
  icon: 'i-lucide-image'
}, {
  kind: 'horizontalRule',
  label: $t('editor.horizontal_rule'),
  icon: 'i-lucide-separator-horizontal'
}]] as any

const mentionItems: EditorMentionMenuItem[] = [
  {
    label: 'benjamincanac',
    avatar: { src: 'https://avatars.githubusercontent.com/u/739984?v=4' }
  }, {
    label: 'HugoRCD',
    avatar: { src: 'https://avatars.githubusercontent.com/u/71938701?v=4' }
  }, {
    label: 'romhml',
    avatar: { src: 'https://avatars.githubusercontent.com/u/25613751?v=4' }
  }, {
    label: 'sandros94',
    avatar: { src: 'https://avatars.githubusercontent.com/u/13056429?v=4' }
  }, {
    label: 'hywax',
    avatar: { src: 'https://avatars.githubusercontent.com/u/149865959?v=4' }
  }, {
    label: 'J-Michalek',
    avatar: { src: 'https://avatars.githubusercontent.com/u/71264422?v=4' }
  }, {
    label: 'genu',
    avatar: { src: 'https://avatars.githubusercontent.com/u/928780?v=4' }
  }
]

// Emoji items are populated in onMounted
// const emojiItems: EditorEmojiMenuItem[] = gitHubEmojis.filter((emoji: any) => !emoji.name.startsWith('regional_indicator_'))
const appendToBody = false ? () => document.body : undefined

const getBubbleItems = (editor: Editor) => {
  if (editor.isActive('image') || editor.isActive('editorImage') || editor.isActive('mediaGallery')) {
    return imageToolbarItems(editor)
  }
  if (editor.isActive('youtube')) {
    // return youtubeToolbarItems(editor)
  }
  return bubbleToolbarItems
}
</script>

<template>
  <ClientOnly>
    <div class="custom-tiptap-editor flex justify-center p-0 rounded-b-md rounded-t-md"
      :class="[{ 'fixed inset-0 z-50 h-screen! w-screen! bg-white dark:bg-gray-900': isFullscreen }]">
      <LazyUEditor v-if="extensions.length" ref="editorRef" v-slot="{ editor, handlers }" v-model="value"
        :content-type="'html'" :extensions="extensions" :handlers="customHandlers"
        :starter-kit="{ link: { autolink: true } }"
        :placeholder="$t('editor.placeholder')"
        :ui="{ root: isFullscreen ? 'w-screen h-screen flex flex-col' : 'w-full', base: isFullscreen ? 'p-8 sm:px-16 py-13.5 flex-1 overflow-y-auto' : 'p-8 sm:px-16 py-13.5', content: isFullscreen ? 'h-full w-full' : 'w-full' }">
        <LazyUEditorToolbar :editor="editor" :items="fixedToolbarItems"
          class="flex-wrap border-b border-muted sticky top-0 inset-x-0 px-8 py-2 z-50 bg-default">
          <template #link>
            <LazyEditorTiptapLinkPopover :editor="editor" auto-open />
          </template>
          <template #youtube>
            <LazyEditorTiptapLinkPopover :editor="editor" type="youtube" />
          </template>
        </LazyUEditorToolbar>

        <LazyUEditorToolbar v-if="isBubble" :editor="editor" :items="getBubbleItems(editor)" layout="bubble"
          :should-show="({ editor, view, state }: any) => {
            if (editor.isActive('mediaGallery') || editor.isActive('image') || editor.isActive('editorImage')) {
              return view.hasFocus()
            }
            if (editor.isActive('youtube')) {
              return view.hasFocus()
            }
            const { selection } = state
            return view.hasFocus() && !selection.empty
          }">
          <template #link>
            <LazyEditorTiptapLinkPopover :editor="editor" />
          </template>
        </LazyUEditorToolbar>

        <LazyUEditorDragHandle v-slot="{ ui, onClick }" :editor="editor" @node-change="selectedNode = $event">
          <UButton icon="i-lucide:plus" color="neutral" variant="ghost" size="sm" :class="ui.handle()" @click="(e) => {
            e.stopPropagation()

            const selected = onClick()
            handlers.suggestion?.execute(editor, { pos: selected?.pos }).run()
          }" />

          <LazyUDropdownMenu v-slot="{ open }" :modal="false" :items="dragHandleItems(editor)"
            :content="{ side: 'left' }" :ui="{ content: 'w-48', label: 'text-xs' }"
            @update:open="editor.chain().setMeta('lockDragHandle', $event).run()">
            <UButton color="neutral" variant="ghost" active-variant="soft" size="sm" icon="i-lucide:grip-vertical"
              :active="open" :class="ui.handle()" />
          </LazyUDropdownMenu>
        </LazyUEditorDragHandle>

        <LazyUEditorSuggestionMenu :editor="editor" :items="suggestionItems" layout="bubble" />
        <LazyUEditorMentionMenu :editor="editor" :items="mentionItems" />
        <LazyUEditorEmojiMenu :editor="editor" :items="emojiItems" :append-to="appendToBody" />
      </LazyUEditor>
      <!-- <div v-else class="p-20 flex flex-col items-center gap-4 text-gray-500">
        <UIcon name="i-lucide:loader-2" class="animate-spin w-8 h-8" />
        <p>Initializing editor...</p>
      </div> -->
    </div>
    <template #fallback>
      <div class="border rounded-md p-20 text-center text-gray-400 bg-gray-50">
        <UIcon name="i-lucide:monitor" class="w-8 h-8 mx-auto mb-2" />
        {{ $t('common.loading_text') }}
      </div>
    </template>
  </ClientOnly>
</template>
