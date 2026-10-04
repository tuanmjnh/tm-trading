import { Node, mergeAttributes } from '@tiptap/core'
import type { CommandProps, NodeViewRenderer } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import MediaGalleryNodeComponent from './EditorMediaGalleryNode.vue'
// const LazyMediaGalleryNodeComponent = defineAsyncComponent(() => import('./EditorMediaGalleryNode.vue'))
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaGallery: {
      insertMediaGallery: () => ReturnType
    }
  }
}

export const MediaGallery = Node.create({
  name: 'mediaGallery',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {}
  },
  parseHTML() {
    return [{
      tag: 'div[data-type="media-gallery"]'
    }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'media-gallery' })]
  },
  addNodeView(): NodeViewRenderer {
    return VueNodeViewRenderer(MediaGalleryNodeComponent)
  },
  addCommands() {
    return {
      insertMediaGallery: () => ({ commands }: CommandProps) => {
        return commands.insertContent({ type: this.name })
      }
    }
  }
})

export default MediaGallery
