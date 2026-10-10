// notify/service.mjs
// Runtime glue between the pure Notification Router and the real world:
// resolves transport sinks + the `notification_logs` model lazily and calls
// `dispatch`. This is the ONLY notify/ file allowed to touch services/.
//
// Existing infrastructure is PRESERVED (§25): the Telegram sink delegates to
// the proven services/telegram.mjs (no token -> returns false, the attempt is
// recorded as a failed delivery — never a silent success). Web Push / Electron
// sinks can be injected by whoever hosts them; unconfigured channels are
// recorded as `{ ok: false, error: 'sink not configured' }`, never faked.
import { dispatch } from './send.mjs'
import { sendTelegram } from '../services/telegram.mjs'

/** Telegram sink — formats the §25 event into one message. */
export async function telegramSink(ctx) {
  const title = ctx.title ? `🔔 ${ctx.title}` : '🔔'
  return sendTelegram([title, ctx.body].filter(Boolean).join('\n'), '[notify]')
}

export const DEFAULT_SINKS = Object.freeze({ telegram: telegramSink })

async function defaultGetLogModel() {
  const { getNotificationLog } = await import('../services/store.mjs')
  return getNotificationLog()
}

/**
 * Route + deliver + audit-log one §25 event. Never throws (fail-soft, D33).
 *
 * @param {object} event router event ({preset?, kind?, priority?, title?, body?, symbol?, at?})
 * @param {{sinks?:object, getLogModel?:()=>Promise<object|null>, dedupeWindowMs?:number, now?:()=>number, log?:object}} [opts]
 */
export async function notify(event = {}, { sinks = DEFAULT_SINKS, getLogModel = defaultGetLogModel, dedupeWindowMs = 0, now = Date.now, log = console } = {}) {
  let logModel = null
  try {
    logModel = await getLogModel()
  } catch (e) {
    if (log && log.warn) log.warn(`[notify] log model unavailable: ${e?.message || e}`)
  }
  const at = Number.isFinite(Number(event.at)) ? Number(event.at) : now()
  return dispatch({ ...event, at }, { sinks, logModel, dedupeWindowMs, now: now(), log })
}