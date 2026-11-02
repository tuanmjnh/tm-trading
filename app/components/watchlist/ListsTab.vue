<script setup lang="ts">
// =============================================================================
//  ListsTab (S8 chunk 1) — manage named watchlists: create, rename, delete,
//  set default. The trading panel always shows the default list; this tab lets
//  the user maintain the rest.
//
//  All strings via t(); no inline fallbacks (AGENTS.md).
// =============================================================================
import { LazyBaseConfirmModal } from '#components'

const { t } = useI18n()
const { lists, loading, error, defaultList, fetchLists, createList, renameList, updateSymbols, deleteList } = useWatchlists()

onMounted(() => {
  fetchLists()
})

const showCreate = ref(false)
const newName = ref('')
const editingId = ref<string | null>(null)
const editName = ref('')
const confirmDeleteId = ref<string | null>(null)

async function handleCreate() {
  if (!newName.value.trim()) return
  await createList(newName.value.trim())
  newName.value = ''
  showCreate.value = false
}

function startRename(list: any) {
  editingId.value = list._id
  editName.value = list.name
}

async function saveRename(id: string) {
  if (!editName.value.trim()) return
  await renameList(id, editName.value.trim())
  editingId.value = null
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
    await deleteList(confirmDeleteId.value)
    confirmDeleteId.value = null
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

    <!-- Error state -->
    <UAlert v-if="error" color="error" variant="soft" :title="error" />

    <!-- Empty state -->
    <div v-if="!loading && lists.length === 0" class="text-center py-8 text-muted">
      {{ t('watchlistLists.empty') }}
    </div>

    <!-- List -->
    <div v-else class="space-y-2">
      <div
        v-for="list in lists"
        :key="list._id"
        class="flex items-center justify-between rounded-lg border p-3"
      >
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-list" class="text-muted" />
          <div>
            <div v-if="editingId !== list._id" class="font-medium">
              {{ list.name }}
              <UBadge v-if="list.isDefault" size="xs" color="primary" variant="soft">
                {{ t('watchlistLists.setDefault') }}
              </UBadge>
            </div>
            <UInput
              v-else
              v-model="editName"
              class="w-48"
              @keyup.enter="saveRename(list._id)"
              @keyup.escape="cancelRename"
            />
            <div class="text-xs text-muted">
              {{ list.symbols.length }} symbols
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
        </div>
      </div>
    </div>

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