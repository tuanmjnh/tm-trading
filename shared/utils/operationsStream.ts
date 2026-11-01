// =============================================================================
//  Operations SSE frame parsing (V4.2 §17.7).
//
//  A value (not a type) so it lives in `shared/utils`, next to the other pure
//  helpers the app and the tests share. `EventSource` cannot send an
//  Authorization header, so the Operations stream is read with `fetch` and the
//  frames are decoded here.
// =============================================================================

export interface OperationsSseFrame {
  event: string
  data: string
  id: string | null
}

/**
 * Decode one Server-Sent Event frame.
 *
 * Rules from the SSE spec that matter here: a leading `:` line is a comment
 * (the keepalive), `data:` lines concatenate with a newline, and an absent
 * `event:` defaults to `message`.
 */
export function parseOperationsSseFrame(frame: string): OperationsSseFrame {
  let event = 'message'
  let id: string | null = null
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    else if (line.startsWith('id:')) id = line.slice(3).trim()
  }
  return { event, data: data.join('\n'), id }
}
