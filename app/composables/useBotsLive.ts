import type { BotInstance } from '#shared/types/bots'

/**
 * Live signal row (method-attributed native signal) — mirrors the fields the
 * ticker reads. Kept here because the signals collection is engine-owned and
 * the UI only needs these display fields.
 */
export interface LiveBotSignal {
  signalKey: string
  type: string
  symbol: string
  tf: string
  method: string
  ts: number
  price: number | null
}

// =============================================================================
//  useBotsLive — realtime bot instances + signals via SSE.
//
//  Subscribes to `/api/v1/bots/instances/stream` (cookie-auth, server pushes
//  on change). Falls back to the caller's own polling when SSE is unavailable
//  (proxies, older Electron). Exposes `connected` so the UI can badge a live
//  indicator honestly.
// =============================================================================

export function useBotsLive() {
  const instances = ref<BotInstance[]>([])
  const signals = ref<LiveBotSignal[]>([])
  const connected = ref(false)
  const lastPushAt = ref<number | null>(null)

  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function start() {
    if (es || stopped) return
    es = new EventSource('/api/v1/bots/instances/stream')

    es.onopen = () => { connected.value = true }
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { instances?: BotInstance[], signals?: LiveBotSignal[], ts?: number }
        if (Array.isArray(payload.instances)) instances.value = payload.instances
        if (Array.isArray(payload.signals)) signals.value = payload.signals
        connected.value = true
        lastPushAt.value = Date.now()
      } catch {
        // Malformed frame — ignore, the next one is a full snapshot anyway.
      }
    }
    es.onerror = () => {
      connected.value = false
      es?.close()
      es = null
      if (!stopped) reconnectTimer = setTimeout(() => start(), 3000)
    }
  }

  function stop() {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    es?.close()
    es = null
    connected.value = false
  }

  onUnmounted(stop)

  return { instances, signals, connected, lastPushAt, start, stop }
}
