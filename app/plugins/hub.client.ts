// =============================================================================
//  P0-3 — One HubClient, one permissions watcher.
//
//  `useHub()` is called from ~11 sites (nav, notifications, every admin resource).
//  It used to construct a fresh `HubClient` and install a fresh
//  `watch(permissions)` on every call, so a single permission change was applied
//  once per caller and the watchers were tied to whichever component happened to
//  call first — cleaning up while the client lived on.
//
//  The client itself is now a client-only singleton (see `useHub()`), and this
//  plugin owns the one watcher for the app's lifetime.
// =============================================================================
export default defineNuxtPlugin(() => {
  const auth = useAuth()
  const { client } = useHub()

  const seed = () => {
    const perms = auth.user.value?.permissions
    if (perms?.length) client.setPermissions([...perms])
  }

  seed()
  watch(() => auth.user.value?.permissions, seed)
})
