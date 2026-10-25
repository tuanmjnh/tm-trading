import { readBody } from 'h3'
import {
  aiProviderHttpError,
  findExistingAiConnections,
  importAiConnections,
  parseAiProviderImport,
} from '../../../../utils/aiProviders'

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  }
  let payload = body.data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'data is not valid JSON' })
    }
  }
  const defaultModel = typeof body.defaultModel === 'string' ? body.defaultModel.trim() : ''
  const commit = body.commit === true
  const overwrite = body.overwrite === true

  try {
    const parsed = await parseAiProviderImport(payload, defaultModel)
    // Preview only: look up which rows already exist so the user sees, before
    // committing, what a non-overwrite import would skip.
    const existing = commit ? [] : await findExistingAiConnections(ownerId, parsed.rows)
    const existingSet = new Set(existing)
    const previewRows = parsed.rows.map((row: any) => ({
      provider: row.provider,
      name: row.name,
      model: row.model,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      hasKey: Boolean(row.apiKey),
      duplicate: existingSet.has(`${row.provider}:${row.name}`),
    }))
    const duplicates = previewRows.filter((r: any) => r.duplicate).length
    const preview = {
      preview: !commit,
      total: parsed.rows.length + parsed.errors.length,
      valid: parsed.rows.length,
      invalid: parsed.errors.length,
      duplicates,
      willImport: overwrite ? parsed.rows.length : parsed.rows.length - duplicates,
      rows: previewRows,
      errors: parsed.errors,
    }
    if (!commit) return { success: true, data: preview }
    if (parsed.rows.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'error.ai_import_invalid',
        message: 'No valid connections to import',
        data: { errors: parsed.errors },
      })
    }
    const result = await importAiConnections(ownerId, parsed.rows, overwrite)
    return { success: true, data: { ...preview, preview: false, ...result } }
  } catch (err) {
    throw aiProviderHttpError(err)
  }
})
