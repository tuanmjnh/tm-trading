import type { OperationsView } from '#shared/types/operations'
import { parseOperationsSseFrame } from '#shared/utils/operationsStream'

// =============================================================================
//  useOperationsEvents — consume the Operations SSE stream (V4.2 §17.7).
//
//  `EventSource` cannot send an Authorization header, and this app authorises on
//  a Bearer token, so the stream is consumed with `fetch` + a ReadableStream
//  reader instead. The server sends the current snapshot on connect, so a
//  reconnect needs no separate REST reconcile.
//
//  Reconnect uses bounded exponential backoff (1 s → 30 s). While the stream is
//  down, `connected` is false and the caller falls back to polling.
// =============================================================================

const MAX_BACKOFF_MS = 30_000
const FIRST_BACKOFF_MS = 1_000

export interface UseOperationsEventsOptions {
  onSnapshot: (view: OperationsView) => void
  onError?: () => void
}

export const useOperationsEvents = (options: UseOperationsEventsOptions) => {
  const auth = useAuth()
  const connected = ref(false)

  let controller: AbortController | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0
  let closed = false

  function scheduleReconnect() {
    if (closed) return
    attempt += 1
    const delay = Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** Math.min(attempt - 1, 5))
    retryTimer = setTimeout(() => { void connect() }, delay)
  }

  async function connect() {
    if (closed) return
    controller = new AbortController()
    try {
      const token = auth.accessToken.value
      const response = await fetch('/api/v1/operations/events', {
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error(`operations stream ${response.status}`)

      connected.value = true
      attempt = 0

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          if (!frame.trim()) continue
          const parsed = parseOperationsSseFrame(frame)
          if (parsed.event !== 'snapshot' || !parsed.data) continue
          try {
            options.onSnapshot(JSON.parse(parsed.data) as OperationsView)
          } catch {
            // A malformed frame is ignored; the next snapshot replaces the view.
          }
        }
      }
      throw new Error('operations stream ended')
    } catch {
      if (closed) return
      connected.value = false
      options.onError?.()
      scheduleReconnect()
    }
  }

  function close() {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    controller?.abort()
    controller = null
    connected.value = false
  }

  onMounted(() => { void connect() })
  onBeforeUnmount(close)

  return { connected, close, reconnect: () => { close(); closed = false; void connect() } }
}
