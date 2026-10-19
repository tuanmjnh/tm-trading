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
import { seedNewsSources, persistNewsItems, updateSourceHealth, persistDeadLetters, persistDomainEvents } from './newsStore.mjs'
import { createBreaker, fetchWithRetry, looksLikeFeed } from '../engine/newsFetch.mjs'
import { diffSourceHealth } from '../engine/newsDomainEvents.mjs'
import { clusterRecentEvents } from './newsEvents.mjs'
import { sendTelegram } from './telegram.mjs'

export const FEEDS = Object.freeze([
  { name: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'decrypt', url: 'https://decrypt.co/feed' },
  { name: 'federalreserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  // §60.3 / §60.5 coverage (Slice F): official T0 primary sources that are
  // public and license-free — SEC EDGAR latest 8-K filings (global equities)
  // and the ECB press RSS (macro/central banks). SEC requires a contact
  // User-Agent under its fair-access policy (NEWS_SEC_UA overrides).
  { name: 'sec_edgar', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom', userAgent: process.env.NEWS_SEC_UA || 'tm-trading-news/1.0 (contact: ops@example.com)' },
  { name: 'ecb', url: 'https://www.ecb.europa.eu/rss/press.html' },
  // §60.5 coverage (G5): official BLS program release feeds for the monthly
  // market movers — CPI, Employment Situation, PPI, JOLTS. Each per-program feed
  // carries the most recent releases; if a program has no items in the window it
  // is a well-formed EMPTY feed (ok + `empty_feed`), never a degradation. Public
  // domain (U.S. government work) — see docs/news-license-matrix.md.
  { name: 'bls_cpi', url: 'https://www.bls.gov/feed/cpi.rss' },
  { name: 'bls_empsit', url: 'https://www.bls.gov/feed/empsit.rss' },
  { name: 'bls_ppi', url: 'https://www.bls.gov/feed/ppi.rss' },
  { name: 'bls_jolts', url: 'https://www.bls.gov/feed/jolts.rss' },
  // §60.5 coverage (G5): the two remaining pilot groups. EIA is the official
  // U.S. energy-statistics agency (public domain) -> fx_gold_commod; the
  // VnExpress International business feed is a public press RSS -> equities_vn.
  { name: 'eia', url: 'https://www.eia.gov/rss/todayinenergy.xml' },
  { name: 'vnexpress', url: 'https://e.vnexpress.net/rss/business.rss' },
])

// §60.4 source-specific user agent + §60.15 connector allowlist (opt-in).
const NEWS_USER_AGENT = process.env.NEWS_USER_AGENT || 'tm-trading-news/1.0 (contact: ops@example.com)'
const NEWS_ALLOWED_HOSTS = String(process.env.NEWS_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)

const DEFAULT_TIMEOUT_MS = Number(process.env.NEWS_HTTP_TIMEOUT_MS || 10000)

// Slice F (§60.5): one breaker per process, shared by every connector. It is
// deliberately process-local — the durable per-source health lives in the
// registry — so a source answering 429/5xx stops being hammered immediately.
export const NEWS_BREAKER = createBreaker({
  breakerThreshold: Number(process.env.NEWS_BREAKER_THRESHOLD || 3),
  breakerCooldownMs: Number(process.env.NEWS_BREAKER_COOLDOWN_MS || 5 * 60 * 1000),
})

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
  { re: /sec\s|lawsuit|sued?\b|regulat|crackdown|\bban(ned|s)?\b|enforcement/i, w: 4, tag: 'regulation', dir: -1 },
  { re: /etf\b|etfs\b|fund (inflow|outflow)|institutional|blackrock|fidelity/i, w: 4, tag: 'etf', dir: 1 },
  { re: /approval|approves?|greenlight/i, w: 3, tag: 'approval', dir: 1 },
  { re: /whale|accumulat|acquire[sd]?/i, w: 3, tag: 'whale', dir: 1 },
  { re: /partnership|integrat|adopt|collaborat/i, w: 3, tag: 'adoption', dir: 1 },
  { re: /list(ed|ing)?\b|delist/i, w: 3, tag: 'listing', dir: 1 },
  { re: /hackers?\b|ransomware|phishing/i, w: 5, tag: 'security', dir: -1 },
  { re: /soar|surge|rally|all.time high|breakout/i, w: 2, tag: 'price', dir: 1 },
  { re: /plunge|crash|tumble|sell.off|dip\b/i, w: 2, tag: 'price', dir: -1 },
  // Official macro (T0): direction is meeting-dependent — dir 0 keeps it flat
  // and lets corroboration/extraction decide. Weight 4 clears the med floor.
  { re: /federal reserve|fomc|rate decision|basis points?|quantitative (easing|tightening)|balance sheet|dot plot|press conference.*chair/i, w: 4, tag: 'central_bank', dir: 0 },
  // §60.3 official disclosures / corporate events (SEC EDGAR, T0). Anchored on
  // form types and unambiguous corporate actions so a generic "files" or
  // "listing" in a crypto headline cannot trip it.
  { re: /\b8-k\b|\b10-k\b|\b10-q\b|\b6-k\b|\b20-f\b|\b40-f\b|\b13f\b|\bsc 13[gd]\b|\bs-1\b|prospectus|current report|annual report|quarterly report|tender offer|\bmerger\b|acquisition|\bearnings\b|guidance|restatement|buyback|\bdividend\b/i, w: 3, tag: 'filing', dir: 0 },
  // ECB / Eurosystem (T0) — same flat-direction treatment as the Fed rule.
  { re: /\becb\b|european central bank|eurosystem|lagarde/i, w: 4, tag: 'central_bank', dir: 0 },
  // §60.5 official US macro releases (BLS, T0): CPI / Employment Situation /
  // PPI / JOLTS. Direction is data-dependent — dir 0 keeps it flat and lets
  // corroboration/extraction decide. Weight 4 clears the med floor so a release
  // headline is stored even though it carries no other keyword.
  { re: /consumer price index|producer price index|employment situation|job openings and labor turnover|\bcpi\b|\bppi\b|\bjolts\b/i, w: 4, tag: 'macro_release', dir: 0 },
  // §60.5 energy/metals/ags (EIA, T0): supply/price shocks are data-dependent
  // (dir 0). Word-anchored so a generic "oil"/"energy" crypto metaphor cannot
  // trip it; "gold prices" (not bare "gold") avoids asset-class noise.
  { re: /\bcrude oil\b|\bopec\b|\bnatural gas\b|\bgasoline\b|\bdiesel\b|\bheating oil\b|\bpropane\b|\bbrent\b|\bwti\b|\bpetroleum\b|\brefinery\b|\bcommodit(y|ies)\b|\bgold prices?\b|\bsilver prices?\b|\bcopper\b|\bwheat\b|\bcorn\b/i, w: 3, tag: 'commodity', dir: 0 },
  // §60.5 Vietnam capital markets (VnExpress, T2): anchored on Vietnam-specific
  // instruments/venues so the many non-market items in the feed stay `low`.
  { re: /\bvn-?index\b|\bhose\b|\bhnx\b|\bupcom\b|\bsbv\b|state bank of vietnam|\bdong\b|\bvietnam(ese)? (stock|share|bond|market|economy)\b|\bgdp growth\b/i, w: 3, tag: 'equity_market', dir: 0 },
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

/**
 * Fetch one RSS feed through the resilient path (§60.5): bounded attempts,
 * backoff, breaker gate, and a dead letter instead of a silent empty success.
 * Returns { items, ok, error, deadLetter } — it never throws for a single
 * source, because one broken feed must not abort the whole cycle.
 */
export async function fetchFeed(feed, fetchImpl, opts = {}) {
  const res = await fetchWithRetry(feed.url, {
    fetchImpl,
    name: feed.name,
    breaker: opts.breaker || NEWS_BREAKER,
    policy: { timeoutMs: DEFAULT_TIMEOUT_MS },
    headers: { 'User-Agent': feed.userAgent || NEWS_USER_AGENT },
    allowHosts: Array.isArray(opts.allowHosts) ? opts.allowHosts : NEWS_ALLOWED_HOSTS.length ? NEWS_ALLOWED_HOSTS : null,
    sleep: opts.sleep,
    jitter: opts.jitter,
    now: opts.now,
  })
  if (!res.ok) {
    // §60.15 connector-level rejections (SSRF/redirect/size/type) are reviewable
    // too: a source that changed shape, moved host or served a binary must not
    // vanish silently — it becomes a dead letter with a stable reason code.
    const dlReason = String(res.reason || '')
    const reviewable = dlReason === 'oversized' || dlReason.startsWith('blocked_')
    return {
      items: [],
      ok: false,
      error: res.error,
      reason: res.reason,
      deadLetter: reviewable
        ? { sourceId: feed.name, url: feed.url, reason: dlReason.split(':')[0], status: res.status, attempts: res.attempts, text: '' }
        : null,
    }
  }
  const text = res.text || ''
  const items = parseFeed(text, feed.name)
  if (items.length) return { items, ok: true, error: null, reason: 'ok', deadLetter: null }
  // Zero items is two different situations and they must not be confused (D12):
  //  - the body IS a feed and simply had nothing (degraded, no dead letter noise),
  //  - the body is NOT a feed (HTML error page, CDN stub, truncated document):
  //    a hard failure AND a review item — "our parser broke" must never look
  //    like "nobody published".
  const feedShaped = looksLikeFeed(text)
  return {
    items: [],
    ok: feedShaped,
    error: feedShaped ? null : 'malformed_payload: response is not RSS/Atom',
    reason: feedShaped ? 'empty_feed' : 'malformed_payload',
    deadLetter: {
      sourceId: feed.name,
      url: feed.url,
      reason: feedShaped ? 'empty_feed' : 'malformed_payload',
      status: res.status,
      attempts: res.attempts,
      text,
    },
  }
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
export async function runNews({ fetchImpl, now = new Date(), seedImpl = null, sleep = null, jitter = null, deadLetterModel = null } = {}) {
  // Registry first (fail-soft): operator-disabled sources are neither fetched
  // nor stored. Mongo down -> sourcesById null -> fetch everything (legacy).
  // seedImpl is injectable for offline tests (defaults to the real seeder).
  let sourcesById = null
  try {
    sourcesById = await (seedImpl || seedNewsSources)({ now })
  } catch {
    sourcesById = null
  }
  const enabled = (id) => !sourcesById || sourcesById[id]?.enabled !== false
  // Per-source cadence: skip sources polled more recently than their
  // registry interval (first run / unknown health always fetches).
  const due = (id) => {
    const rec = sourcesById?.[id]
    if (!rec) return true
    const lastOk = rec.health?.lastOkAt ? new Date(rec.health.lastOkAt).getTime() : NaN
    if (!Number.isFinite(lastOk)) return true
    // §60.12 manual retry: a request stamped after the last success bypasses
    // cadence so an operator can force an immediate poll.
    const retryAt = rec.retryRequestedAt ? new Date(rec.retryRequestedAt).getTime() : NaN
    if (Number.isFinite(retryAt) && retryAt >= lastOk) return true
    const intervalMs = (Number(rec.pollIntervalSec) > 0 ? Number(rec.pollIntervalSec) : 600) * 1000
    return now.getTime() - lastOk >= intervalMs
  }
  const dueFeeds = FEEDS.filter((f) => enabled(f.name) && due(f.name))
  const skippedByCadence = FEEDS.filter((f) => enabled(f.name) && !due(f.name)).map((f) => f.name)
  const fetchCrypto = enabled('cryptopanic') && due('cryptopanic')
  if (!fetchCrypto && enabled('cryptopanic')) skippedByCadence.push('cryptopanic')
  const feeds = dueFeeds
  const settled = await Promise.allSettled([
    ...feeds.map((f) => fetchFeed(f, fetchImpl, { sleep, jitter })),
    ...(fetchCrypto ? [fetchCryptoPanic(fetchImpl).then(
      (items) => ({ sourceId: 'cryptopanic', items, ok: true, error: null, deadLetter: null }),
      (err) => ({ sourceId: 'cryptopanic', items: [], ok: false, error: String(err?.message || err), deadLetter: null }),
    )] : []),
  ])
  const perSource = []
  const items = []
  const deadLetters = []
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      const v = r.value
      perSource.push({ sourceId: v.sourceId, ok: v.ok !== false, itemCount: v.items.length, error: v.error || null })
      if (v.items.length) items.push(...v.items)
      if (v.deadLetter) deadLetters.push(v.deadLetter)
    } else {
      const e = r.reason
      perSource.push({ sourceId: e?.sourceId || 'unknown', ok: false, itemCount: 0, error: String(e?.message || e) })
    }
  }
  // §60.5 review queue: malformed / empty payloads are recorded for an operator
  // (fail-soft, deterministic ids — a repeat failure updates ONE row).
  const deadLetterRes = await persistDeadLetters(deadLetters, { now, NewsDeadLetterModel: deadLetterModel })
  const ok = perSource.filter((p) => p.ok)
  if (!settled.length) {
    if (skippedByCadence.length) {
      // Nothing due this cycle — healthy steady state, not an outage.
      try {
        await updateSourceHealth(perSource, { now })
      } catch { /* fail-soft */ }
      return { feeds: 0, fetched: 0, fresh: 0, alerted: 0, persisted: 0, duplicates: 0, events: 0, mongo: sourcesById ? 'up' : 'down', skippedByCadence }
    }
    // Operator disabled every source — intent, not outage (no throw: heartbeat
    // must not page on a deliberate off switch).
    return { feeds: 0, fetched: 0, fresh: 0, alerted: 0, persisted: 0, duplicates: 0, events: 0, mongo: sourcesById ? 'up' : 'down', disabled: true }
  }
  if (!ok.length) throw new Error('news: tat ca feed chet')

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
  // Slice B: durable normalized envelope (idempotent, license-gated, TTL).
  // Fail-soft — never breaks the intel-snapshot + Telegram path below.
  let persisted = 0
  let duplicates = 0
  let events = 0
  try {
    const pres = await persistNewsItems(scored, sourcesById || {}, { now })
    persisted = pres.persisted
    duplicates = pres.duplicates
    await updateSourceHealth(perSource, { now })
    // §60.12 source-health events: compare the registry state BEFORE this run
    // (read when the registry was seeded) with the state this run just recorded.
    const healthEvents = []
    for (const p of perSource) {
      const before = (sourcesById || {})[p.sourceId]?.health?.state || null
      const after = !p.ok ? 'down' : p.itemCount > 0 ? 'ok' : 'degraded'
      healthEvents.push(...diffSourceHealth(
        { state: before },
        { sourceId: p.sourceId, state: after, error: p.error },
        { at: now.getTime(), correlationId: 'news.ingest' },
      ))
    }
    if (healthEvents.length) await persistDomainEvents(healthEvents)
    // Slice C: cluster fresh items into MarketEvents (fail-soft inside).
    try {
      const cl = await clusterRecentEvents({ now })
      events = cl.events || 0
    } catch {
      events = 0
    }
  } catch {
    // Mongo down or registry unavailable — intel snapshot below already
    // fail-softs via insertEvents; nothing else to do here.
  }
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

  return { feeds: ok.length, fetched: items.length, fresh, alerted, persisted, duplicates, events, skippedByCadence, mongo, deadLetters: deadLetterRes.queued + deadLetterRes.updated }
}
