# §60 News, Events & Macro Intelligence — implementation status

> Status record for `docs/web-app/tm-trading-roadmap-v3.5.md` §60, kept in the
> shape §56 asks for (`status / completion date / tests / acceptance evidence /
> known limitations / migration notes`). Companion documents:
> `docs/web-app/ai-agent-session-audit.md` (the same record for §59),
> `docs/web-app/roadmap-v3.5-gap-audit.md` (the audit that produced the gap
> list below), `docs/news-source-audit.md`, `docs/news-taxonomy.md`,
> `docs/news-license-matrix.md`.
>
> Last verified against code: **2026-10-17** (`npm run verify`, 17 suites +
> `test:app`).

## 1. Slice status

| Slice | Requirement | Status | Primary artifacts |
|---|---|---|---|
| A | Source audit, rights matrix, taxonomy | **done** | `docs/news-source-audit.md`, `docs/news-taxonomy.md`, `docs/news-license-matrix.md`, `engine/newsIngest.mjs` (registry seed) |
| B | Ingest + News Desk (read-only) | **done** | `services/news.mjs`, `services/newsStore.mjs`, `engine/newsIngest.mjs`, `app/pages/news/index.vue`, `app/pages/news/events.vue`, `app/pages/news/sources.vue`, `server/api/v1/news/*`, `tests/news.test.ts` |
| C | Event clusters, entities, **calendar** | **done** | `engine/newsEvents.mjs`, `services/newsEvents.mjs`, `engine/macro.mjs`, `services/macro.mjs`, `server/api/v1/calendar/index.get.ts`, `app/pages/markets/calendar.vue`, `tests/newsEvents.test.ts`, `tests/macroCalendar.test.ts` |
| D | Evidence-backed summaries + outlook v1 | **done** | `engine/newsAssess.mjs`, `engine/newsExtractLlm.mjs`, `engine/outlook.mjs`, `app/pages/outlook.vue`, `server/api/v1/outlook/*`, `tests/newsOutlook.test.ts` |
| E | Research evaluation + agent integration | **done** | `engine/newsEvidenceSet.mjs`, `engine/newsScorecard.mjs`, `app/pages/data-research/research/news-impact.vue`, `server/api/v1/research/news-evaluations/*`, `server/api/v1/research/news-evidence/freeze.post.ts`, `tests/newsResearch.test.ts` |
| F | Coverage expansion + operational hardening | **done** | resilience + §60.15 guards (`engine/newsFetch.mjs`), domain events; coverage = 12 feeds across all five pilot groups incl. SEC EDGAR, ECB + 4 BLS releases, EIA + VnExpress (G5); item revision trail (G6); adversarial tests (G7) |

## 2. What was closed (and how it is proved)

| Gap (gap audit id) | Closure | Test |
|---|---|---|
| **G1** TTL destroyed evidence cited by frozen sets | `engine/newsEvidenceSet.mjs` snapshots rights-safe citation metadata (title, url, first-seen, source, hash) into the set at freeze time, so the set is self-contained and survives `NEWS_RETENTION_SECONDS` | `tests/newsResearch.test.ts` |
| **G2** No economic/corporate calendar | `services/macro.mjs` derives a **cadence projection** calendar from observed FRED vintages into `news_macro_calendar`; `GET /api/v1/calendar` serves it; `/markets/calendar` renders the releases next to the news calendar; every row carries `projected: true` plus the cadence evidence | `tests/macroCalendar.test.ts` |
| **G3** No connector resilience | `engine/newsFetch.mjs`: status classification, bounded retries, exponential backoff with jitter, per-source circuit breaker, timeout; `deadLetterRecord` → `news_dead_letters` for malformed/oversized payloads | `tests/newsFetch.test.ts`, `tests/newsOps.test.ts` |
| **G7 (full)** Connector tests | 429/5xx/backoff/breaker/dead-letter/auth/timeout **plus adversarial** SSRF/redirect/size/content-type and hostile prompt-injection cases | `tests/newsFetch.test.ts`, `tests/newsHardening.test.ts` |
| **G10** No internal domain events | `engine/newsDomainEvents.mjs` derives durable, idempotent events (`news.item.corrected|retracted`, `news.event.confirmed|disputed`, `news.source.degraded|recovered`, `outlook.snapshot.ready|expired`); `services/newsStore.mjs` / `services/news.mjs` emit them; `engine/models/newsDomainEvent.mjs` stores them. Outlooks remain expiry-protected AND correction-aware | `tests/newsDomainEvents.test.ts` |
| **G8.3** (§59) no evidence-bundle export | `GET /api/v1/research/evidence-sets/:id/export` ships a self-contained bundle (attachment, `no-store`) that re-verifies its own hash offline; button on the evidence detail page | `tests/evidenceExport.test.ts` |
| **G5** coverage | 12 feeds spanning **all five pilot market groups**: CoinDesk, Cointelegraph, Decrypt (crypto), Fed press, **SEC EDGAR 8-K** (`equities_global`), **ECB press** + **4 BLS program releases** (CPI/Employment Situation/PPI/JOLTS, `macro_cb`), **EIA Today in Energy** (`fx_gold_commod`, T0, public domain), **VnExpress International business** (`equities_vn` + `fx_gold_commod`, T2 press; per-item regrouping via `marketGroupFor`); connector guards in `engine/newsFetch.mjs` | `tests/newsSources.test.ts`, `tests/newsFetch.test.ts`, `tests/newsHardening.test.ts` |
| **G6** `NewsItemRevision` | `engine/models/newsItemRevision.mjs` (`news_item_revisions`, `_id = nir_sha1(itemId|contentHash)`); `services/newsStore.mjs#persistNewsItems` appends `ingested`/`revised` rows on material content change; `GET /api/v1/news/:id?detail=full`. `NewsStoryCluster`/`ImpactAssessment` convergences recorded in roadmap §60.11 | `tests/newsRevisions.test.ts` |
| **G8** translation decision | roadmap §60.5: translation-at-rest is **rights-gated and deferred**; code keeps original language only until a license-matrix **Translate** row exists for a non-English source | `engine/models/newsItem.mjs` (comment), roadmap §60.5 |
| **G9** (partial) API surface | shipped `GET /news/:id` (+`?detail=full`), `GET /outlook/:id`, `POST /news/ingestion/retry` | `tests/newsFetch.test.ts` (retry), `tests/newsRevisions.test.ts` |

## 3. Open gaps (still true after 2026-10-17)

- **Coverage — remaining connectors.** All five pilot market groups now have at
  least one source, but two are still partial: `fx_gold_commod` covers
  **commodities** (EIA) but has no dedicated **FX/gold** feed, and
  `equities_vn` rests on a single **press** source (VnExpress) with no official
  HOSE/HNX/SBV connector. Corporate actions/earnings have no connector at all.
  The taxonomy and rights matrix exist, so this is connector work after a
  license-matrix row per source.
- **Calendar is projection-only.** No licensed official schedule (FOMC/ECB/BLS)
  and no earnings/corporate-actions source is wired. Every row must keep saying
  `projected` with its evidence; do not present a projection as an official
  schedule.
- **Residual API surface (G9) — closed by decision.** Everything the §60.12 list
  named now exists or is deliberately converged: `GET /news/:id` (+`?detail=full`),
  `GET /outlook/:id`, `GET /calendar/:id`, `POST /news/ingestion/retry`,
  `POST /news/sources/:id/validate`. Enable/disable is folded into
  `PATCH /news/sources/:id` (`{enabled}` only); a separate `outlook/generate`
  job is unnecessary because `GET /outlook?group=&horizon=` already builds and
  durably upserts the deterministic snapshot; `research/news-impact/run` is
  `POST /research/news-evaluations`.

## 4. Tests that carry the acceptance evidence

| Concern | Test file |
|---|---|
| Ingest, license gate, allowlist projection, dedupe, correction flow | `tests/news.test.ts`, `tests/newsSources.test.ts` |
| Clustering, entities, corroboration | `tests/newsEvents.test.ts` |
| Domain events (corrections reach derived views) | `tests/newsDomainEvents.test.ts` |
| Connector resilience (429/5xx/backoff/breaker/dead letter) | `tests/newsFetch.test.ts`, `tests/newsOps.test.ts` |
| Adversarial connector + prompt-injection hardening | `tests/newsHardening.test.ts` |
| Item revision trail (`ingested`/`revised`) | `tests/newsRevisions.test.ts` |
| Macro vintages + projected calendar | `tests/newsMacroExtract.test.ts`, `tests/macroCalendar.test.ts` |
| Outlook snapshots | `tests/newsOutlook.test.ts` |
| Frozen evidence, scorecards, PIT exclusion | `tests/newsResearch.test.ts` |
| Evidence export (offline re-verification) | `tests/evidenceExport.test.ts` |

## 5. Operational notes / migration

- **Retention vs reproducibility.** Sets are self-contained, so the 7-day news
  TTL is safe again. If a future change stops snapshotting citations, retention
  must become payload-aware instead — do not "fix" a missing item by extending
  the TTL blindly.
- **Dead letters.** `news_dead_letters` is reviewed by humans; a growing queue
  means a source changed shape. Nothing re-processes it automatically.
- **Calendar cadence.** Projections are recomputed from observations; they are
  overwritten by evidence, never by a guess. When an official schedule source is
  licensed, its rows must be marked `projected: false` and win the merge.
- **Domain events** are append-only and idempotent by deterministic key. A
  consumer that needs exactly-once must key on `eventId`, not on arrival order.
