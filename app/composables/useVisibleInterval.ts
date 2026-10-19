import { useIntervalFn } from '@vueuse/core'

// =============================================================================
//  Polling that respects tab visibility (API budget: 60 req/min per app+IP).
//
//  Identical to useIntervalFn(fn, ms, { immediate }) while the tab is visible;
//  pauses while hidden and resumes with an immediate refresh on show, so panels
//  never display stale rows and background tabs burn zero budget. `canRun`
//  composes with other gates (e.g. auth-halt): a visibility change never
//  overrides them. Auto-cleanup on unmount (VueUse scope + listener removal).
// =============================================================================

export interface VisibleIntervalOptions {
  immediate?: boolean
  canRun?: () => boolean
}

export function useVisibleInterval(fn: () => void, ms: number, opts: VisibleIntervalOptions = {}) {
  const { pause, resume, isActive } = useIntervalFn(fn, ms, { immediate: opts.immediate ?? true })
  const canRun = opts.canRun ?? (() => true)
  const onVisibility = (): void => {
    if (document.hidden) {
      pause()
    } else if (canRun()) {
      fn()
      resume()
    }
  }
  onMounted(() => document.addEventListener('visibilitychange', onVisibility))
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisibility))
  return { pause, resume, isActive }
}
