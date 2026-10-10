import type {
  ReplayCreateInput,
  ReplayOrderInput,
  ReplayPlaceOrderResponse,
  ReplayReadResponse,
  ReplaySummary,
  ReplaySummaryResponse
} from '~~/types/replay'

// =============================================================================
//  Replay API (Nitro internal routes — /api/v1/replay/*, Phase 7R2).
//
//  read(id, cursor) is the ONLY way events come back: the server answers with
//  bars strictly AFTER the cursor, so the client can never observe the future
//  (D17). The page polls read() while mode === 'playing'.
// =============================================================================

export const useReplay = () => {
  async function create(input: ReplayCreateInput = {}): Promise<ReplaySummary> {
    const res = await $fetch<ReplaySummaryResponse>('/api/v1/replay/sessions', {
      method: 'POST',
      body: input
    })
    return res.data
  }

  async function read(id: string, cursor = 0): Promise<ReplayReadResponse['data']> {
    const res = await $fetch<ReplayReadResponse>(`/api/v1/replay/sessions/${id}`, {
      params: { cursor }
    })
    return res.data
  }

  async function play(id: string, speed?: number): Promise<ReplaySummary> {
    const res = await $fetch<ReplaySummaryResponse>(`/api/v1/replay/sessions/${id}/play`, {
      method: 'POST',
      body: speed === undefined ? {} : { speed }
    })
    return res.data
  }

  async function pause(id: string): Promise<ReplaySummary> {
    const res = await $fetch<ReplaySummaryResponse>(`/api/v1/replay/sessions/${id}/pause`, {
      method: 'POST',
      body: {}
    })
    return res.data
  }

  /** Manual advance — returns the session plus the events it just played. */
  async function step(id: string, candles = 1): Promise<ReplayReadResponse['data']> {
    const res = await $fetch<ReplayReadResponse>(`/api/v1/replay/sessions/${id}/step`, {
      method: 'POST',
      body: { candles }
    })
    return res.data
  }

  /**
   * Queue a ticket into the session's in-memory book — same intake as the
   * live POST /api/v1/orders (validateTicket + risk gate D7), answered with
   * the fresh order + summary. 400 replay_order_rejected carries the gate's
   * own code+message.
   */
  async function placeOrder(
    id: string,
    body: ReplayOrderInput
  ): Promise<ReplayPlaceOrderResponse['data']> {
    const res = await $fetch<ReplayPlaceOrderResponse>(`/api/v1/replay/sessions/${id}/orders`, {
      method: 'POST',
      body
    })
    return res.data
  }

  return { create, read, play, pause, step, placeOrder }
}
