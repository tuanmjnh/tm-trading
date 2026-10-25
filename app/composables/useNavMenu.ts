import type { NavigationMenuItem } from '@nuxt/ui'
import type { RouteTreeNode } from '#shared/types/rbac'

export const useNavMenu = () => {
  const { t } = useI18n()
  const auth = useAuth()
  const { hubFetch } = useHub()

  const allowedRoutes = useState<RouteTreeNode[]>('nav:allowedRoutes', () => [])

  async function fetchRoutes(force = false, targetAppId?: string) {
    // Explicit `targetAppId` previews another app's catalog; the normal path
    // shares one deduped loader with the middleware (see utils/navRoutes.ts).
    if (!targetAppId) return loadAllowedRoutes({ force })

    if (allowedRoutes.value.length > 0 && !force) return allowedRoutes.value
    if (!auth.isAuthenticated.value) return []

    try {
      const { data } = await hubFetch<{ success: boolean, data: RouteTreeNode[] }>(
        `/api/v1/auth/routes?appId=${encodeURIComponent(targetAppId)}`
      )
      allowedRoutes.value = data || []
      writeNavCache(allowedRoutes.value)
    } catch {
      allowedRoutes.value = []
    }
    return allowedRoutes.value
  }

  function clearRoutes() {
    allowedRoutes.value = []
  }

  /**
   * Translate a route label (nav i18n key).
   * Tries `nav.<label>` first, then the label as a full i18n key,
   * falling back to the raw label (or name) when no translation exists.
   */
  const translateRouteLabel = (label?: string | null, name?: string | null): string => {
    const raw = String(label || name || '')
    if (!raw) return ''
    const candidates = raw.startsWith('nav.') ? [raw] : [`nav.${raw}`, raw]
    for (const key of candidates) {
      const translated = t(key)
      if (translated && translated !== key) return translated
    }
    return raw
  }

  const translateLabel = (node: RouteTreeNode): string => translateRouteLabel(node.label, node.name)

  function mapRouteToNav(node: RouteTreeNode, open: Ref<boolean>): NavigationMenuItem {
    const label = translateLabel(node)

    if (node.children?.length) {
      return {
        label,
        icon: node.icon || 'i-lucide-folder',
        defaultOpen: true,
        type: 'trigger',
        children: node.children.map((child: RouteTreeNode) => mapRouteToNav(child, open))
      }
    }

    return {
      label,
      icon: node.icon || 'i-lucide-circle',
      to: node.path,
      onSelect: () => { open.value = false }
    }
  }

  function buildNavItems(open: Ref<boolean>, collapsed = false): NavigationMenuItem[] {
    const router = useRouter()
    // Hub's route tree may still advertise pages whose local files do not exist.
    // Only surface nodes that resolve to an actual local page so the menu never
    // links to a 404, and drop hidden routes (is_visible:false, §58.2) together
    // with their subtree. Groups survive only when a descendant survives.
    const localPaths = new Set(router.getRoutes().map(r => r.path.replace(/\/+$/, '') || '/'))
    const hidden = new Set(['settings'])
    const nodes = selectNavRoutes(allowedRoutes.value, {
      hasLocalPage: createHasLocalPage(localPaths),
      hiddenNames: hidden
    })
    const items = nodes.map((node: RouteTreeNode) => mapRouteToNav(node, open))
    // Collapsed mode renders group children as a flat popover link list, so
    // depth-3 groups (e.g. Data Research › Data › Data sets) must be dissolved
    // or their descendants become unreachable.
    if (!collapsed) return items
    return items.map(item =>
      (item.children?.length ? { ...item, children: flattenNavGroups<NavigationMenuItem>(item.children) } : item))
  }

  return {
    allowedRoutes: readonly(allowedRoutes),
    fetchRoutes,
    clearRoutes,
    buildNavItems,
    translateRouteLabel
  }
}
