# News Source Audit — V3.5 §60 Slice A

> Status: **audit only** (required first deliverable §60.18). Verified against
> code on 2026-10-16. Authority: `docs/web-app/tm-trading-roadmap-v3.5.md` §60.
> No connector is enabled by this document; it records what exists.

## 1. Existing news/intelligence code inventory

| Component | File(s) | What it does today |
|---|---|---|
| Feed fetcher | `services/news.mjs` | 3 hardcoded RSS feeds (CoinDesk, Cointelegraph, Decrypt) + optional CryptoPanic (only with `CRYPTOPANIC_TOKEN`); regex XML parse (no XML dep); 10s timeout; `Promise.allSettled` across feeds |
| Scoring | `services/news.mjs` `NEWS_RULES` + `scoreNews()` | Pure keyword rules → `score/dir/tags/level` (`high ≥6`, `med ≥3`, else `low`); golden-tested in `services/test.mjs` §3 |
| Dedup | `services/news.mjs` | Event id `news:<sha1(link)>`; re-runs never resend |
| Store | `services/store.mjs` `insertEvents()` + `Intel` model | **Snapshot semantics**: `deleteMany(kind)` + insert — the whole `news` intel list is replaced each run |
| Schedule | heartbeat (`services/test.mjs` §heartbeat) | `news` every **600s** (`DEFAULT_INTERVALS.news`), tracks `lastRunAt/lastOkAt` |
| Filtering | `services/news.mjs` runner | Only `med`+`high` persisted (`low` dropped as noise) |
| Alerting | `services/news.mjs` + `services/telegram.mjs` | Telegram digest for NEW `high` items only |
| Display | `app/pages/markets/calendar.vue` + `app/utils/calendar.ts` | Intel `news` stream grouped into UTC-day buckets, level + text filter; pure projections, no rescoring |
| Types | `shared/types/intel.ts` `IntelNewsItem` | Shared shape for intel payload, calendar and terminal overlays |

## 2. Per-source record

### 2.1 coindesk (RSS)

- Endpoint: `https://www.coindesk.com/arc/outboundfeeds/rss/` (GET, no auth)
- Transport: RSS/Atom, parsed with regex + CDATA handling
- Rate limits: none published for RSS; polled every 600s by our scheduler; 10s fetch timeout (`NEWS_HTTP_TIMEOUT_MS`)
- Markets/languages: crypto, English
- Historical coverage: feed window only (latest ~20-50 items per poll); no backfill
- Authority: T2 secondary press (reputable specialist publication, not primary)
- Gaps: no per-source health tracking (only global heartbeat), no last-item timestamp per feed

### 2.2 cointelegraph (RSS)

- Endpoint: `https://cointelegraph.com/rss` (GET, no auth)
- Same transport/limits/schedule as coindesk
- Markets/languages: crypto, English
- Authority: T2 secondary press

### 2.3 decrypt (RSS)

- Endpoint: `https://decrypt.co/feed` (GET, no auth)
- Same transport/limits/schedule as above
- Markets/languages: crypto, English
- Authority: T2 secondary press

### 2.4 cryptopanic (API, OPTIONAL — off unless configured)

- Endpoint: `https://cryptopanic.com/api/v1/posts/?auth_token=…&public=true&kind=news`
- Auth: `CRYPTOPANIC_TOKEN` env (server-side only; never sent to clients)
- Markets/languages: crypto, multi-language upstream (we store title/link as-is)
- Authority: aggregator (mixed T2/T3 depending on underlying post) — score rules apply equally; no tier distinction today (**gap**)
- Gaps: failures return `[]` silently (no per-source error surfacing beyond heartbeat)

### 2.5 federalreserve (RSS — official source, seeded by default)

- Endpoint: `https://www.federalreserve.gov/feeds/press_all.xml` (GET, no auth; verified live 2026-10-16: HTTP 200, RSS 2.0, Board press releases)
- Transport: RSS/Atom via the shared regex parser; polled on the uniform 600s heartbeat (per-source cadence is future work — the registry `pollIntervalSec` records the actual cadence, not a wish)
- Rate limits: none published for the public feed; ~15KB per poll, polite by volume
- Markets/languages: macro & central banks (`macro_cb`), English
- Historical coverage: feed window only (recent releases); no backfill
- Authority: **T0_PRIMARY** (central-bank publication — the first T0 in the registry)
- Rights: US federal government works are public domain — metadata + headline/link display permitted; excerpts only (≤240 chars, same cap as press); no full text; no training use
- Scoring: `central_bank` keyword rules (weight 4 → `med` floor, direction `flat` — the meeting decides direction, not the headline); event type stays unclassified until extraction can tell decisions from minutes

### 2.6 sec_edgar (Atom — official source, seeded by default)

- Endpoint: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom` (GET, no auth; verified live 2026-10-17: HTTP 200, `application/atom+xml`, 40 `<entry>`)
- Transport: Atom via the shared regex parser; 900s registry cadence (`pollIntervalSec`), gated by the runner's per-source due check
- Rate limits: SEC fair-access policy — a contact `User-Agent` is **required** (`NEWS_SEC_UA`, default `tm-trading-news/1.0 (contact: ops@example.com)`); ≤10 req/s ceiling, we poll far below
- Markets/languages: global equities (`equities_global`), English
- Historical coverage: getcurrent window only (most recent 8-K filings); no backfill
- Authority: **T0_PRIMARY** (EDGAR is the primary regulator filing system)
- Rights: US federal government works / public filings — metadata + headline/link display permitted; excerpts only (≤240 chars); no full text; no training use
- Scoring: form-type-anchored `filing` rule (weight 3 → `med` floor, direction `flat`); anchors on `8-K`/`prospectus`/`earnings`/`merger` etc. so a generic crypto "files/listing" headline cannot trip it

### 2.7 ecb (RSS — official source, seeded by default)

- Endpoint: `https://www.ecb.europa.eu/rss/press.html` (GET, no auth; verified live 2026-10-17: HTTP 200, `application/rss+xml`, 15 items)
- Transport: RSS/Atom via the shared regex parser; 900s registry cadence, gated by the per-source due check
- Rate limits: none published for the public feed; polite by volume
- Markets/languages: macro & central banks (`macro_cb`), English
- Historical coverage: feed window only (recent press releases); no backfill
- Authority: **T0_PRIMARY** (central-bank publication)
- Rights: ECB press releases are publicly redistributable with attribution — metadata + headline/link display permitted; excerpts only (≤240 chars); no full text; no training use
- Scoring: `central_bank` keyword rule (`ECB`/Eurosystem/Lagarde, weight 4 → `med` floor, direction `flat`)

### 2.8 bls_* (RSS — official source, seeded by default)

- Endpoints: `https://www.bls.gov/feed/<program>.rss` for the market-moving programs — `cpi` (Consumer Price Index), `empsit` (Employment Situation), `ppi` (Producer Price Index), `jolts` (Job Openings and Labor Turnover) (GET, no auth; verified live 2026-10-17: HTTP 200, `application/rss+xml`, 12 recent release items each)
- Transport: RSS via the shared regex parser; 900s registry cadence, gated by the per-source due check
- Rate limits: none published for the public feeds; polite by volume. `bls_latest` (the aggregate "Latest Numbers" feed) is deliberately **not** seeded — its single item scores `low` and is never stored
- Markets/languages: macro & central banks (`macro_cb`), English
- Historical coverage: feed window only (the current release per program); no backfill, no forward schedule
- Authority: **T0_PRIMARY** (government statistical release)
- Rights: US federal government works — public domain; metadata + headline/link display permitted; excerpts only (≤240 chars); no full text; no training use
- Scoring: `macro_release` rule (`consumer price index`/`producer price index`/`employment situation`/`job openings and labor turnover`/`CPI`/`PPI`/`JOLTS`, weight 4 → `med` floor, direction `flat`); a release headline carries no other keyword, so without this rule it would score `low` and be dropped
- **Empty-feed semantics**: a program feed with 0 items (a program that has never released inside the window) is a well-formed feed → ingest reports `ok: true` + `empty_feed` (reviewable), never `degraded`/`malformed`. "Nobody released yet" must not look like an outage.
- **Boundary vs a schedule**: these are *release* feeds, not the forward *release schedule*. The §60.7 calendar remains projection-only until an official schedule source is licensed; do not present a BLS release item as a scheduled (upcoming) event.

### 2.9 eia (RSS — official source, seeded by default)

- Endpoint: `https://www.eia.gov/rss/todayinenergy.xml` (GET, no auth; verified live 2026-10-17: HTTP 200, `text/xml`, 18 items)
- Transport: RSS via the shared regex parser; 1800s registry cadence, gated by the per-source due check
- Rate limits: none published; polite by volume
- Markets/languages: FX/gold/commodities (`fx_gold_commod`), English
- Historical coverage: feed window only; no backfill
- Authority: **T0_PRIMARY** (official U.S. energy-statistics agency)
- Rights: US federal government works — public domain; metadata + headline/link display permitted; excerpts only (≤240 chars); no full text; no training use
- Scoring: `commodity` rule (`crude oil`/`opec`/`natural gas`/`gasoline`/`refinery`/`brent`/`wti`/…, weight 3 → `med` floor, direction `flat`). Non-energy analysis items (solar/wind/electricity) score `low` and are dropped — the group is commodities, not utilities
- **Partial group**: this covers the *commodities* half of `fx_gold_commod` (energy, plus gold/silver phrasing in the rule). A dedicated FX/gold feed is still unwired — no free, licensed source identified

### 2.10 vnexpress (RSS — public press, seeded by default)

- Endpoint: `https://e.vnexpress.net/rss/business.rss` (GET, no auth; verified live 2026-10-17: HTTP 200, `application/xml`, 60 items)
- Transport: RSS via the shared regex parser; 900s registry cadence, gated by the per-source due check
- Rate limits: none published; polite by volume
- Markets/languages: Vietnam equities & capital markets (`equities_vn`) primary, plus `fx_gold_commod` — a broad business feed; `marketGroupFor` re-groups an individual gold/FX item out of `equities_vn` per its matched rule tag (§60.5 precision). English (the international edition; a Vietnamese-language feed is a future option but needs Vietnamese scoring rules and a translation decision — §60.5)
- Historical coverage: feed window only (≈60 recent business items); no backfill
- Authority: **T2_SECONDARY** (commercial publisher, no contract)
- Rights: public RSS, headline + link + excerpt only (≤240 chars); attribution `VnExpress` + outbound link required; no full text; no summarization; no training use
- Scoring: `equity_market` rule (`vn-index`/`hose`/`hnx`/`upcom`/`sbv`/`dong`/Vietnam market phrasing, weight 3 → `med` floor, direction `flat`). The feed mixes market news with lifestyle/sport items; the anchored rule leaves the non-market items at `low` (≈⅓ of items kept on a live sample)

## 3. Cron jobs / queues

- No OS cron: scheduling is the heartbeat service (`services/heartbeat.mjs`, `DEFAULT_INTERVALS.news = 600`)
- No queues involved in the news path (queues are Hub shared-core infra, unrelated)
- No retry-with-backoff per feed (single attempt per cycle; next cycle in 600s)

## 4. Mongo schemas

- `Intel` documents with `kind: 'news'` (via `services/store.mjs`); snapshot-replaced, **no TTL index and no 7-day pruning in code** — the `news.mjs` header comment claiming "TTL 7 ngày" does not match the store implementation (snapshot semantics keep only the latest run's items). Flagged as doc/code drift to fix, not as data loss (each run rewrites).
- No `NewsItem`/`NewsEvent`/`NewsSource` collections exist (those are §60 Slice B/C work).

## 5. Hub integrations

- None for news: no shared Hub messaging/media/import involvement. Telegram digest uses the local `services/telegram.mjs` sender directly.

## 6. Gaps vs §60 (drives Slice B–F, not this doc)

1. No source registry (FEEDS is hardcoded; no per-source owner/policy/health record).
2. No license tracking per source (see `docs/news-license-matrix.md`).
3. No taxonomy on items (only flat `tags` from keyword rules; see `docs/news-taxonomy.md`).
4. No macro / Vietnam / equities / FX-gold sources (crypto press only).
5. No `/news` page or News Desk (only the calendar grouping + terminal markers).
6. No event clustering, entity mapping, corrections/retractions, or vintages.
7. No AI extraction (only keyword scoring); no evidence IDs on claims.
8. Store/scheduler semantics undocumented for operators (snapshot vs TTL drift noted above).

## 7. Minimal pilot set (Slice B proposal, not a commitment)

Keep the 3 RSS (free, keyless, tested) + CryptoPanic if a token is provided; add **one** official macro calendar source only after Slice A rights review. No new paid/licensed connector without a license-matrix row first (Slice A acceptance).

## 8. Management surface (added after Slice F review)

- **Registry page**: `/news/sources` — enable/disable switches, trust tier, permitted uses, poll cadence, freshness, error counters, license status, last ingest, connectivity probe. Policy/rights fields are read-only there (DB-operator territory).
- **API**: `GET /api/v1/news/sources`, `GET /api/v1/news/sources/:id`, `PATCH /api/v1/news/sources/:id` (`{enabled}` only), `POST /api/v1/news/sources/:id/validate` (reachability probe, never mutates). Auth via the global hub-token guard, same as other write endpoints.
- **Disabled semantics**: disabled sources are skipped at fetch (ingest runner consults the registry first), blocked at store (license gate `source_disabled`), and excluded from display (API filter). All-disabled is operator intent — the runner returns `disabled: true` instead of throwing, so heartbeat does not page on a deliberate off switch.
- **Default seed**: `server/plugins/news-registry.ts` seeds the 13 pilot rows on boot (`$setOnInsert` — operator edits survive); `NEWS_REGISTRY=0` skips. The registry therefore exists on a fresh DB before services ever run.
- **Per-source market group**: items take `marketGroups[0]` from their source (Fed → `macro_cb`); the News Desk group chips and `/news?group=` filter work without code changes.
- **Per-source cadence**: the runner consults registry health before fetching — a source polled more recently than its `pollIntervalSec` is skipped for the cycle (`skippedByCadence`, no outage alarm). First run / unknown health always fetches.

## 9. Follow-ups completed after the Slice F review

- **Market Events page** (`/news/events`): deduped events with corroboration/symbol filters, inline expansion to every source report + revision trail, `?id=` deep links. Detail API: `GET /api/v1/news/events/:id?detail=full`.
- **News Impact Research** (`/data-research/research/news-impact`): scorecard run list (hit rate vs persistence baseline) + one-click re-evaluation over expired snapshots. API: `GET/POST /api/v1/research/news-evaluations`.
- **FRED macro connector** (`services/macro.mjs`, heartbeat `macro` every 6h): 6 official US series (FEDFUNDS, DGS10, CPIAUCSL, PAYEMS, UNRATE, WALCL) with `realtime_end`-pinned vintages. Key-gated (`FRED_API_KEY`; absent = clean skip). Scheduled-release rows still need a calendar source — FRED gives values + vintages, not schedules.
- **LLM extraction** (`services/newsExtract.mjs`, daily, budget-capped): eligible = recent `high`/multi-source items without an `llm:*` assessment; extractor chat carries no tools; `parseAndValidate()` rejects fabricated citations/invented tickers before storage; model rows are always `humanReviewRequired` and coexist with rule-v1. `NEWS_EXTRACT=0` disables.
- **Paid wires**: deliberately NOT added — the coverage gate (§60.16 Slice F) requires a signed license-matrix row first. The onboarding path is: matrix row → registry seed → connector config → review report proof.

## 10. Follow-ups completed after the audit-closure pass

- **Official coverage (G5)**: SEC EDGAR 8-K (`sec_edgar`, `equities_global`), ECB press (`ecb`, `macro_cb`), the four BLS program release feeds (`bls_cpi`/`bls_empsit`/`bls_ppi`/`bls_jolts`, all `macro_cb`), EIA Today in Energy (`eia`, `fx_gold_commod`) and the VnExpress International business feed (`vnexpress`, `equities_vn`) added to `services/news.mjs` `FEEDS` and the `engine/newsIngest.mjs` registry — coverage now spans **all five pilot market groups** via **12 feeds** (`cryptopanic` is the 13th registry row, token-gated). Still uncovered: a dedicated FX/gold feed and corporate actions/earnings.
- **Connector hardening (G7, §60.15)**: `engine/newsFetch.mjs` now enforces scheme + credential + private-host + optional host-allowlist checks BEFORE any network call, follows redirects with per-hop re-validation (bounded, private-host block), and caps response size + content-type. Rejections become stable reason codes (`blocked_scheme`, `blocked_credentials`, `blocked_private_host`, `host_not_allowed`, `blocked_redirect:*`, `blocked_content_type`, `oversized`) surfaced as reviewable dead letters, never silent successes. Adversarial suite: `tests/newsHardening.test.ts`.
- **API surface (G9, §60.12)**: `GET /api/v1/news/:id` (rights-safe item detail), `GET /api/v1/outlook/:id` (immutable stored snapshot, flagged stale), and `POST /api/v1/news/ingestion/retry` (manual reprocessing — stamps `retryRequestedAt` on the registry row, cleared on next success; no separate queue is introduced).
- **Operator env (`.env.example`)**: `NEWS_USER_AGENT`, `NEWS_SEC_UA`, `NEWS_ALLOWED_HOSTS`, `NEWS_HTTP_TIMEOUT_MS`.
