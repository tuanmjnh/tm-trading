import type { ComputedRef, Ref } from 'vue'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'

export interface MobileActionChild {
  icon?: string
  label: string
  disabled?: boolean
  onSelect?: () => unknown
}

export interface MobileAction {
  icon: string
  label: string
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  disabled?: boolean
  visible?: boolean
  iconClass?: string
  /** The page's primary action (e.g. "Add") — rendered outside the overflow in both surfaces. */
  primary?: boolean
  /** Never rendered as an inline icon — always owned by the overflow surface. */
  overflow?: boolean
  /** Unread count badge rendered at the end of the action row. Hidden when 0/undefined. */
  badge?: number
  /** Sub-level actions (expandable row) - used for CSV/JSON export. */
  children?: MobileActionChild[]
  onSelect?: () => unknown
}

export interface MobileActionLayout {
  /** Actions rendered directly (icon buttons in the bar / navbar). */
  inline: MobileAction[]
  /** Actions moved to the overflow surface (⋯ dropdown / Actions sheet). */
  overflow: MobileAction[]
}

/** Actions with subtrees (CSV/JSON export) can never be a single icon button. */
function cannotInline(action: MobileAction) {
  return action.overflow === true || Boolean(action.children?.length)
}

/**
 * Split registered actions for the bar surfaces: only primary actions render as
 * inline icon buttons — everything else (and any action with a subtree) is
 * owned by the ⋯ overflow, so the bar never duplicates the dropdown contents.
 * Order is registration order, so pages control priority by the order they list.
 */
export function mobileActionLayout(actions: MobileAction[], maxInline = 3): MobileActionLayout {
  const inline: MobileAction[] = []
  const overflow: MobileAction[] = []
  for (const action of actions.filter(a => a.visible !== false)) {
    if (action.primary === true && !cannotInline(action) && inline.length < maxInline) inline.push(action)
    else overflow.push(action)
  }
  return { inline, overflow }
}

export interface MobileInfo {
  count?: number
  hasMore?: boolean
  loading?: boolean
  /** Custom text shown in the bottom bar info zone (right of the Actions button). */
  text?: string
}

interface MobileBarStore {
  version: Ref<number>
  actions: ComputedRef<MobileAction[]> | null
  info: ComputedRef<MobileInfo | null> | null
}

function getStore(): MobileBarStore {
  const app = useNuxtApp() as unknown as { __mobileBarStore?: MobileBarStore }
  app.__mobileBarStore ??= { version: ref(0), actions: null, info: null }
  return app.__mobileBarStore
}

export function useMobileBar() {
  const store = getStore()

  function registerActions(source: ComputedRef<MobileAction[]>) {
    store.actions = source
    store.version.value++
    onScopeDispose(() => {
      if (store.actions === source) {
        store.actions = null
        store.version.value++
      }
    })
  }

  function registerInfo(source: ComputedRef<MobileInfo | null>) {
    store.info = source
    store.version.value++
    onScopeDispose(() => {
      if (store.info === source) {
        store.info = null
        store.version.value++
      }
    })
  }

  return { store, registerActions, registerInfo }
}

/** Map desktop header actions to mobile actions (retain children for ActionsSheet expansion). */
export function headerActionsToMobile(actions: HeaderAction[]): MobileAction[] {
  return actions
    .filter(a => a.visible !== false)
    .map(a => ({
      icon: a.icon,
      label: a.label,
      color: a.color,
      disabled: a.disabled,
      onSelect: a.onSelect,
      children: a.children?.length
        ? a.children.map(c => ({ icon: c.icon, label: c.label, disabled: c.disabled, onSelect: c.onSelect }))
        : undefined
    }))
}
