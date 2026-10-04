// =============================================================================
//  TM TRADING - NEWS SERVICE (roadmap Phase 8: RSS KHÔNG cần key + score
//  tác động; CryptoPanic chỉ khi có CRYPTOPANIC_TOKEN).
//
//  XML parse bằng regex (+ hunched CDATA) — feed coin đều nhỏ, KHÔNG kéo
//  thêm xml2js/fast-xml-parser (mục tiêu cắt deps đã đạt 46 gói).
//
//  - Event `news:<sha1(link)>` unique -> chạy lại / retry không gửi trùng.
//  - Chỉ level 'med'+'high' vào collection (low = nhiễu), TTL 7 ngày dọn.
//  - Telegram digest cho bài MỚI level 'high'.
// =============================================================================
import { createHash } from 'node:crypto'
import { getIntel, insertEvents } from './store.mjs'
import { sendTelegram } from './telegram.mjs'

export const FEEDS = Object.freeze([
  { name: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'decrypt', url: 'https://decrypt.co/feed' },
])

const DEFAULT_TIMEOUT_MS = Number(process.env.NEWS_HTTP_TIMEOUT_MS || 10000)

// ---------------------------------------------------------------------------
//  PURE: parse + score (golden test offline)
// ---------------------------------------------------------------------------

function stripTags(html) {
  return String(html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  if (!m) return ''
  return stripTags(m[1])
}

/**
 * Parse RSS (<item>) hoặc Atom (<entry>) -> items chuẩn hóa.
 * PURE — không network.
 */
export function parseFeed(xml, source = '') {
  const out = []
  const blocks = String(xml || '').match(/<(item|entry)[\s\S]*?<\/\1>/gi) || []
  for (const b of blocks) {
    const title = firstTag(b, 'title')
    // RSS: <link>url</link> — Atom: <link href="..." /> (ưu tiên rel=alternate)
    let link = ''
    const href = b.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)
    if (href) link = href[1]
    const inner = b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
    if (!link && inner) link = stripTags(inner[1])
    if (!title || !link) continue
    const pubRaw = firstTag(b, 'pubDate') || firstTag(b, 'published') || firstTag(b, 'updated')
    const pub = pubRaw ? Date.parse(pubRaw) : NaN
    const excerpt = (firstTag(b, 'description') || firstTag(b, 'summary')).slice(0, 240)
    out.push({ title, link, source, excerpt, ts: Number.isFinite(pub) ? pub : 0 })
  }
  return out
}

/**
 * Score tác động — PURE.
 * weight = độ quan trọng (cộng dồn, không nhân sign); dir = chiều tốt/xấu.
 * level: score >= 6 'high' | >= 3 'med' | còn lại 'low'.
 */
export const NEWS_RULES = Object.freeze([
  { re: /hack|exploit(ed)?|stolen|drain(ed)?|vulnerabilit|bridge attack/i, w: 5, tag: 'security', dir: -1 },
  { re: /depeg|liquidation cascade|bankruptc/i, w: 5, tag: 'stability', dir: -1 },
  { re: /sec\s|lawsuit|sued?\b|regulat|crackdown|ban(ned|s)?\b|enforcement/i, w: 4, tag: 'regulation', dir: -1 },
  { re: /etf\b|etfs\b|fund (inflow|outflow)|institutional|blackrock|fidelity/i, w: 4, tag: 'etf', dir: 1 },
  { re: /approval|approves?|greenlight/i, w: 3, tag: 'approval', dir: 1 },
  { re: /whale|accumulat|acquire[sd]?/i, w: 3, tag: 'whale', dir: 1 },
  { re: /partnership|integrat|adopt|collaborat/i, w: 3, tag: 'adoption', dir: 1 },
  { re: /list(ed|ing)?\b|delist/i, w: 3, tag: 'listing', dir: 1 },
  { re: /hackers?\b|ransomware|phishing/i, w: 5, tag: 'security', dir: -1 },
  { re: /soar|surge|rally|all.time high|breakout/i, w: 2, tag: 'price', dir: 1 },
  { re: /plunge|crash|tumble|sell.off|dip\b/i, w: 2, tag: 'price', dir: -1 },
])

export function scoreNews(item) {
  const text = `${item.title || ''} ${(item.excerpt || item.description || '')}`
  let score = 0
  let dir = 0
  const tags = []
  for (const r of NEWS_RULES) {
    if (r.re.test(text)) {
      score += r.w
      dir += r.dir * r.w
      if (!tags.includes(r.tag)) tags.push(r.tag)
    }
  }
  const level = score >= 6 ? 'high' : score >= 3 ? 'med' : 'low'
  return { score, level, tags, dir: dir > 0 ? 'pos' : dir < 0 ? 'neg' : 'flat' }
}

// ---------------------------------------------------------------------------
//  Runner
// ---------------------------------------------------------------------------

async function fetchFeed(feed, fetchImpl) {
  const doFetch = fetchImpl || fetch
  const res = await doFetch(feed.url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`)
  return parseFeed(await res.text(), feed.name)
}

/** CryptoPanic (optional — chỉ khi có token). Trả [] nếu lỗi/thiếu key. */
async function fetchCryptoPanic(fetchImpl) {
  const token = process.env.CRYPTOPANIC_TOKEN
  if (!token) return []
  try {
    const doFetch = fetchImpl || fetch
    const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${encodeURIComponent(token)}&public=true&kind=news`
    const res = await doFetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
    if (!res.ok) return []
    const json = await res.json()
    return (json?.results || []).map((r) => ({
      title: String(r.title || ''),
      link: String(r.url || ''),
      source: 'cryptopanic',
      ts: r.published_at ? Date.parse(r.published_at) || 0 : 0,
      excerpt: '',
    })).filter((r) => r.title && r.link)
  } catch {
    return []
  }
}

/** Chạy 1 lần. Throw nếu TẤT CẢ nguồn chết (heartbeat cần biết). */
export async function runNews({ fetchImpl, now = new Date() } = {}) {
  const results = await Promise.allSettled([...FEEDS.map((f) => fetchFeed(f, fetchImpl)), fetchCryptoPanic(fetchImpl)])
  const ok = results.filter((r) => r.status === 'fulfilled')
  if (!ok.length) throw new Error('news: tat ca feed chet')
  const items = ok.flatMap((r) => r.value)

  const seen = new Set()
  const scored = []
  for (const it of items) {
    if (!it.link || seen.has(it.link)) continue
    seen.add(it.link)
    const s = scoreNews(it)
    if (s.level === 'low') continue
    scored.push({ ...it, ...s })
  }
  scored.sort((a, b) => (b.ts || 0) - (a.ts || 0))

  const Intel = await getIntel()
  const mongo = Intel ? 'up' : 'down'
  let fresh = 0
  let alerted = 0
  if (scored.length) {
    const ts = now.getTime()
    const docs = scored.slice(0, 40).map((s) => ({
      key: `news:${createHash('sha1').update(s.link).digest('hex')}`,
      kind: 'news',
      symbol: null,
      title: s.title,
      ts: s.ts || ts,
      score: s.score,
      data: { level: s.level, dir: s.dir, tags: s.tags, source: s.source, link: s.link, excerpt: (s.excerpt || '').slice(0, 240) },
    }))
    const res = await insertEvents(docs)
    if (res) {
      fresh = res.inserted.length
      const highs = docs.filter((d) => res.inserted.includes(d.key) && d.data.level === 'high')
      if (highs.length) {
        const lines = highs.slice(0, 5).map((d) => `• ${d.title}`)
        await sendTelegram([`📰 TM Trading — TIN ẢNH HƯỞNG CAO (${highs.length})`, ...lines].join('\n'), '[news]')
        alerted = highs.length
      }
    }
  }

  return { feeds: ok.length, fetched: items.length, fresh, alerted, mongo }
}
