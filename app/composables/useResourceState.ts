import { computed, ref, type ComputedRef, type Ref } from 'vue'

/**
 * Honest refresh state for a standalone trading screen (roadmap §61.17 Phase C,
 * step C5). A screen must be able to tell an EMPTY result apart from a FAILED
 * load, and flag data as stale instead of silently showing an empty table.
 *
 * `run(fn)` owns the lifecycle: it sets `loading` around the call, clears
 * `error` and stamps `lastUpdated` on success, and stores the failure on error
 * (it never throws — callers surface `hasError` inline). Because `lastUpdated`
 * survives a later failure, `isStale` is true exactly when a refresh failed but
 * earlier data is still on screen.
 */
export interface ResourceState {
  loading: Ref<boolean>
  error: Ref<unknown>
  lastUpdated: Ref<number | null>
  isLoading: ComputedRef<boolean>
  hasError: ComputedRef<boolean>
  isStale: ComputedRef<boolean>
  hasLoaded: ComputedRef<boolean>
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
}

export function useResourceState(): ResourceState {
  const loading = ref(false)
  const error = ref<unknown>(null)
  const lastUpdated = ref<number | null>(null)

  const isLoading = computed(() => loading.value)
  const hasError = computed(() => error.value != null)
  const hasLoaded = computed(() => lastUpdated.value != null)
  const isStale = computed(() => error.value != null && lastUpdated.value != null)

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (loading.value) return undefined
    loading.value = true
    try {
      const res = await fn()
      error.value = null
      lastUpdated.value = Date.now()
      return res
    } catch (err) {
      error.value = err
      return undefined
    } finally {
      loading.value = false
    }
  }

  return { loading, error, lastUpdated, isLoading, hasError, isStale, hasLoaded, run }
}
