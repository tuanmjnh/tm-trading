// =============================================================================
//  TM TRADING — /ws/market WebSocket endpoint (S3, roadmap §17).
//
//  Thin crossws adapter: all protocol logic lives in server/utils/market-socket
//  (unit-tested) and the plane singleton in server/utils/market-plane.
//  Requires `nitro.experimental.websocket: true` in nuxt.config.ts.
//
//  Lifecycle: open -> hello snapshot -> subscribe bus topics -> stream events;
//  close/error -> detach (idempotent). The plane (and its Binance feed) starts
//  with the FIRST client and keeps running for later reconnects.
// =============================================================================

import { defineWebSocketHandler } from 'h3'
import { getMarketPlane } from '../../utils/market-plane'
import { attachClient, buildHello, handleClientMessage, type SocketClient } from '../../utils/market-socket'

// context key holding this peer's bus unsubscriber (crossws Peer.context)
const DETACH = '__marketSocketDetach'

interface PeerWithClient {
  context: Record<string, unknown>
  send(data: string): unknown
  close(code?: number, reason?: string): void
}

export default defineWebSocketHandler({
  async open(peer) {
    const p = peer as unknown as PeerWithClient
    try {
      const plane = await getMarketPlane()
      p.send(JSON.stringify(buildHello(plane)))
      const client: SocketClient = attachClient(plane, (data) => p.send(data))
      p.context[DETACH] = client.detach
      plane.start() // idempotent: first client starts the feed
    } catch (err) {
      try {
        p.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : 'plane-failed' }))
      } catch { /* socket already gone */ }
      try { p.close(1011, 'market-plane-failed') } catch { /* best effort */ }
    }
  },

  async message(peer, message) {
    const p = peer as unknown as PeerWithClient
    try {
      const plane = await getMarketPlane()
      const reply = handleClientMessage(plane, message)
      if (reply !== null) p.send(reply)
    } catch (err) {
      try {
        p.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : 'plane-failed' }))
      } catch { /* socket already gone */ }
    }
  },

  close(peer) {
    const detach = (peer as unknown as PeerWithClient).context[DETACH]
    if (typeof detach === 'function') (detach as () => void)()
  },

  error(peer) {
    const detach = (peer as unknown as PeerWithClient).context[DETACH]
    if (typeof detach === 'function') (detach as () => void)()
  }
})
