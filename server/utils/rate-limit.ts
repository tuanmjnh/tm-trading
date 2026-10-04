/**
 * In-memory sliding-window rate limiter (§13 API Security — brute-force protection).
 *
 * In-memory rate limiter fallback when Redis is unconfigured.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 20_000

function sweep(now: number): void {
  if (buckets.size <= MAX_KEYS) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  // Memory cap reached -> evict oldest bucket to prevent memory bloat.
  if (buckets.size > MAX_KEYS) {
    const excess = buckets.size - MAX_KEYS
    let i = 0
    for (const key of buckets.keys()) {
      buckets.delete(key)
      if (++i >= excess) break
    }
  }
}

/** Check rate limit without incrementing count. */
export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) return { allowed: true, retryAfterSec: 0 }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  return { allowed: true, retryAfterSec: 0 }
}

/** Increment failure count on failed attempts. */
export function hitRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  sweep(now)

  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count++
}

/** Clear failure count on successful authentication. */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}
