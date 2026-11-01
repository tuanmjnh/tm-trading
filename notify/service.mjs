// notify/service.mjs
// Runtime glue between the pure Notification Router and the real world:
// resolves transport sinks + the `notification_logs` model lazily and calls
// `dispatch`. This is the ONLY notify/ file allowed to touch services/.
//
// DURABLE PATH (§7.3): every event that the router accepts is now routed
// THROUGH THE OUTBOX. `dispatch` stays as the legacy inline path (used by the
// TradingView webhook receiver, which has its own fire-and-forget contract);
// `notify()` is the shared path and is the only thing services like
// alertRules / brief / funding should call, because a Telegram outage must
// never slow a service loop and must never lose a message.
//
// Existing infrastructure is PRESERVED (§25): the Telegram sink delegates to
// the proven services/telegram.mjs (no token -> returns false, the attempt is
// recorded as a failed delivery — never a silent success). Web Push / Electron
// sinks can be injected by whoever hosts them; unconfigured channels are
// recorded as `{ ok: false, error: 'sink not configured' }`, never faked.
import { dispatch } from './send.mjs'
import { sendTelegram } from '../services/telegram.mjs'
import { enqueueNotification } from './outboxDriver.mjs'

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
 * Shared notify path (§7.3). Routes the event through the durable outbox so a
 * delivery failure is retried with backoff instead of being terminal.
 *
 * @param {object} event
 * @param {object} [opts]
 * @returns {Promise<{ enqueued: boolean, queued: number, delivered: string[], results: any[], suppressed?: boolean } | null>}
 *   null when the router refused the event (not a delivery outcome).
 */
export async function notify(event, { sinks = DEFAULT_SINKS, getLogModel = defaultGetLogModel, ...rest } = {}) {
  // The outbox driver owns the model resolution and the audit row; we only need
  // the log model for the legacy projection glue, which the driver already does.
  return enqueueNotification(event, { sinks, ...rest })
}

/**
 * Legacy inline dispatch (TradingView webhook path). Kept for callers that own
 * their own delivery contract; new callers should use `notify()`.
 */
export async function dispatchNotify(event, opts = {}) {
  return dispatch(event, {
    sinks: opts.sinks || DEFAULT_SINKS,
    getLogModel: opts.getLogModel || defaultGetLogModel,
    ...opts,
  })
}