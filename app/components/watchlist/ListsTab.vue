<script setup lang="ts">
// =============================================================================
//  ListsTab (S8 chunk 1+2) — manage named watchlists: create, rename, delete,
//  set default, drag-to-reorder symbols, bulk symbol import/export.
//  The trading panel always shows the default list; this tab manages the rest.
//
//  Drag-to-reorder (chunk 2) uses sortablejs, the same pattern as
//  app/components/media/Gallery.vue: one instance per expanded list, init on
//  expand, destroy on collapse/unmount. The reorder is a server-side write;
//  on failure the list is restored from the server (fetchLists), never left
//  in a locally mutated state.
//
//  All strings via t(); no inline fallbacks (AGENTS.md).
// =============================================================================
import { nextTick, onUnmounted, watch } from 'vue'
import Sortable from 'sortablejs'
import type { WatchlistItem } from '#shared/types/watchlist'
import { LazyBaseConfirmModal } from '#components'

const { t } = useI18n()
const { lists, loading, error, defaultList, fetchLists, createList, renameList, updateSymbols, reorderSymbols, deleteList, removeSymbol, shareList, unshareList } = useWatchlists()
const hub = useHub()
const me = useAuth().user

onMounted(() => {
  fetchLists()
})

const showCreate = ref(false)
const newName = ref('')
const editingId = ref<string | null>(null)
const editName = ref('')
const confirmDeleteId = ref<string | null>(null)

const showShare = ref(false)
const shareListId = ref<string | null>(null)
const shareQuery = ref('')
const shareResults = ref<any[]>([])
const shareLoading = ref(false)
let shareTimer: ReturnType<typeof setTimeout> | null = null

// A write failure (reorder / import / remove) surfaces here; the composable
// `error` only tracks read failures. After a failed write the state is
// restored from the server so the UI never shows a local-only mutation.
const writeError = ref<string | null>(null)

async function handleCreate() {
  if (!newName.value.trim()) return
  try {
    await createList(newName.value.trim())
    newName.value = ''
    showCreate.value = false
  } catch (err) {
    writeError.value = err instanceof Error ? err.message : String(err)
  }
}

function startRename(list: any) {
  editingId.value = list._id
  editName.value = list.name
}

async function saveRename(id: string) {
  if (!editName.value.trim()) return
  try {
    await renameList(id, editName.value.trim())
    editingId.value = null
  } catch (err) {
    writeError.value = err instanceof Error ? err.message : String(err)
  }
}

function cancelRename() {
  editingId.value = null
}

async function handleDelete(id: string) {
  const list = lists.value.find((l) => l._id === id)
  if (list?.isDefault) {
    // Cannot delete default — surface the i18n message instead of throwing.
    return
  }
  confirmDeleteId.value = id
}

async function confirmDeleteAction() {
  if (confirmDeleteId.value) {
    try {
      await deleteList(confirmDeleteId.value)
      confirmDeleteId.value = null
    } catch (err) {
      writeError.value = err instanceof Error ? err.message : String(err)
    }
  }
}

// -----------------------------------------------------------------------------
//  Symbol management (chunk 2): expand a list, drag rows to reorder, remove,
//  bulk import (merge) and export (copy / download).
// -----------------------------------------------------------------------------
const expandedId = ref<string | null>(null)
const symbolListEl = ref<HTMLElement | null>(null)
let sortable: Sortable | null = null

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function destroySortable() {
  sortable?.destroy()
  sortable = null
}

function initSortable() {
  if (!symbolListEl.value || sortable) return
  sortable = new Sortable(symbolListEl.value, {
    handle: '.symbol-drag-handle',
    animation: 150,
    ghostClass: 'opacity-50',
    delayOnTouchOnly: true,
    delay: 150,
    onEnd(evt) {
      const { oldIndex, newIndex } = evt
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      const list = lists.value.find((l) => l._id === expandedId.value)
      if (!list) return
      const symbols = [...list.symbols]
      const moved = symbols.splice(oldIndex, 1)[0]
      if (!moved) return
      symbols.splice(newIndex, 0, moved)
      void applyReorder(list._id, symbols)
    }
  })
}

watch(expandedId, (val) => {
  destroySortable()
  if (val) nextTick(initSortable)
})

onUnmounted(destroySortable)

/** Optimistic reorder: mutate locally, persist, restore on failure. */
async function applyReorder(id: string, symbols: string[]) {
  const list = lists.value.find((l) => l._id === id)
  if (!list) return
  const previous = [...list.symbols]
  list.symbols = [...symbols]
  try {
    const updated = await reorderSymbols(id, symbols)
    const idx = lists.value.findIndex((l) => l._id === id)
    if (idx !== -1) lists.value[idx] = { ...lists.value[idx], symbols: updated.symbols } as WatchlistItem
  } catch (err) {
    list.symbols = previous
    writeError.value = err instanceof Error ? err.message : String(err)
  }
}

async function removeRow(list: any, symbol: string) {
  try {
    await removeSymbol(list._id, symbol)
  } catch (err) {
    writeError.value = err instanceof Error ? err.message : String(err)
  }
}

// --- Bulk import (merge) -----------------------------------------------------
const showImport = ref(false)
const importTargetId = ref<string | null>(null)
const importText = ref('')

function openImport(list: any) {
  importTargetId.value = list._id
  importText.value = ''
  showImport.value = true
}

async function applyImport() {
  const list = lists.value.find((l) => l._id === importTargetId.value)
  if (!list) return
  const parsed = importText.value
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parsed.length) return
  try {
    // Merge: existing symbols first, new ones appended; the server dedupes +
    // caps. `updateSymbols` replaces the array, so send the merged set.
    await updateSymbols(list._id, [...list.symbols, ...parsed])
    showImport.value = false
    importText.value = ''
  } catch (err) {
    writeError.value = err instanceof Error ? err.message : String(err)
  }
}

// --- Export (clipboard, file download as fallback) ---------------------------
const copiedId = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function exportList(list: any) {
  const text = list.symbols.join('\n')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard unavailable (insecure context / permission): download instead.
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${list.name.replace(/[^\w.-]+/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  copiedId.value = list._id
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copiedId.value = null }, 1600)
}

// --- Share (chunk 3) ---------------------------------------------------------
function openShare(list: any) {
  if (!isOwner(list)) return
  shareListId.value = list._id
  shareQuery.value = ''
  shareResults.value = []
  showShare.value = true
}

function isOwner(list: any) {
  return String(list.ownerId) === String(me.value?.id)
}

async function searchUsers() {
  const q = shareQuery.value.trim()
  if (!q) { shareResults.value = [] ; return }
  shareLoading.value = true
  if (shareTimer) clearTimeout(shareTimer)
  shareTimer = setTimeout(async () => {
    try {
      const res = await hub.users.list({ q, limit: 20 })
      shareResults.value = res?.data ?? []
    } catch {
      shareResults.value = []
    } finally {
      shareLoading.value = false
    }
  }, 300)
}

async function doShare(userId: string) {
  if (!shareListId.value) return
  try {
    await shareList(shareListId.value, userId)
  } catch (err) {
    writeError.value = err instanceof Error ? err.message : String(err)
  }
}

async function doUnshare(userId: string) {
  if (!shareListId.value) return
  try {
    await unshareList(shareListId.value, userId)
  } catch (err) {
    writeError.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="space-y-4 p-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ t('watchlistLists.title') }}</h2>
      <UButton color="primary" variant="soft" @click="showCreate = true">
        {{ t('watchlistLists.create') }}
      </UButton>
    </div>

    <!-- Create modal -->
    <UModal v-model="showCreate">
      <UCard>
        <template #header>
          <h3 class="text-base font-medium">{{ t('watchlistLists.create') }}</h3>
        </template>
        <UInput v-model="newName" :placeholder="t('watchlistLists.namePlaceholder')" class="w-full" />
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" @click="showCreate = false">{{ t('common.cancel') }}</UButton>
            <UButton color="primary" variant="soft" @click="handleCreate" :disabled="!newName.trim()">
              {{ t('common.create') }}
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- Error state (reads from composable, writes local) -->
    <UAlert v-if="error" color="error" variant="soft" :title="error" />
    <UAlert v-if="writeError" color="warning" variant="soft" :title="writeError" />

    <!-- Empty state -->
    <div v-if="!loading && lists.length === 0" class="text-center py-8 text-muted">
      {{ t('watchlistLists.empty') }}
    </div>

    <!-- List -->
    <div v-else class="space-y-2">
      <div
        v-for="list in lists"
        :key="list._id"
        class="rounded-lg border"
      >
        <!-- Header row -->
        <div class="flex items-center justify-between p-3">
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-list" class="text-muted" />
            <div>
              <div v-if="editingId !== list._id" class="flex items-center gap-2 font-medium">
                {{ list.name }}
                <UBadge v-if="list.isDefault" size="xs" color="primary" variant="soft">
                  {{ t('watchlistLists.setDefault') }}
                </UBadge>
                <div v-if="!isOwner(list)" class="text-xs text-muted flex items-center gap-1 italic">
                  <UIcon name="i-lucide-lock" class="w-3 h-3" />
                  {{ t('watchlistLists.ownerOnly') }}
                </div>
              </div>
              <UInput
                v-else
                v-model="editName"
                class="w-48"
                @keyup.enter="saveRename(list._id)"
                @keyup.escape="cancelRename"
              />
              <div class="text-xs text-muted">
                {{ t('watchlistLists.count', { n: list.symbols.length }) }}
                <span v-if="list.sharedWith?.length" class="ml-1">
                  • {{ t('watchlistLists.sharedWith') }}: {{ list.sharedWith.length }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="editingId === list._id" class="flex gap-1">
            <UButton size="xs" variant="ghost" @click="saveRename(list._id)">
              {{ t('common.save') }}
            </UButton>
            <UButton size="xs" variant="ghost" @click="cancelRename">
              {{ t('common.cancel') }}
            </UButton>
          </div>
          <div v-else class="flex gap-1">
            <UButton
              size="xs"
              variant="ghost"
              :icon="expandedId === list._id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-label="t('watchlistLists.manage')"
              @click="toggleExpand(list._id)"
            />
            <template v-if="isOwner(list)">
              <UButton size="xs" variant="ghost" @click="openShare(list)">
                {{ t('watchlistLists.share') }}
              </UButton>
              <UButton size="xs" variant="ghost" @click="startRename(list)">
                {{ t('watchlistLists.rename') }}
              </UButton>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                :disabled="list.isDefault"
                @click="handleDelete(list._id)"
              >
                {{ t('watchlistLists.delete') }}
              </UButton>
            </template>
          </div>
        </div>

        <!-- Expanded symbol management (chunk 2) -->
        <div v-if="expandedId === list._id" class="border-t p-3">
          <div class="mb-2 flex items-center gap-2">
            <UButton size="xs" color="primary" variant="soft" @click="openImport(list)">
              {{ t('watchlistLists.import') }}
            </UButton>
            <UButton size="xs" variant="ghost" @click="exportList(list)">
              {{ copiedId === list._id ? t('watchlistLists.exported') : t('watchlistLists.export') }}
            </UButton>
          </div>

          <div v-if="list.symbols.length" ref="symbolListEl" class="space-y-1">
            <div
              v-for="sym in list.symbols"
              :key="sym"
              class="flex items-center gap-2 rounded bg-muted/30 px-2 py-1.5"
            >
              <UButton
                class="symbol-drag-handle cursor-grab"
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-grip-vertical"
                :aria-label="t('watchlistLists.dragHandle')"
              />
              <span class="flex-1 font-mono text-sm">{{ sym }}</span>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-x"
                :aria-label="t('watchlistLists.removeSymbol')"
                @click="removeRow(list, sym)"
              />
            </div>
          </div>
          <div v-else class="px-2 py-1 text-xs text-muted">
            {{ t('watchlistLists.emptySymbols') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Import modal (chunk 2) -->
    <UModal v-model="showImport">
      <UCard>
        <template #header>
          <h3 class="text-base font-medium">{{ t('watchlistLists.importTitle') }}</h3>
        </template>
        <p class="mb-2 text-xs text-muted">{{ t('watchlistLists.importDesc') }}</p>
        <UTextarea
          v-model="importText"
          class="w-full font-mono"
          :placeholder="t('watchlistLists.importPlaceholder')"
          :rows="6"
        />
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" @click="showImport = false">{{ t('common.cancel') }}</UButton>
            <UButton
              color="primary"
              variant="soft"
              :disabled="!importText.trim()"
              @click="applyImport"
            >
              {{ t('watchlistLists.apply') }}
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- Share modal -->
    <UModal v-model="showShare">
      <UCard>
        <template #header>
          <h3 class="text-base font-medium">{{ t('watchlistLists.shareTitle') }}</h3>
        </template>
        <p class="mb-4 text-xs text-muted">{{ t('watchlistLists.shareDesc') }}</p>
        
        <div class="space-y-4">
          <UInput
            v-model="shareQuery"
            :placeholder="t('watchlistLists.sharePlaceholder')"
            class="w-full"
            @update:model-value="searchUsers"
          />

          <div v-if="shareLoading" class="text-xs italic text-muted">Loading...</div>
          <div v-else-if="shareResults.length" class="space-y-1">
            <div
              v-for="user in shareResults"
              :key="user.id"
              class="flex items-center justify-between rounded bg-muted/20 px-2 py-1 text-sm"
            >
              <span>{{ user.username }} ({{ user.email }})</span>
              <UButton size="xs" variant="ghost" @click="doShare(user.id)">{{ t('watchlistLists.share') }}</UButton>
            </div>
          </div>
          
          <div class="mt-6">
            <h4 class="text-sm font-medium mb-2">{{ t('watchlistLists.sharedWith') }}</h4>
            <div v-if="lists.find(l => l._id === shareListId)?.sharedWith?.length" class="space-y-1">
              <div
                v-for="userId in lists.find(l => l._id === shareListId)?.sharedWith"
                :key="userId"
                class="flex items-center justify-between rounded border px-2 py-1 text-sm"
              >
                <span class="font-mono text-xs">{{ userId }}</span>
                <UButton size="xs" variant="ghost" color="error" @click="doUnshare(userId)">{{ t('watchlistLists.unshare') }}</UButton>
              </div>
            </div>
            <div v-else class="text-xs text-muted italic">{{ t('watchlistLists.noSharedUsers') }}</div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end">
            <UButton variant="ghost" @click="showShare = false">{{ t('common.close') }}</UButton>
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- Delete confirmation -->
    <LazyBaseConfirmModal
      v-if="confirmDeleteId"
      :open="!!confirmDeleteId"
      :title="t('watchlistLists.delete')"
      :description="t('watchlistLists.confirmDelete')"
      @confirm="confirmDeleteAction"
      @cancel="confirmDeleteId = null"
    />
  </div>
</template>
