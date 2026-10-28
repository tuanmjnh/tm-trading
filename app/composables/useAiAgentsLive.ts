import type { AiAgent, AiAgentAction } from '#shared/types/ai'

export interface LiveProposal {
  proposalId: string
  hypothesis: string
  changes?: unknown
  status: string
  createdAt?: string | number
}

// =============================================================================
//  useAiAgentsLive — realtime AI agent state + action ledger via SSE.
//
//  Subscribes to `/api/v1/ai-agents/stream` (cookie-auth, server pushes
//  on change). Exposes reactive `agents`, `actions`, `proposals`, and `connected`.
// =============================================================================

export function useAiAgentsLive() {
  const agents = ref<AiAgent[]>([])
  const actions = ref<AiAgentAction[]>([])
  const proposals = ref<LiveProposal[]>([])
  const connected = ref(false)
  const lastPushAt = ref<number | null>(null)

  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function start() {
    if (es || stopped) return
    es = new EventSource('/api/v1/ai-agents/stream')

    es.onopen = () => { connected.value = true }
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as {
          agents?: AiAgent[]
          actions?: AiAgentAction[]
          proposals?: LiveProposal[]
          ts?: number
        }
        if (Array.isArray(payload.agents)) agents.value = payload.agents
        if (Array.isArray(payload.actions)) actions.value = payload.actions
        if (Array.isArray(payload.proposals)) proposals.value = payload.proposals
        connected.value = true
        lastPushAt.value = Date.now()
      } catch {
        // Malformed frame — ignore
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

  return { agents, actions, proposals, connected, lastPushAt, start, stop }
}
