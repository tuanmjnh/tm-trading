import type { Model } from 'mongoose'
import { HistorySchema, type IHistoryDocument } from './model'
import { getMongoLogConnection } from './mongodb'

export interface LogActor {
  id?: string
  _id?: string
  userId?: string
  name?: string
  username?: string
  email?: string
  avatar?: string
}

export interface LogChangeOptions {
  appId: string
  modelName: string
  docId: string
  action?: string
  actor?: LogActor | string
  ip?: string
  userAgent?: string
  source?: 'external_app' | 'tm-hub_internal'
  before?: any
  after?: any
  customChanges?: Record<string, { old: any, new: any }>
}

export class AuditService {
  private historyModel: Model<IHistoryDocument> | null = null

  /** Keys containing secrets (case-insensitive) - masked in all audit diffs. */
  private static readonly SENSITIVE_KEY_PATTERN = /SECRET|PRIVATE|API_KEY|PASSWORD|TOKEN|CREDENTIAL|_KEY$/i

  private redactValue(key: string, value: any): any {
    if (value === null || value === undefined) return value
    if (AuditService.SENSITIVE_KEY_PATTERN.test(key)) return '••••••••'
    return value
  }

  /**
   * Internal cleaner used by calculateDiff
   */
  clean(obj: any, customIgnoreKeys?: string[]) {
    if (!obj) return null
    const ignoreKeys = customIgnoreKeys || ['updatedAt', 'createdAt', 'lastLogin', 'history', '_id', '__v', 'password', 'password_hash']

    const raw = (obj && typeof obj.toObject === 'function')
      ? obj.toObject({ flattenMaps: true, virtuals: false, depopulate: true })
      : obj

    const json = JSON.stringify(raw, (_key, value) => {
      if (value instanceof Map || (value && typeof value === 'object' && value.constructor?.name === 'MongooseMap')) {
        return Object.fromEntries(value)
      }
      return value
    })

    const plain = JSON.parse(json)
    return Object.fromEntries(
      Object.entries(plain).filter(([key]) => !ignoreKeys.includes(key))
    )
  }

  /**
   * Calculates diff between two states
   */
  calculateDiff(oldData: any, newData: any): Record<string, { old: any, new: any }> | undefined {
    const before = this.clean(oldData)
    const after = this.clean(newData)

    if (!before && !after) return undefined

    const changes: Record<string, { old: any, new: any }> = {}
    const b = before || {}
    const a = after || {}
    const allKeys = new Set([...Object.keys(b), ...Object.keys(a)])

    for (const key of allKeys) {
      const valBefore = b[key]
      const valAfter = a[key]

      if (JSON.stringify(valBefore ?? null) !== JSON.stringify(valAfter ?? null)) {
        changes[key] = {
          old: this.redactValue(key, valBefore ?? null),
          new: this.redactValue(key, valAfter ?? null)
        }
      }
    }

    return Object.keys(changes).length > 0 ? changes : undefined
  }

  /**
   * Lazily retrieve the Mongoose model from the dedicated connection
   */
  async getModel(): Promise<Model<IHistoryDocument> | null> {
    try {
      const conn = await getMongoLogConnection()
      if (!conn) return null

      if (!conn.models.histories) {
        return conn.model<IHistoryDocument>('histories', HistorySchema)
      }
      return conn.models.histories as Model<IHistoryDocument>
    } catch {
      return null
    }
  }

  /**
   * Log a change safely and asynchronously
   */
  async logChange(options: LogChangeOptions): Promise<void> {
    const {
      appId,
      modelName,
      docId,
      actor,
      ip,
      userAgent,
      source = 'external_app',
      before,
      after,
      action = 'update',
      customChanges
    } = options

    try {
      let changes = customChanges
      if (changes) {
        // Defense-in-depth: mask secret values even when caller pre-computed diff.
        for (const k of Object.keys(changes)) {
          const entry = changes[k]!
          entry.old = this.redactValue(k, entry.old)
          entry.new = this.redactValue(k, entry.new)
        }
      } else if (action === 'create' || !before) {
        // New entity creation
      } else if (action === 'delete') {
        changes = undefined
      } else {
        changes = this.calculateDiff(before, after)
        if (!changes && action === 'update') {
          return // Skip logging if nothing changed
        }
      }

      let actorSnapshot = {
        _id: 'system',
        name: 'System',
        username: 'system',
        email: 'system@tm-hub.internal',
        avatar: ''
      }

      if (typeof actor === 'object' && actor) {
        actorSnapshot = {
          _id: actor._id || actor.id || actor.userId || 'system',
          name: actor.name || actor.username || 'User',
          username: actor.username || 'user',
          email: actor.email || '',
          avatar: actor.avatar || ''
        }
      } else if (typeof actor === 'string' && actor !== 'system') {
        actorSnapshot = {
          _id: actor,
          name: 'User',
          username: 'user',
          email: '',
          avatar: ''
        }
      }

      const logEntry = {
        appId,
        docId,
        modelName,
        action,
        by: actorSnapshot,
        source,
        ip: ip || undefined,
        userAgent: userAgent || undefined,
        at: Date.now(),
        changes: changes || undefined
      }

      const model = await this.getModel()
      if (model) {
        const historyDoc = new model(logEntry)
        await historyDoc.save()
      }
    } catch (error: any) {
      console.warn(`[AuditService] Failed to record audit log: ${error.message}`)
    }
  }

  /**
   * Read audit logs for an appId (optionally filtered by docId)
   */
  async getAuditLogs(appId: string, limit: number = 20, cursor?: number, docId?: string, actorId?: string) {
    try {
      const model = await this.getModel()
      if (!model) return []

      const query: any = { appId }
      if (docId) {
        query.docId = docId
      }
      if (cursor) {
        query.at = { $lt: cursor }
      }
      if (actorId) {
        // Scope 'own': only return logs created by this user (logEntry.by._id).
        query['by._id'] = actorId
      }

      return await model.find(query)
        .sort({ at: -1 })
        .limit(limit)
        .lean()
    } catch (error: any) {
      console.warn(`[AuditService] Failed to query audit logs: ${error.message}`)
      return []
    }
  }
}

export const auditService = new AuditService()
