// =============================================================================
//  TM TRADING - Telegram sender cho services (fail-soft, cùng .env keys với
//  webhook + exec/drift.mjs: TELEGRAM_TOKEN / TELEGRAM_CHAT_ID).
//  Không cấu hình -> send() = false, không lỗi (service vẫn chạy).
// =============================================================================
import { loadEnv } from '../exec/env.mjs'

loadEnv()

/**
 * @param {string} text
 * @param {string} [tag] tiền tố log, vd '[scanner]'
 * @returns {Promise<boolean>}
 */
export async function sendTelegram(text, tag = '[services]') {
  const token = process.env.TELEGRAM_TOKEN || ''
  const chat = process.env.TELEGRAM_CHAT_ID || ''
  if (!token || !chat) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    })
    if (!res.ok) console.warn(tag, 'telegram HTTP', res.status)
    return res.ok
  } catch (e) {
    console.warn(tag, 'telegram fail:', e?.message)
    return false
  }
}
