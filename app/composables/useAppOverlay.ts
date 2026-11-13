// =============================================================================
//  useAppOverlay — ONE typed overlay registry for the V5.0 Dashboard.
//
//  Rules (docs/web-app/tm-trading-central-dashboard-v5.0.md §4):
//    - only one primary overlay is open at a time;
//    - the payload is typed per overlay kind, so no `any` crosses the boundary;
//    - a dirty overlay refuses to close until the caller discards explicitly;
//    - the open overlay is reflected in the URL so a row is shareable
//      (`/?panel=signal&item=<id>`) without ever carrying a secret.
//
//  Rendering lives in the Dashboard shell: it maps `state.kind` to one Lazy
//  slideover/modal. This file owns state only — no Vue components.
// =============================================================================

export type OverlayKind = 'signal' | 'asset' | 'news' | 'control'

export type ControlCenterSection =
  | 'services'
  | 'sources'
  | 'ai'
  | 'alerts'
  | 'storage'
  | 'settings'
  | 'diagnostics'

export interface OverlayPayloads {
  /** Engine/informational event detail. `id` is the feed event key. */
  signal: { id: string }
  asset: { symbol: string }
  news: { id: string }
  control: { section?: ControlCenterSection }
}

export type OverlayState = {
  [K in OverlayKind]: { kind: K, payload: OverlayPayloads[K] }
}[OverlayKind]

export const OVERLAY_QUERY_KEY = 'panel'
export const OVERLAY_ITEM_KEY = 'item'
export const OVERLAY_SYMBOL_KEY = 'symbol'
export const OVERLAY_SECTION_KEY = 'section'

/** Read an overlay request out of a route query (deep link). Null when invalid. */
export function overlayFromQuery(query: Record<string, unknown>): OverlayState | null {
  const kind = typeof query[OVERLAY_QUERY_KEY] === 'string' ? query[OVERLAY_QUERY_KEY] : ''
  const str = (key: string) => (typeof query[key] === 'string' ? String(query[key]) : '')

  if (kind === 'signal' && str(OVERLAY_ITEM_KEY)) {
    return { kind: 'signal', payload: { id: str(OVERLAY_ITEM_KEY) } }
  }
  if (kind === 'asset' && str(OVERLAY_SYMBOL_KEY)) {
    return { kind: 'asset', payload: { symbol: str(OVERLAY_SYMBOL_KEY) } }
  }
  if (kind === 'news' && str(OVERLAY_ITEM_KEY)) {
    return { kind: 'news', payload: { id: str(OVERLAY_ITEM_KEY) } }
  }
  if (kind === 'control') {
    const section = str(OVERLAY_SECTION_KEY)
    const allowed: ControlCenterSection[] = ['services', 'sources', 'ai', 'alerts', 'storage', 'settings', 'diagnostics']
    return {
      kind: 'control',
      payload: { section: allowed.includes(section as ControlCenterSection) ? (section as ControlCenterSection) : 'services' }
    }
  }
  return null
}

/** The inverse of `overlayFromQuery` — the query patch for an overlay. */
export function overlayToQuery(state: OverlayState): Record<string, string> {
  switch (state.kind) {
    case 'signal':
      return { [OVERLAY_QUERY_KEY]: 'signal', [OVERLAY_ITEM_KEY]: state.payload.id }
    case 'asset':
      return { [OVERLAY_QUERY_KEY]: 'asset', [OVERLAY_SYMBOL_KEY]: state.payload.symbol }
    case 'news':
      return { [OVERLAY_QUERY_KEY]: 'news', [OVERLAY_ITEM_KEY]: state.payload.id }
    case 'control':
      return { [OVERLAY_QUERY_KEY]: 'control', [OVERLAY_SECTION_KEY]: state.payload.section ?? 'services' }
  }
}

export const useAppOverlay = () => {
  const state = useState<OverlayState | null>('app:overlay', () => null)
  const dirty = useState<boolean>('app:overlay:dirty', () => false)
  const pendingClose = useState<boolean>('app:overlay:pendingClose', () => false)

  const isOpen = computed(() => state.value !== null)
  const kind = computed(() => state.value?.kind ?? null)

  function open<K extends OverlayKind>(nextKind: K, payload: OverlayPayloads[K]) {
    // Closing a dirty overlay is a user decision; an unconditional `open` from a
    // table row would silently discard a half-filled form.
    if (dirty.value && state.value) {
      pendingClose.value = true
      return
    }
    state.value = { kind: nextKind, payload } as OverlayState
    dirty.value = false
  }

  /** Close by user action. Returns false when a dirty overlay blocks the close. */
  function requestClose(): boolean {
    if (dirty.value) {
      pendingClose.value = true
      return false
    }
    state.value = null
    return true
  }

  /** Close, discarding unsaved changes (after explicit confirmation). */
  function closeDiscard() {
    dirty.value = false
    pendingClose.value = false
    state.value = null
  }

  /** Keep the state but clear the dirty flag (a save just succeeded). */
  function markClean() {
    dirty.value = false
  }

  return {
    state,
    kind,
    isOpen,
    dirty,
    pendingClose,
    open,
    requestClose,
    closeDiscard,
    markClean
  }
}
