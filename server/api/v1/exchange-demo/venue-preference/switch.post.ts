import { readBody } from 'h3'
import { requestVenueSwitch } from '../../../../utils/exchangeVenues'
import { exchangeDemoHttpError } from '../../../../utils/exchangeDemo'

// POST /api/v1/exchange-demo/venue-preference/switch — audited "switch venue for
// NEXT session" request (§64.5B). This NEVER changes a running session's
// execution venue; it only stages a target that a NEW session may apply after
// the flat/no-pending safety gate (failover.canSwitchForNextSession). The action
// is recorded for audit. Body: { targetVenue, reason?, accountId? }.
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = await readBody(event).catch(() => null) as { targetVenue?: string, reason?: string, accountId?: string } | null
  const targetVenue = String(body?.targetVenue ?? '').trim()
  if (!targetVenue) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'targetVenue is required' })
  try {
    const data = await requestVenueSwitch(ownerId, { targetVenue, reason: body?.reason ?? null, accountId: body?.accountId ?? 'default' })
    return {
      success: true,
      data,
      meta: { appliesTo: 'next-session-only', activeSessionsUnchanged: true, requiresFlatForSimpleSwitch: true },
    }
  } catch (error) {
    throw exchangeDemoHttpError(error)
  }
})
