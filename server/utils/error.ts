import { createError } from 'h3'

/**
 * Error convention (aligned with tm-tools):
 * - `statusMessage` = i18n key (e.g. `error.invalidCredentials`) — never free-form text
 * - `message` = human-readable English text (logs / fallback)
 * - Frontend resolves display text via `getErrorMessage(err, t)`
 */

/**
 * Throw safe DB/Supabase error (does not expose raw database error):
 * - log full original message server-side with `context` (source file)
 * - response contains only generic message ('Internal server error' / 'Invalid request')
 */
export function throwDbError(
  error: unknown,
  context: string,
  statusCode: number = 500,
  statusMessage: string = 'error.serverError'
): never {
  let raw = 'unknown error'
  if (error instanceof Error) raw = error.message
  else if (error && typeof error === 'object' && 'message' in error) raw = String((error as { message: unknown }).message)
  else if (error) raw = String(error)

  console.error(`[DB_ERROR] ${context}: ${raw}`)

  throw createError({
    statusCode,
    statusMessage,
    message: statusCode >= 500 ? 'Internal server error' : 'Invalid request'
  })
}

export function handleApiError(error: unknown, statusMessage = 'error.serverError') {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof (error as { statusCode: unknown }).statusCode === 'number') {
    throw error
  }

  // Do not echo raw error message to client - log server-side, return generic message.
  console.error('[API_ERROR]', error instanceof Error ? error.message : String(error))

  throw createError({
    statusCode: 500,
    statusMessage,
    message: 'Internal server error'
  })
}

export function apiError(statusCode: number, statusMessage: string, message: string) {
  return createError({ statusCode, statusMessage, message })
}
