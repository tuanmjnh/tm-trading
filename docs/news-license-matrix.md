# News License Matrix v1 — V3.5 §60 Slice A

> Per-source rights record. Rule: **no new connector without a row here first**
> (Slice A acceptance, §60.18). Unknown = not permitted until clarified.
> Authority: `docs/web-app/tm-trading-roadmap-v3.5.md` §60.4–60.5.

Legend: ✅ permitted · ❌ not permitted · ❓ unknown (treat as not permitted).

## v1 rows (2026-10-16)

### coindesk (RSS, no contract)

| Right | Status | Note |
|---|---|---|
| Fetch (poll RSS) | ✅ | Public feed, 600s interval, standard UA |
| Store metadata (title/link/ts/source) | ✅ | Minimal facts for dedup + display |
| Store full text | ❌ | Excerpts only (≤240 chars, fair-use style); never full body |
| Display (headline + link + excerpt) | ✅ | Always with source attribution + outbound link |
| Generate summary (extractive/abstractive) | ❓ | No summarization exists today; requires review before Slice D |
| Internal model processing (classify/score) | ✅ | Keyword scoring on title/excerpt is transformative use of short excerpts |
| Training use | ❌ | Never train on provider content |
| Retention ceiling | 7 days | Code drift noted in audit (snapshot today) — enforce TTL in Slice B |
| Attribution | Required | Source name + link on every surface |

### cointelegraph (RSS, no contract)

Same row as coindesk (public RSS, excerpts ≤240 chars, attribution + link,
7-day retention, no full-text storage, no training use).

### decrypt (RSS, no contract)

Same row as coindesk (public RSS, excerpts ≤240 chars, attribution + link,
7-day retention, no full-text storage, no training use).

### federalreserve (Board RSS, public domain)

| Right | Status | Note |
|---|---|---|
| Fetch | ✅ | Public Board feed, uniform 600s cadence, ~15KB/poll |
| Store metadata | ✅ | Title/link/ts as published |
| Store full text | ❌ | Excerpts only (≤240 chars); link out for the release |
| Display | ✅ | Attribution `Federal Reserve Board` + link to the release |
| Generate summary | ❓ | Same review gate as press sources |
| Internal model processing | ✅ | Keyword scoring on title/excerpt |
| Training use | ❌ | |
| Retention ceiling | 7 days | Same TTL enforcement as RSS |
| Tier labeling | T0_PRIMARY | Central-bank publication; decisions vs minutes distinguished only by future extraction, never assumed |

### sec_edgar (EDGAR Atom, public government filings)

| Right | Status | Note |
|---|---|---|
| Fetch | ✅ | Public EDGAR feed; contact `User-Agent` required by fair-access (`NEWS_SEC_UA`), 900s cadence |
| Store metadata | ✅ | Title/link/ts as published (filing headline + link) |
| Store full text | ❌ | Excerpts only (≤240 chars); link out to the filing on sec.gov |
| Display | ✅ | Attribution `SEC EDGAR` + link to the filing |
| Generate summary | ❓ | Same review gate as press sources |
| Internal model processing | ✅ | Keyword scoring on title/excerpt; form-type anchoring |
| Training use | ❌ | |
| Retention ceiling | 7 days | Same TTL enforcement as RSS |
| Tier labeling | T0_PRIMARY | Primary regulator filing system |

### ecb (Press RSS, public central-bank release)

| Right | Status | Note |
|---|---|---|
| Fetch | ✅ | Public ECB press feed, 900s cadence, standard UA |
| Store metadata | ✅ | Title/link/ts as published |
| Store full text | ❌ | Excerpts only (≤240 chars); link out to the release |
| Display | ✅ | Attribution `European Central Bank` + link |
| Generate summary | ❓ | Same review gate as press sources |
| Internal model processing | ✅ | Keyword scoring on title/excerpt |
| Training use | ❌ | |
| Retention ceiling | 7 days | Same TTL enforcement as RSS |
| Tier labeling | T0_PRIMARY | Central-bank publication; direction stays flat until extraction distinguishes the release |

### bls_* (BLS program release feeds, public government statistics)

Covers `bls_cpi`, `bls_empsit`, `bls_ppi`, `bls_jolts` — one feed per release
program (`/feed/<program>.rss`). Each feed carries the most recent release items
(≈12); if a program has no items in the window the feed is well-formed but empty
(ingested as `empty_feed`, never a degradation).

| Right | Status | Note |
|---|---|---|
| Fetch | ✅ | Public BLS program feeds, 900s cadence, standard UA |
| Store metadata | ✅ | Title/link/ts as published |
| Store full text | ❌ | Excerpts only (≤240 chars); link out to the release |
| Display | ✅ | Attribution `U.S. Bureau of Labor Statistics` + link |
| Generate summary | ❓ | Same review gate as press sources |
| Internal model processing | ✅ | Keyword scoring on title/excerpt |
| Training use | ❌ | |
| Retention ceiling | 7 days | Same TTL enforcement as RSS |
| Tier labeling | T0_PRIMARY | Government statistical release; direction is data-dependent so it stays flat until extraction decides |

### eia (Today in Energy RSS, public government analysis)

| Right | Status | Note |
|---|---|---|
| Fetch | ✅ | Public EIA feed, 1800s cadence, standard UA |
| Store metadata | ✅ | Title/link/ts as published |
| Store full text | ❌ | Excerpts only (≤240 chars); link out to the analysis on eia.gov |
| Display | ✅ | Attribution `U.S. Energy Information Administration` + link |
| Generate summary | ❓ | Same review gate as press sources |
| Internal model processing | ✅ | Keyword scoring on title/excerpt |
| Training use | ❌ | |
| Retention ceiling | 7 days | Same TTL enforcement as RSS |
| Tier labeling | T0_PRIMARY | Official energy-statistics agency; direction is data-dependent so it stays flat |

### vnexpress (Business RSS, public press feed, no contract)

| Right | Status | Note |
|---|---|---|
| Fetch | ✅ | Public VnExpress International business feed, 900s cadence, standard UA |
| Store metadata | ✅ | Title/link/ts as published |
| Store full text | ❌ | Excerpts only (≤240 chars); link out to the article |
| Display | ✅ | Attribution `VnExpress` + link to the article |
| Generate summary | ❓ | No summarization exists today; requires review before Slice D |
| Internal model processing | ✅ | Keyword scoring on title/excerpt only |
| Training use | ❌ | Never train on provider content |
| Retention ceiling | 7 days | Same enforcement as the other RSS sources |
| Tier labeling | T2_SECONDARY | Commercial publisher; headline + link only, never presented as primary |

### cryptopanic (API, token-gated, optional)

| Right | Status | Note |
|---|---|---|
| Fetch | ✅ iff `CRYPTOPANIC_TOKEN` set | Server-side only; token never leaves server |
| Store metadata | ✅ | Title/link/ts as returned |
| Store full text | ❌ | API returns titles only in our usage |
| Display | ✅ | Attribution `cryptopanic` + link; underlying source shown when available |
| Generate summary | ❓ | Same review gate as above |
| Internal model processing | ✅ | Same scoring path as RSS |
| Training use | ❌ | |
| Retention ceiling | 7 days | Same enforcement as RSS in Slice B |
| Tier labeling | Required | Aggregator: underlying posts may be T2/T3 — never present as primary |

## Rules (standing)

1. Redistribution = headlines + links only; no full-text redistribution, no
   resale of any provider content.
2. T3/unverified content (if ever added) is isolated, labeled unverified, and
   can never drive high-confidence impact.
3. Paid/licensed wires require a signed-terms row here before any code.
4. This matrix is reviewed whenever a source is added, removed, or re-tiered.
