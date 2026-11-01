// =============================================================================
//  TM TRADING - Telegram sender cho services (fail-soft, cùng .env keys với
//  webhook + exec/drift.mjs: TELEGRAM_TOKEN / TELEGRAM_CHAT_ID).
//  Không cấu hình -> send() = false, không lỗi (service vẫn chạy).
//
//  Hai entry point (§7.3):
//    sendTelegram(text, tag)         -> boolean (giữ nguyên cho mọi caller cũ)
//    sendTelegramMessage(text, tag)  -> bằng chứng giao nhận: { ok, accepted,
//                                       messageId, description, retryable,
//                                       retryAfterMs, errorCode }
//  The outbox retries only what is genuinely retryable: a 400/401/403/404 is a
//  configuration fault that retrying cannot fix, while a 429/5xx/network error is
//  worth another attempt (with backoff).
// =============================================================================
import { loadEnv } from '../exec/env.mjs'

loadEnv()

/**
 * @param {string} text
 * @param {string} [tag] tiền tố log, vd '[scanner]'
 * @returns {Promise<boolean>}
 */
export async function sendTelegram(text, tag = '[services]') {
  const res = await sendTelegramMessage(text, tag)
  return res.ok
}

/**
 * Send one message and report the EVIDENCE Telegram gives us (roadmap §7.3):
 * `accepted` only when the API returned a `message_id`, `retryable` when another
 * attempt could plausibly succeed.
 *
 * @param {string} text
 * @param {string} [tag]
 * @param {{fetchImpl?:Function}} [opts]
 * @returns {Promise<{ok:boolean, accepted:boolean, messageId:string|null, description:string|null,
 *                    retryable:boolean, retryAfterMs:number|null, errorCode:number|null}>}
 */
export async function sendTelegramMessage(text, tag = '[services]', { fetchImpl } = {}) {
  const token = process.env.TELEGRAM_TOKEN || ''
  const chat = process.env.TELEGRAM_CHAT_ID || ''
  if (!token || !chat) {
    // Not configured is a configuration fault: retrying cannot help, and faking
    // success would hide a dead channel (D12).
    return { ok: false, accepted: false, messageId: null, description: 'telegram not configured', retryable: false, retryAfterMs: null, errorCode: null }
  }

  const doFetch = fetchImpl || globalThis.fetch
  let res
  try {
    res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    })
  } catch (e) {
    console.warn(tag, 'telegram fail:', e?.message)
    return { ok: false, accepted: false, messageId: null, description: String(e?.message || e), retryable: true, retryAfterMs: null, errorCode: null }
  }

  let payload = null
  try { payload = await res.json() } catch { /* non-JSON body; the status carries the meaning */ }

  if (res.ok && payload?.ok !== false) {
    const messageId = payload?.result?.message_id
    return {
      ok: true,
      accepted: messageId != null,
      messageId: messageId != null ? String(messageId) : null,
      description: null,
      retryable: false,
      retryAfterMs: null,
      errorCode: null,
    }
  }

  const errorCode = Number(payload?.error_code ?? res.status) || null
  const description = String(payload?.description || `HTTP ${res.status}`)
  const retryAfterSec = Number(payload?.parameters?.retry_after)
  const retryable = res.status === 429
    || res.status >= 500
    || (Number.isFinite(errorCode) && (errorCode === 429 || errorCode >= 500))
  console.warn(tag, 'telegram HTTP', res.status, description)
  return {
    ok: false,
    accepted: false,
    messageId: null,
    description,
    retryable,
    retryAfterMs: Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : null,
    errorCode,
  }
}
