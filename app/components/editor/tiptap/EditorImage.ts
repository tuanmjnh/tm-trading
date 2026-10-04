import Image from '@tiptap/extension-image'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import EditorImageNode from './EditorImageNode.vue'
// const LazyEditorImageNode = defineAsyncComponent(() => import('./EditorImageNode.vue'))
export const EditorImage = Image.extend({
  name: 'editorImage',
  group: 'inline',
  inline: true,

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        priority: 1000
      }
    ]
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: attributes => {
          if (!attributes.width) {
            return {}
          }
          return {
            width: attributes.width,
            style: `width: ${attributes.width}`
          }
        }
      },
      height: {
        default: null
      }
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(EditorImageNode)
  }
})

export default EditorImage
