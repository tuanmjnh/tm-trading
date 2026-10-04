import type { Connection } from 'mongoose'
import { getMongoConnection } from '#server/utils/mongo'

/**
 * Connection for logger/audit dedicated MongoDB (MONGODB_LOG_URI).
 *
 * URI resolution wrapper - all connection handling (global cache,
 * concurrent dedup, fail-fast, cooldown, reconnect) resides in server/utils/mongo.ts.
 */
export async function getMongoLogConnection(uri?: string, dbName: string = 'tm-hub-logs'): Promise<Connection | null> {
  const targetUri = (uri || process.env.MONGODB_LOG_URI || process.env.MONGODB_HISTORY_URI || '').trim()
  if (!targetUri) return null

  return getMongoConnection(targetUri, dbName || 'tm-hub-logs', 'logger', { maxPoolSize: 5 })
}
