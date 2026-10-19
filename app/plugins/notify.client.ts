export default defineNuxtPlugin(() => {
  const auth = useAuth()
  const feed = useNotifyFeed()

  // U3 — the notification feed lifecycle belongs to the APP, not to whichever
  // component happens to call useNotify() first. Booting it here means it runs
  // once regardless of the page shown, and survives consumers that unmount.
  // Auth resolves in `middleware/auth.global.ts` (after plugins), so the
  // watcher — not the initial check — is the normal path.
  if (auth.user.value) {
    feed.fetchNotify()
  }

  watch(() => auth.user.value, (user) => {
    if (user) {
      feed.fetchNotify()
    } else {
      feed.notify.value = []
    }
  })
})
