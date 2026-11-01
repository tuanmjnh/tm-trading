import { Readable } from 'node:stream'
import { sendStream } from 'h3'
import { requireOwnerId } from '~~/server/utils/owner'
import { loadOperationsView } from '~~/server/utils/operations'
import { OPERATIONS_PING_MS, OPERATIONS_POLL_MS, operationsSignature, sseFrame } from '~~/server/utils/operationsStream'

/**
 * GET /api/v1/operations/events — Server-Sent Events for the Operations view.
 *
 * The supervisor is a separate process, so this endpoint POLLS its state (and the
 * command inbox) on a short interval and emits a `snapshot` event only when the
 * fingerprint changes. On connect it always sends the current snapshot first, so
 * a reconnecting client needs no separate REST reconcile.
 *
 * `ping` comments keep proxies from cutting an idle stream. The stream is closed
 * when the client disconnects; no state is held per connection.
 */
export default defineEventHandler(async (event) => {
  requireOwnerId(event)

  const stream = new Readable({ read() {} })
  let closed = false
  let lastSignature: string | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  const stop = () => {
    if (closed) return
    closed = true
    if (pollTimer) clearInterval(pollTimer)
    if (pingTimer) clearInterval(pingTimer)
    pollTimer = null
    pingTimer = null
    stream.push(null)
  }

  const send = (frame: string) => {
    if (closed) return
    try {
      stream.push(frame)
    } catch {
      stop()
    }
  }

  const pushSnapshot = async (force = false) => {
    if (closed) return
    try {
      const view = await loadOperationsView(Date.now())
      const signature = operationsSignature(view)
      if (!force && signature === lastSignature) return
      lastSignature = signature
      send(sseFrame('snapshot', view, view?.at ?? Date.now()))
    } catch {
      // A read failure is not fatal: the next tick retries, and the client keeps
      // the last snapshot it saw rather than an error frame.
    }
  }

  await pushSnapshot(true)

  pollTimer = setInterval(() => { void pushSnapshot() }, OPERATIONS_POLL_MS)
  pingTimer = setInterval(() => send(`: ping ${Date.now()}\n\n`), OPERATIONS_PING_MS)

  // Clean up on client disconnect (and on any transport error).
  event.node.res.on('close', stop)
  event.node.res.on('error', stop)

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  return sendStream(event, stream)
})
