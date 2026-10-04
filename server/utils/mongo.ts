import mongoose, { type Connection } from 'mongoose'

/**
 * Reusable MongoDB connection pool for all modules.
 *
 * Features:
 * - Cache connection on `globalThis` by `name` across HMR/dev reload,
 *   modules share named pools.
 * - Dedup: concurrent requests share ONE connection promise.
 * - Fail-fast: `bufferCommands: false` + short timeout + 30s failure cooldown
 *   -> requests never hang when Mongo is not ready.
 * - URI change automatically closes old connection and reconnects.
 * - Post-connection errors clear cache for reconnect on next invocation
    (after cooldown period).
 *
 * Usage (auto-import trong server/):
 *   const conn = await getMongoConnection(process.env.MONGODB_LOG_URI, 'tm-hub-logs', 'logger')
 *   if (!conn) return null // Mongo not configured or not ready (fail-soft)
 *
 *   // Shutdown:
 *   await closeMongoConnection() // close all
 */

interface MongoEntry {
  conn: Connection | null
  uri: string | null
  promise: Promise<Connection | null> | null
  lastAttempt: number
}

interface GlobalMongoRegistry {
  __mongoRegistry?: Record<string, MongoEntry>
}

function registry(): Record<string, MongoEntry> {
  const g = globalThis as unknown as GlobalMongoRegistry
  if (!g.__mongoRegistry) g.__mongoRegistry = {}
  return g.__mongoRegistry
}

export interface MongoConnectionOptions {
  /** Serverless recommended pool size (1-5). Default: 2. */
  maxPoolSize?: number
  serverSelectionTimeoutMS?: number
  socketTimeoutMS?: number
  connectTimeoutMS?: number
  heartbeatFrequencyMS?: number
  authSource?: string
}

/** Cooldown period of 30s after failed connection attempt (fail-fast). */
const COOLDOWN_MS = 30_000

/**
 * Get shared MongoDB connection by `name`.
 *
 * @param uri    Connection string; empty/undefined returns null (fail-soft).
 * @param dbName Database name.
 * @param name   Connection pool name identifier.
 * @returns Ready connection, or null if unconfigured/unreachable.
 */
export async function getMongoConnection(
  uri: string | undefined | null,
  dbName: string,
  name = 'default',
  options: MongoConnectionOptions = {}
): Promise<Connection | null> {
  const targetUri = (uri || '').trim()
  if (!targetUri) return null

  const entries = registry()
  if (!entries[name]) {
    entries[name] = { conn: null, uri: targetUri, promise: null, lastAttempt: 0 }
  }

  const entry = entries[name]

  // URI changed -> close old connection and reconnect from scratch.
  if (entry.uri !== targetUri) {
    if (entry.conn) await entry.conn.close().catch(() => {})
    entry.conn = null
    entry.promise = null
    entry.lastAttempt = 0
    entry.uri = targetUri
  }

  // Already open -> reuse.
  if (entry.conn && entry.conn.readyState === 1) return entry.conn

  // Connecting concurrently -> await shared promise.
  if (entry.promise) return entry.promise

  // In cooldown period -> fail fast rather than retrying immediately.
  if (entry.lastAttempt && Date.now() - entry.lastAttempt < COOLDOWN_MS) return null
  entry.lastAttempt = Date.now()

  entry.promise = (async (): Promise<Connection | null> => {
    try {
      const conn = mongoose.createConnection(targetUri, {
        dbName,
        // Do not buffer commands: fail immediately if Mongo is unavailable.
        bufferCommands: false,
        maxPoolSize: options.maxPoolSize ?? 2,
        serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 5000,
        socketTimeoutMS: options.socketTimeoutMS ?? 15000,
        connectTimeoutMS: options.connectTimeoutMS ?? 10000,
        heartbeatFrequencyMS: options.heartbeatFrequencyMS ?? 10000,
        retryWrites: true,
        authSource: options.authSource ?? 'admin'
      })

      await conn.asPromise()

      conn.on('error', (err: Error) => {
        console.warn(`[Mongo:${name}] connection error: ${err.message}`)
        entry.conn = null
      })
      conn.on('disconnected', () => {
        entry.conn = null
      })

      entry.conn = conn
      console.log(`[Mongo:${name}] connected → db "${dbName}"`)
      return conn
    } catch (error: any) {
      console.warn(`[Mongo:${name}] connect failed: ${error?.message}`)
      entry.conn = null
      return null
    } finally {
      entry.promise = null
    }
  })()

  return entry.promise
}

/**
 * Close connection by `name`; omit `name` to close all (used during shutdown).
 */
export async function closeMongoConnection(name?: string): Promise<void> {
  const entries = registry()
  const names = name ? [name] : Object.keys(entries)
  for (const key of names) {
    const entry = entries[key]
    if (!entry) continue
    try {
      if (entry.conn && entry.conn.readyState !== 0) {
        await entry.conn.close()
      }
    } catch {
      // Ignore close errors during shutdown.
    }
    entry.conn = null
    entry.promise = null
    entry.lastAttempt = 0
    if (!name) delete entries[key]
  }
}
