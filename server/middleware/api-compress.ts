import type { H3Event } from 'h3'
import { gzipSync } from 'node:zlib'

/**
 * Response compression for JSON API payloads.
 *
 * Nitro's node-server preset does not compress dynamic responses, so a heavy
 * read endpoint (the multi-vendor instrument universe scan especially) ships
 * its whole JSON body over the wire — 1.9 MB uncompressed for ~8k rows.
 * Every dashboard read is JSON, so gzip is a straight win with no behaviour
 * change: headers + body encoding only.
 *
 * Compacts hard on purpose — compression must never alter a response:
 * - GET/HEAD only, and only for `/api/*`.
 * - Single-shot string/Buffer bodies only (streams pass through untouched).
 * - 200 only, no pre-existing `Content-Encoding`, headers not yet flushed.
 * - Anything below `MIN_BYTES` is left alone (not worth the CPU/headers).
 */

const MIN_BYTES = 1024

function clientAcceptsGzip(event: H3Event): boolean {
  const enc = getHeader(event, 'accept-encoding') || ''
  return /\bgzip\b/i.test(enc)
}

export default defineEventHandler((event) => {
  const path = (event.path || '').split('?')[0] || ''
  if (!path.startsWith('/api/')) return

  const method = getMethod(event)
  if (method !== 'GET' && method !== 'HEAD') return
  if (!clientAcceptsGzip(event)) return

  const res = event.node.res
  type EndFn = (chunk?: unknown, encoding?: unknown, callback?: unknown) => unknown
  const originalEnd = res.end as unknown as EndFn

  const patchedEnd: EndFn = function patchedEnd(chunk, encoding, callback) {
    try {
      const raw = typeof chunk === 'string' || Buffer.isBuffer(chunk) ? chunk : null
      const compressible = !!raw
        && res.statusCode === 200
        && !res.headersSent
        && !getHeader(event, 'content-encoding')

      if (compressible) {
        const body: Buffer = typeof raw === 'string' ? Buffer.from(raw, 'utf-8') : (raw as Buffer)
        if (body.byteLength >= MIN_BYTES) {
          const gz = gzipSync(body)
          res.setHeader('Content-Encoding', 'gzip')
          res.setHeader('Content-Length', String(gz.byteLength))
          appendHeader(event, 'Vary', 'Accept-Encoding')
          return originalEnd.call(res, gz)
        }
      }
    } catch {
      // Never let compression break a response: fall through uncompressed.
    }
    return originalEnd.call(res, chunk, encoding, callback)
  }

  res.end = patchedEnd as typeof res.end
})
