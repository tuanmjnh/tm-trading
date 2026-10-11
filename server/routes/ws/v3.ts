// =============================================================================
//  TM TRADING — /ws/v3 WebSocket endpoint (roadmap V3 §31).
//
//  Channel-subscription transport: the client sends a §31.1 subscribe frame and
//  receives §31.2 sequence envelopes for the channels it asked for. All protocol
//  logic lives in server/utils/realtime-hub (unit-tested against a fake plane);
//  this file only wires a crossws peer to the hub singleton.
//
//  Requires `nitro.experimental.websocket: true` in nuxt.config.ts.
//  Lifecycle: open -> welcome -> hub.open(this peer); message -> client.message;
//  close/error -> client.close() (the last peer releases the bus). The market
//  plane (and its Binance feed) starts with the FIRST client and stays up for
//  reconnects — same ownership model as the legacy /ws/market.
// =============================================================================

import { defineWebSocketHandler } from 'h3'
import { getRealtimeHub } from '../../utils/realtime-hub'
import type { HubClient } from '../../utils/realtime-hub'

// context key holding this peer's hub client (crossws Peer.context)
const CLIENT = '__realtimeV3Client'

interface PeerWithClient {
  context: Record<string, unknown>
  send(data: string): unknown
  close(code?: number, reason?: string): void
}

const sendError = (p: PeerWithClient, error: string): void => {
  try { p.send(JSON.stringify({ type: 'error', error })) } catch { /* socket already gone */ }
}

export default defineWebSocketHandler({
  async open(peer) {
    const p = peer as unknown as PeerWithClient
    try {
      const hub = await getRealtimeHub()
      const client: HubClient = hub.open({ send: (data) => p.send(data) })
      p.context[CLIENT] = client
      p.send(JSON.stringify({ type: 'welcome', protocol: 3 }))
    } catch (err) {
      sendError(p, err instanceof Error ? err.message : 'realtime-failed')
      try { p.close(1011, 'realtime-hub-failed') } catch { /* best effort */ }
    }
  },

  async message(peer, message) {
    const p = peer as unknown as PeerWithClient
    const client = p.context[CLIENT] as HubClient | undefined
    if (!client) { sendError(p, 'not-ready'); return }
    try {
      const reply = client.message(message)
      if (reply !== null) p.send(reply)
    } catch (err) {
      sendError(p, err instanceof Error ? err.message : 'realtime-failed')
    }
  },

  close(peer) {
    const client = (peer as unknown as PeerWithClient).context[CLIENT] as HubClient | undefined
    client?.close()
  },

  error(peer) {
    const client = (peer as unknown as PeerWithClient).context[CLIENT] as HubClient | undefined
    client?.close()
  }
})
