import type { Connection } from 'mongoose'
import { getMongoConnection } from '#server/utils/mongo'

/**
 * Connection for logger/audit dedicated MongoDB (MONGODB_LOG_URI).
 *
 * URI resolution wrapper - all connection handling (global cache,
 * concurrent dedup, fail-fast, cooldown, reconnect) resides in server/utils/mongo.ts.
 */
export async function getMongoLogConnection(uri?: string, dbName?: string): Promise<Connection | null> {
  const targetUri = (uri || process.env.MONGODB_LOG_URI || process.env.MONGODB_HISTORY_URI || '').trim()
  if (!targetUri) return null

  const targetDb = (dbName || process.env.MONGODB_LOG_DB_NAME || 'tm-hub-logs').trim()
  return getMongoConnection(targetUri, targetDb, 'logger', { maxPoolSize: 5 })
}
