/** Phase E — Export Data types (docs/implementation_plan.md §E.2). */

export type ExportFormat = 'csv' | 'json' | 'xlsx'

export type ExportScope = 'page' | 'selected' | 'filtered' | 'all'

export type ExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ExportOptions {
  format: ExportFormat
  scope: ExportScope
  /** Column whitelist to export (default: all module fields) */
  fields?: string[]
  /** Used only for scope=filtered - simple eq filter */
  filters?: Record<string, string | number | boolean>
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>
  dateRange?: { from?: string; to?: string }
  filename?: string
  includeHeaders?: boolean
  encoding?: 'utf-8' | 'utf-16le'
  sheetName?: string
  /** Used only for scope=selected */
  ids?: string[]
  /** Used only for scope=page */
  limit?: number
  offset?: number
}

export interface ExportJob {
  id: string
  appId: string
  userId: string
  module: string
  status: ExportJobStatus
  format: ExportFormat
  scope: ExportScope
  options: ExportOptions
  totalRecords: number
  processedRecords: number
  fileUrl?: string
  fileSize?: number
  error?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  expiresAt: string
}

export interface ExportTemplate {
  id: string
  appId: string
  module: string
  name: string
  description?: string
  options: ExportOptions
  isDefault: boolean
  createdBy?: string
  createdAt: string
  updatedAt?: string
}

export interface ExportField {
  key: string
  label: string
}
