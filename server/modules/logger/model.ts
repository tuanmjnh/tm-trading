import mongoose from 'mongoose'

export interface IHistoryDocument extends mongoose.Document {
  appId: string
  docId: string
  modelName: string
  action: string
  by: {
    _id: string
    name?: string
    username?: string
    email?: string
    avatar?: string
  }
  source: 'external_app' | 'tm-hub_internal'
  ip?: string
  userAgent?: string
  at: number
  changes?: Record<string, { old: any, new: any }>
}

export const HistorySchema = new mongoose.Schema<IHistoryDocument>({
  appId: { type: String, required: true, index: true },
  docId: { type: String, required: true, index: true },
  modelName: { type: String, required: true, index: true },
  action: { type: String, required: true, index: true },
  by: {
    _id: { type: String, required: true },
    name: String,
    username: String,
    email: String,
    avatar: String
  },
  source: { type: String, enum: ['external_app', 'tm-hub_internal'], default: 'external_app', index: true },
  ip: { type: String },
  userAgent: { type: String },
  at: { type: Number, required: true, index: true },
  changes: { type: mongoose.Schema.Types.Mixed }
}, {
  timestamps: { currentTime: () => Date.now() },
  collection: 'histories'
})

HistorySchema.index({ appId: 1, at: -1 })
HistorySchema.index({ appId: 1, docId: 1, at: -1 })
HistorySchema.index({ appId: 1, action: 1, at: -1 })
HistorySchema.index({ 'by._id': 1 })
