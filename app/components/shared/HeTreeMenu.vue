<script setup lang="ts" generic="TNode extends object">
import type { DropdownMenuItem } from '@nuxt/ui'
import { computed, ref, watch, nextTick } from 'vue'
import { Draggable } from '@he-tree/vue'
import '@he-tree/vue/style/default.css'

type TreeMenuItems = DropdownMenuItem[] | DropdownMenuItem[][]

interface TreeFieldNames {
  id: string
  label: string
  children: string
}

interface TreeStat<TData> {
  data: TData
  open: boolean
}

interface DraggableTree<TData> {
  stats?: Record<string, TreeStat<TData>> | null
}

interface Props {
  modelValue?: TNode[]
  fieldNames?: TreeFieldNames
  selectedKeys?: Set<string | number> | (string | number)[]
  classNode?: string
  defaultIcon?: string
  hideIcon?: boolean
  defaultExpandAll?: boolean
  expandedIds?: (string | number)[]
  draggable?: boolean
  /** Makes the whole node card emit `node:click`, not only the label. */
  cardClickable?: boolean
  actionOptions?: (node: TNode) => TreeMenuItems
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => [],
  fieldNames: () => ({ id: 'id', label: 'label', children: 'children' }),
  selectedKeys: () => [],
  classNode: '',
  defaultIcon: undefined,
  hideIcon: false,
  defaultExpandAll: false,
  expandedIds: () => [],
  draggable: true,
  cardClickable: false,
  actionOptions: undefined
})

const emit = defineEmits<{
  'update:modelValue': [value: TNode[]]
  'node:click': [node: TNode]
  'node:toggle': [payload: { node: TNode, isOpen: boolean }]
  'node:select': [payload: { node: TNode, isSelected: boolean }]
  'node:drop': [payload: unknown]
  'node:after-drop': [payload: unknown]
  'update:expandedIds': [value: (string | number)[]]
}>()

// -- State --
const treeRef = ref<unknown>(null)
const dragTriggerClass = 'tree-drag-handle'
const isLoading = ref(false)
let expansionTimerId: ReturnType<typeof setTimeout> | null = null

function clearExpansionTimers() {
  if (expansionTimerId) {
    clearTimeout(expansionTimerId)
    expansionTimerId = null
  }
}

/** Draggable keeps an internal `stats` map that its typings do not declare. */
function treeApi(): DraggableTree<TNode> | null {
  return (treeRef.value as DraggableTree<TNode> | null) ?? null
}

function normalizeId(id: unknown): string | number {
  if (!id) return ''
  if (typeof id === 'object') {
    const record = id as Record<string, unknown>
    if (record.$oid) return String(record.$oid)
    const fallback = record._id ?? record.id
    if (typeof fallback === 'string' || typeof fallback === 'number') return fallback
    return JSON.stringify(id)
  }
  if (typeof id === 'number') return id
  return String(id)
}

// State variable: Fully On/Fully Closed
const openNodeIds = ref(new Set<string | number>((props.expandedIds || []).map(id => normalizeId(id))))
const isAllExpanded = ref(props.defaultExpandAll)

const treeData = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val)
})

// -- Helpers --
const nodeId = (node: TNode) => normalizeId((node as Record<string, unknown>)[props.fieldNames.id])
const getNodeKey = (stat: TreeStat<TNode>) => nodeId(stat.data)

function isSelected(node: TNode): boolean {
  const id = nodeId(node)
  const keys = props.selectedKeys
  if (keys instanceof Set) return keys.has(id)
  return keys.some(key => normalizeId(key) === id)
}

const getLabel = (node: TNode) => (node as Record<string, unknown>)[props.fieldNames.label]

function hasChildren(node: TNode): boolean {
  // Lazy nodes advertise their children without shipping them.
  if ((node as Record<string, unknown>).hasChildren === true) return true
  const children = (node as Record<string, unknown>)[props.fieldNames.children]
  return Array.isArray(children) && children.length > 0
}

const getIconName = (node: TNode) => {
  const icon = (node as Record<string, unknown>).icon
  return typeof icon === 'string' ? icon : props.defaultIcon
}

// -- Context Menu Logic --
const contextMenu = ref<{ isOpen: boolean, x: number, y: number, items: TreeMenuItems }>({
  isOpen: false,
  x: 0,
  y: 0,
  items: []
})

function handleContextMenu(node: TNode, event: MouseEvent) {
  if (!props.actionOptions) return
  contextMenu.value = {
    isOpen: true,
    x: event.clientX,
    y: event.clientY,
    items: props.actionOptions(node)
  }
}

// -- Events --
function syncStatsToOpenIds() {
  const stats = treeApi()?.stats
  if (!stats) return
  const newSet = new Set<string | number>()
  for (const stat of Object.values(stats)) {
    if (!stat?.open) continue
    const id = nodeId(stat.data)
    if (id !== '') newSet.add(id)
  }
  openNodeIds.value = newSet
  emit('update:expandedIds', Array.from(newSet))
}

function toggleNode(node: TNode, stat: TreeStat<TNode>) {
  if (!stat) return
  stat.open = !stat.open
  syncStatsToOpenIds()
  emit('node:toggle', { node, isOpen: stat.open })
}

function onSelect(node: TNode, selected: boolean) {
  emit('node:select', { node, isSelected: selected })
}

function onNodeClick(node: TNode) {
  emit('node:click', node)
}

function onDrop(store: unknown) {
  emit('node:drop', store)
}

function onAfterDrop(store: unknown) {
  emit('node:after-drop', store)
}

// -- Expansion restoration --
function applyOpenStates(stats: Record<string, TreeStat<TNode>>): boolean {
  let changed = false
  for (const stat of Object.values(stats)) {
    if (!stat) continue
    const id = nodeId(stat.data)
    // defaultExpandAll wins during search; otherwise only remembered ids open.
    const shouldBeOpen = props.defaultExpandAll || (id !== '' && openNodeIds.value.has(id))
    if (shouldBeOpen && !stat.open) {
      stat.open = true
      changed = true
    }
  }
  return changed
}

function restoreOpenStates() {
  const stats = treeApi()?.stats
  if (!stats) return

  applyOpenStates(stats)
  clearExpansionTimers()

  // Children stats only exist once their parent opens, so keep sweeping.
  const nextPass = (depth = 0) => {
    if (depth > 12) return

    expansionTimerId = setTimeout(() => {
      const current = treeApi()?.stats
      const changed = current ? applyOpenStates(current) : false
      const shouldContinue = changed || (props.defaultExpandAll && depth < 8)

      if (shouldContinue) {
        nextPass(depth + 1)
      } else if (props.defaultExpandAll) {
        isAllExpanded.value = true
        syncStatsToOpenIds()
      }
    }, 80)
  }

  nextPass()
}

watch(() => props.modelValue, async (newVal) => {
  if (!newVal) {
    isLoading.value = true
    return
  }

  isLoading.value = false
  await nextTick()

  clearExpansionTimers()
  expansionTimerId = setTimeout(() => {
    restoreOpenStates()
  }, 100)
}, { immediate: true, deep: false })

// Trigger restoration if defaultExpandAll changes (e.g. search starts/ends)
watch(() => props.defaultExpandAll, (newVal) => {
  if (newVal) restoreOpenStates()
})

// Synchronize external expandedIds with local openNodeIds
watch(() => props.expandedIds, (newVal) => {
  if (props.defaultExpandAll) return

  const normalizedNew = new Set((newVal || []).map(id => normalizeId(id)))
  const sameSize = normalizedNew.size === openNodeIds.value.size
  const identical = sameSize && [...normalizedNew].every(id => openNodeIds.value.has(id))

  if (!identical) {
    openNodeIds.value = normalizedNew
    restoreOpenStates()
  }
}, { deep: true })

// -- Action Methods (Exposed) --
function setAllOpen(open: boolean) {
  const stats = treeApi()?.stats
  if (!stats) return
  for (const stat of Object.values(stats)) {
    if (stat) stat.open = open
  }
  isAllExpanded.value = open
  syncStatsToOpenIds()
}

const expandAll = () => setAllOpen(true)
const collapseAll = () => setAllOpen(false)

const toggleAll = () => {
  setAllOpen(!isAllExpanded.value)
}

// Open a specific node (Supported from parent calling in)
function openNode(key: string | number) {
  const stat = treeApi()?.stats?.[String(key)]
  if (stat) stat.open = true
}

defineExpose({
  expandAll,
  collapseAll,
  toggleAll,
  isAllExpanded,
  openNode
})
</script>

<template>
  <div class="tree-menu">
    <div v-if="isLoading" class="space-y-2 py-2">
      <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-3">
        <USkeleton class="h-4 w-4 rounded-full" />
        <USkeleton class="h-4 w-4 rounded" />
        <USkeleton class="h-4 rounded" :style="{ width: Math.floor(Math.random() * 40 + 30) + '%' }" />
      </div>
    </div>

    <div v-show="!isLoading">
      <Draggable ref="treeRef" v-model="treeData" :children-key="fieldNames.children" :node-key="getNodeKey"
        :default-open="defaultExpandAll" class="he-tree-root" :trigger-class="dragTriggerClass" tree-line @drop="onDrop"
        @after-drop="onAfterDrop">
        <template #default="{ node, stat }">
          <div
            class="group flex flex-col mb-2 py-2 px-3 rounded border border-default bg-elevated/40 backdrop-blur-sm transition-all hover:bg-elevated/70 hover:border-primary/50"
            :class="[classNode, { 'bg-primary/10! border-primary/40!': isSelected(node), 'cursor-pointer': cardClickable }]"
            @click="cardClickable && onNodeClick(node)" @contextmenu.prevent="handleContextMenu(node, $event)">
            <div class="flex items-center gap-2">
              <div v-if="draggable" :class="dragTriggerClass"
                class="flex cursor-move p-1 text-dimmed opacity-50 group-hover:opacity-100" @click.stop>
                <UIcon name="i-lucide-grip-vertical" class="w-4 h-4" />
              </div>

              <div class="flex items-center p-1" @click.stop>
                <UCheckbox :model-value="isSelected(node)"
                  @update:model-value="(val: unknown) => onSelect(node, val === true)" />
              </div>

              <slot v-if="!hideIcon" name="icon" :node="node" :stat="stat">
                <UIcon v-if="getIconName(node)" :name="getIconName(node) ?? ''"
                  class="w-4 h-4 text-dimmed" />
              </slot>

              <div class="flex-1 min-w-0 select-none" :class="{ 'cursor-pointer': !cardClickable }"
                @click="!cardClickable && onNodeClick(node)">
                <div class="flex flex-col">
                  <slot name="title" :node="node" :stat="stat">
                    <span class="text-sm font-medium text-highlighted truncate block">
                      {{ getLabel(node) }}
                    </span>
                  </slot>
                  <slot name="description" :node="node" :stat="stat" />
                </div>
              </div>

              <div class="flex items-center gap-1">
                <slot name="right-text" :node="node" :stat="stat" />

                <button type="button"
                  class="flex items-center justify-center w-5 h-5 mr-0.5 rounded hover:bg-accented transition-colors focus:outline-none"
                  :class="{ 'invisible pointer-events-none': !hasChildren(node) }" @click.stop="toggleNode(node, stat)">
                  <UIcon name="i-lucide-chevron-right" class="text-muted transition-transform duration-200"
                    :class="{ 'rotate-90': stat.open }" />
                </button>

                <slot name="actions" :node="node" :stat="stat" />
              </div>
            </div>

            <!-- Mobile Extra Slot (Visible only on mobile) -->
            <div v-if="$slots['mobile-extra']"
              class="block lg:hidden px-3 pb-3 -mt-1 ml-10 sm:ml-12 border-t border-muted pt-2">
              <slot name="mobile-extra" :node="node" :stat="stat" />
            </div>
          </div>
        </template>
      </Draggable>
      <slot name="last-item">
        <div class="pb-20 md:pb-16" />
      </slot>
    </div>
    <!-- Global Context Menu (Virtual) -->
    <div v-if="contextMenu.isOpen" class="fixed w-1 h-1 z-9999 pointer-events-none"
      :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }">
      <UDropdownMenu :items="contextMenu.items" :open="true" :popper="{ placement: 'bottom-start' }"
        class="pointer-events-auto" @update:open="(val) => !val && (contextMenu.isOpen = false)">
        <div />
      </UDropdownMenu>
    </div>
  </div>
</template>

<style>
.he-tree-drag-placeholder {
  background: var(--ui-primary) !important;
  height: 2px !important;
}

.tree-line {
  background-color: transparent;
}

.tree-vline {
  background-color: var(--ui-border-muted);
}

.dark .tree-vline {
  background-color: var(--ui-border);
}

.tree-hline {
  background-color: var(--ui-border-muted);
}

.dark .tree-hline {
  background-color: var(--ui-border);
}
</style>
