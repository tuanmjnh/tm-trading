# Roadmap V3.5 — Gap Audit (what is still missing, and what the document itself must repair)

> Status: **audit only — no behavior changed by this document.**
> Authority: `docs/web-app/tm-trading-roadmap-v3.5.md` (Version 2026-10-15).
> Method: every claim below was checked against code on the working tree on
> 2026-10-17; each row names the file or the absence that is the evidence.
> Companion documents: `docs/web-app/ai-agent-session-audit.md` (the §59 status
> record), `docs/news-source-audit.md`, `docs/news-taxonomy.md`,
> `docs/news-license-matrix.md` (the §60 Slice A deliverables).

This audit answers two different questions, and keeps them apart:

1. **Code gaps** — accepted roadmap requirements with no implementation yet.
2. **Document repairs** — places where the roadmap text is now factually wrong
   or would mislead the next coding agent (stale checklists, superseded menus,
   route names that never shipped).

A roadmap that is 6,700 lines long and carries six generations of design (V2 →
V3.5) is itself a risk surface. Both halves matter.

---

## 0. Closure log (appended 2026-10-17)

This file is the audit as it stood when the gaps were found. The code moved; a
reader must not act on a closed gap. Current status lives in
`docs/web-app/news-macro-status.md` (§60) and
`docs/web-app/ai-agent-session-audit.md` (§59); the rows below say only what
changed and where the proof is.

| Gap | State | Proof |
|---|---|---|
| G1 TTL vs frozen evidence | **closed** | citation snapshot inside `engine/newsEvidenceSet.mjs`; `tests/newsResearch.test.ts` |
| G2 no economic/corporate calendar | **closed (schedule half)** | `services/macro.mjs` → `news_macro_calendar`, `GET /api/v1/calendar`, `/markets/calendar` section; `tests/macroCalendar.test.ts`. No licensed official schedule and no earnings source yet. |
| G3 connector resilience | **closed** | `engine/newsFetch.mjs` (status classes, retry, jittered backoff, breaker, timeout, `deadLetterRecord`), `engine/models/newsDeadLetter.mjs`; `tests/newsFetch.test.ts`, `tests/newsOps.test.ts` |
| G7 connector tests | **closed** | 429/5xx/backoff/breaker/dead-letter/auth/timeout covered; adversarial SSRF/redirect/size/content-type + hostile prompt-injection tests in `tests/newsHardening.test.ts` |
| G10 no internal domain events | **closed** | `engine/newsDomainEvents.mjs`, `engine/models/newsDomainEvent.mjs`, emitted from `services/newsStore.mjs` / `services/news.mjs`; `tests/newsDomainEvents.test.ts` |
| G8.1 kill-switch leaves a `running` session | **closed** | `exec/risk.mjs#haltOpenSessions` + `engine/session.mjs#haltSession`; `tests/failureModes.test.ts` (gate wiring, race/refusal counting) |
| G8.2 WS monitor not an input to §35 | **closed** | `market/healthSnapshot.mjs` (plane writes) → `exec/wsHealth.mjs` (pure translation) → `qualityGates({ wsState, wsGapCount, wsLatencyP95Ms, priceSource })` → `exec/paper.mjs`; `tests/wsHealth.test.ts` |
| G8.3 no evidence-bundle export | **closed** | `server/utils/evidenceExport.ts`, `GET /api/v1/research/evidence-sets/:id/export`, button on the evidence page; `tests/evidenceExport.test.ts` |
| G8.4 no standalone heartbeat alerter | **closed** | `services/heartbeat.mjs check` + `npm run services:alert` (non-zero exit when overdue); `tests/failureModes.test.ts` |
| R1, R2, R3, R4, R5, R6 document repairs | **closed** | §54 rebuilt with artifact pointers, §45 phase-marker note, §57 marked superseded, this file + `news-macro-status.md` as the status records, §60.2/§60.12 reconciled to shipped routes, document map at the top of the roadmap |
| G5 coverage | **closed** | 12 feeds shipped spanning all five pilot market groups: 3 crypto press + Fed + SEC EDGAR 8-K (`equities_global`) + ECB press + 4 BLS program releases (`macro_cb`) + EIA Today in Energy (`fx_gold_commod`) + VnExpress International business (`equities_vn`). BLS adds *release* detection (empty between releases → `ok`/`empty_feed`), not a forward schedule; EIA is official/public-domain, VnExpress is a T2 press RSS. Still partial: `fx_gold_commod` has commodities but no dedicated FX/gold feed, `equities_vn` rests on one press source; corporate-actions still need a connector (rights matrix first). |
| G6 `NewsItemRevision` / `ImpactAssessment` | **closed (as decision + revision trail)** | `engine/models/newsItemRevision.mjs` + `services/newsStore.mjs#persistNewsItems` + `GET /api/v1/news/:id?detail=full`; `NewsStoryCluster→MarketEvent` and `ImpactAssessment→NewsAssessment.impactConfidence`+outlook recorded in roadmap §60.11; `tests/newsRevisions.test.ts` |
| G8 translation-at-rest decision | **closed (decision)** | roadmap §60.5: translation is rights-gated and deferred; no translation produced/stored until a license-matrix **Translate** row exists for a non-English source |
| G9 remaining API surface | **closed** | shipped: `GET /news/:id` (+`?detail=full`), `GET /outlook/:id`, `GET /calendar/:id`, `POST /news/ingestion/retry`, `POST /news/sources/:id/validate`. Convergence decisions (not missing code): enable/disable folded into `PATCH`; `outlook/generate` unnecessary (the on-read path already builds + durably upserts the deterministic snapshot); `news-impact/run` = `POST /research/news-evaluations` |

---

## 1. Authority map (what actually governs what)

| Chapter | Scope | State |
|---|---|---|
| §45, Phases 7A–13 | Original V3 phase list | **Stale markers** — see R2 |
| §54 | V3 completion checklist | **Stale** — 100% unchecked, ~90% of the work is done (R1) |
| §57 | First navigation/menu spec | **Superseded** by §58 and §59.2 (R5) |
| §58 | Navigation + Hub boundary (V3.3 authority) | Implemented; menu contract locked by `tests/nav-contracts.test.ts` |
| §59 | AI agents, bots, sessions, autonomy (V3.4 authority) | Slices A–F implemented; status recorded in the audit doc, not in the roadmap |
| §60 | News, events, macro intelligence (V3.5 authority) | Slices A–F implemented (see §0 closure log); coverage + translation decisions open |

The top-of-file precedence note ("§59 remains authoritative for AI agents…
§60 is authoritative for news/event/macro…") is good and must be kept. What is
missing is the same treatment for **implementation status**: §59's status lives
in `docs/web-app/ai-agent-session-audit.md`, §60 has no equivalent (R3).

---

## 2. §59 — AI agents, sessions, governance (V3.4)

Status: **Slices A–F done**, with four self-declared open edges carried over
from `docs/web-app/ai-agent-session-audit.md` §6. They are restated here as
gap items because they are still open, not because they are new:

| # | Open edge | Evidence |
|---|---|---|
| G8.1 | A kill-switch trip freezes new orders through the Risk Gate but does **not** auto-transition the running session to `halted` — two records an operator must reconcile | `exec/risk.mjs` kill-switch path, `exec/paper.mjs`, `engine/session.mjs` (`running → halted` edge exists but is never driven by the gate) |
| G8.2 | The market-plane WS `monitor.status()` is never an input to the §35 data-quality gate; paper prices off REST klines, so WS latency/sequence loss is invisible to the gate | `exec/feedHealth.mjs`, `exec/paper.mjs` §35 block, `market/monitor.mjs` |
| G8.3 | No session-evidence-bundle export endpoint (UI links to frozen sets, there is no download/export route) | `server/api/v1/research/evidence-sets/*` |
| G8.4 | Paper heartbeat alerting depends on the services orchestrator's overdue check; there is no standalone alerter | `services/heartbeat.mjs`, `services/run.mjs` |

Recommended ordering: **G8.1 first** (split-brain between the halt and the
session record is the only one of the four that can leave a "running" session
running while trading is frozen), then G8.2, G8.4, G8.3.

---

## 3. §60 — News, events & macro intelligence (V3.5)

### 3.1 Slice status

| Slice | Requirement | Status | Evidence |
|---|---|---|---|
| A | Source audit + rights matrix + taxonomy | done | `docs/news-source-audit.md`, `docs/news-taxonomy.md`, `docs/news-license-matrix.md`, registry seed in `engine/newsIngest.mjs` |
| B | Ingest + News Desk read-only | done | `services/news.mjs`, `services/newsStore.mjs`, `engine/newsIngest.mjs` (deterministic ids, license gate, allowlist projection), `app/pages/news/index.vue`, `server/api/v1/news/index.get.ts`, `tests/news.test.ts` |
| C | Event clusters, entities, calendar | **done** | clustering + `MarketEvent` in `engine/newsEvents.mjs` / `engine/models/marketEvent.mjs`, `app/pages/news/events.vue`, `server/api/v1/news/events/*`; projected economic calendar in `engine/macro.mjs` + `server/api/v1/calendar/*`; story clusters folded into `MarketEvent` by decision (G6) |
| D | Evidence-backed summaries + outlook v1 | done | `engine/newsAssess.mjs`, `engine/newsExtractLlm.mjs`, `engine/outlook.mjs`, `app/pages/outlook.vue`, `server/api/v1/outlook/index.get.ts`, `tests/newsOutlook.test.ts` |
| E | Research evaluation + agent integration | done | `engine/newsEvidenceSet.mjs`, `engine/newsScorecard.mjs`, `app/pages/data-research/research/news-impact.vue`, `server/api/v1/research/news-evaluations/*`, `server/api/v1/research/news-evidence/freeze.post.ts`, `tests/newsResearch.test.ts` |
| F | Expand coverage + harden operations | **done** | resilience (`engine/newsFetch.mjs`) + §60.15 guards, dead letters, domain events; adversarial tests `tests/newsHardening.test.ts`; coverage grown to 12 feed sources spanning crypto/macro/equities/commodities — see §0 (G5) |

### 3.2 Code gaps, most consequential first

**G1 — News TTL can destroy the evidence that frozen research sets cite.**
`engine/models/newsItem.mjs` puts an unconditional TTL on `ingestedAt`
(`NEWS_RETENTION_SECONDS`, 7 days, mirrored from the license matrix), while
`engine/newsEvidenceSet.mjs` freezes `itemIds` and hashes into
`NewsEvidenceSet`. After 7 days the cited items are gone, so the frozen set
becomes unreproducible — exactly what §60.11 forbids: "Do not TTL-delete
records still required by an active experiment, trading-session audit, legal
hold or reproducibility rule; use an explicit retention exception policy."
Severity: highest of the news gaps — it silently breaks the §59.11/§60.13
reproducibility promise that Slice E was built to make.
Fix shapes: (a) exempt ids referenced by a frozen `NewsEvidenceSet`/session
decision (retention exception collection or a `pinnedUntil` field reset by the
freeze path), or (b) snapshot the rights-safe metadata (title, source, times,
hash, canonical URL — never full text) into the set at freeze time so the set
is self-contained. (b) is simpler and immune to ordering mistakes.

**G2 — No economic/corporate calendar exists.**
`engine/models/macroCalendarEvent.mjs` is defined and referenced by nothing
(no writer, no API, no UI). §60.7 requires scheduled central-bank decisions,
macro releases, earnings, corporate actions and exchange/regulatory dates.
`services/macro.mjs` writes only `MacroSeries` + `MacroObservation` (FRED
vintages). `/calendar` is not a page: it 301-redirects to `/markets/calendar`
(`server/utils/legacy-redirect.ts`), and `/markets/calendar` is the **news**
calendar (`app/pages/markets/calendar.vue`, `app/utils/calendar.ts`). There is
no `GET /api/v1/calendar`.
Note the chicken-and-egg: a release *schedule* needs no license to know that
FOMC meets on a date; only the consensus/actual values carry rights. That makes
a calendar the cheapest remaining §60 slice.

**G3 — The connector path has a timeout and health, but no resilience.**
§60.5 requires "bounded retries, exponential backoff with jitter,
provider-specific rate limits, request timeouts, circuit breakers, per-source
health and a dead-letter/review queue for malformed records". Implemented:
`AbortSignal.timeout` per request and per-source health (`services/news.mjs`,
`services/newsStore.mjs`). Missing: retry/backoff, 429/5xx handling, circuit
breaker, dead-letter queue for malformed payloads. Today a source that starts
answering 429 every cycle is retried at the same cadence forever and shows up
only as a health row.

**G4 (route drift, tracked as a code+doc gap) — `/intel` no longer exists.**
§60.2 says "Keep the existing route as the main intelligence hub; add
links/cards to News Desk, Outlook and Calendar". `/intel` now redirects to
`/markets`; `app/composables/useIntel.ts` and `app/components/trading/TradeIntel.vue`
are consumed inside the Markets surfaces. Either add the cross-links on the
Markets hub or amend §60.2 (see R4). As written the roadmap describes a page
that does not exist.

**G5 — Coverage stops at the crypto/Fed pilot: 4 of 7 §60.3 market groups have
no connector.**
`PILOT_SOURCES` = CoinDesk, Cointelegraph, Decrypt, CryptoPanic (crypto) and
Federal Reserve press releases (macro/central banks), plus FRED for series.
No Global Equities, no Vietnam Equities, no FX/Gold/Rates/Commodities
connector, no SEC EDGAR, no ECB, no Vietnam SSC/HOSE/HNX/NSO/SBV, no corporate
actions or earnings source. §60.3 declares those groups first-class and §60.16
Slice F makes expansion a requirement. The taxonomy and rights matrix already
exist, so this is connector work, not design work.

> **Status (2026-10-17): closed.** 12 feeds now span all five pilot groups
> (SEC EDGAR, ECB, 4 BLS releases, EIA, VnExpress) — see §0 (G5). Residual:
> a dedicated FX/gold feed and corporate-actions/earnings remain unwired.

**G6 — Two §60.11 entities are missing and one convergence is undocumented.**

| §60.11 entity | Reality |
|---|---|
| `NewsItemRevision` | Not implemented. Corrections are a **status** on the item (`engine/models/newsItem.mjs`), so a materially changed headline/body/number does not preserve "what was previously known" as §60.11 requires. |
| `ImpactAssessment` | Not implemented as a collection. §60.9's impact model survives only as `impactConfidence` (`engine/newsAssess.mjs`, `engine/models/newsAssessment.mjs`) plus outlook scenarios. Cross-asset propagation with supporting/contrary observations has no home. |
| `NewsStoryCluster` | **Deliberately folded into `MarketEvent`** (`engine/newsEvents.mjs`, `engine/models/marketEvent.mjs`) — a reasonable convergence (one event, many source items) but nowhere recorded in the roadmap, so §60.12's `GET news/clusters/:id` looks like a missing feature rather than a resolved design choice. |

**G7 — §60.17 connector and evidence tests are thinner than the roadmap asks.**
Covered: idempotent re-ingest, near-duplicate collapsing, license gating,
allowlist projection, display revocation, crash-restart convergence, alert
dedupe, review gates, PIT exclusion of future items, macro vintage pinning,
scorecard-vs-baseline (`tests/news.test.ts`, `tests/newsSources.test.ts`,
`tests/newsOps.test.ts`, `tests/newsMacroExtract.test.ts`,
`tests/newsResearch.test.ts`, `tests/newsOutlook.test.ts`).
Not covered: auth/timeout/**429/5xx**/backoff behaviour, malformed XML/HTML and
oversized payloads, SSRF/redirect handling, and **adversarial** prompt
injection (the existing check asserts the prompt *contains* the
ignore-instructions rule — a prompt-shape assertion, not a hostile-input test).

**G8 — §60.5 translation layer is absent by design.**
`engine/models/newsItem.mjs` states plainly: original language preserved, "no
translation at rest". §60.5 requires machine translations stored as derived
fields with model/version metadata for Vietnamese and English. With an
English-only pilot this is latent, but the moment a Vietnam source is added
(G5) the roadmap's rule and the code's rule collide. Decide once: either build
the derived-translation field or amend §60.5.

**G9 — §60.12 API surface differs from the shipped one.** Shipped: news list,
news sources list/detail/patch/validate, news events list/detail, outlook list,
research news-evaluations, news-evidence freeze, experiment news-evidence.
Absent from the roadmap's list but shipped: nothing important. Absent from code
but listed in the roadmap: single-item fetch, cluster detail, explicit
source enable/disable (folded into PATCH), ingestion retry, outlook detail by
id, a governed `outlook/generate` job, `news-impact/run`, and the whole
`/api/v1/calendar` family (G2). The roadmap explicitly allows reconciliation
("exact paths should be reconciled with existing APIs before implementation"),
so this is a documentation task, not a defect — but it must be done before the
next agent reads §60.12 as a to-do list.

**G10 — §60.12 internal domain events are not emitted at all.**
No `news.item.ingested`, `news.item.corrected`, `news.item.retracted`,
`news.source.degraded`, `macro.release.revised` or `outlook.snapshot.expired`
appears anywhere in `engine/`, `server/` or `services/`. §60.12 states the
consequence directly: "A correction/retraction must reach derived outlooks and
active research views; do not silently leave an old outlook presented as
current." Today an outlook is protected only by its own expiry. A retraction of
a source item can leave a fresh-looking outlook standing.

---

## 4. Roadmap document repairs (R-list)

**R1 — §54's V3 completion checklist is entirely unchecked.** Every box under
Market / Indicator / Terminal / Simulation / Research / Safety is `[ ]` while
the majority are demonstrably shipped. A reader cannot tell it is stale. Either
check the boxes with pointers to the proving artifact, or replace the chapter
with a one-line pointer to the §59/§60 slice tables. Do not leave a
call-to-action list that is 90% wrong.

**R2 — §45's phase markers are stale and the lock symbol is undefined.** 7A–7G
carry 🔒, 7H and 8–13 carry nothing, and there is no legend for 🔒 and no phase
row for anything V3.4/V3.5 added (§59, §60). Either define 🔒 and mark it
consistently, or add a status column and a short legend.

**R3 — §56's Status Note has no counterpart for §60.** §56 instructs the
author to record "status / completion date / tests / acceptance evidence /
known limitations / migration notes". §59 got that treatment outside the
roadmap; §60 got none. Add a §60 status section (or a `news-*` audit doc in the
same shape as the §59 audit) so the document the user reads first is not the
one document that does not know what shipped.

**R4 — §60.2 and §60.12 route names must be reconciled with the IA that
actually shipped.** §58.2 is the navigation authority and `tests/nav-contracts.test.ts`
is the enforced contract. Shipped canonical paths: `/news`, `/news/events`,
`/news/sources`, `/outlook`, `/markets/calendar`, `/data-research/research/news-impact`,
`/alerts/*`, `/admin-system/data-sources`. The roadmap still proposes
`/calendar`, `/intel`, `/research/news-impact`. Fix the table; keep the
proposals that are genuinely future (an economic calendar is a new page, so
name it once §60.7 is implemented).

**R5 — three generations of menu spec coexist; mark the superseded one.** §57,
§58 and §59.2 each define a sidebar. §58.2 won. Mark §57 explicitly as
superseded (or move it to `docs/web-app/archive/`, which already holds v1–v3.4)
so an agent cannot implement an older menu by accident. The same applies to
§45's phased plan versus §59.15/§60.16's slice plan — say which plan is
current.

**R6 — the document is a single 6,700-line file.** Six generations in one file
is why R1/R2/R5 exist. Minimum viable fix: a short "document map + authority
order + current status" block near the top (the precedence note is there; the
status and the supersession list are not). Long term: split by authority
generation under `docs/web-app/` with the V3.5 file as an index.

---

## 5. Prioritized recommendation

> **Superseded by §0 (2026-10-17).** Items 1–5, 7 and 8 below are closed; the
> remaining work is item 8 (source coverage, now the top of the queue), item 9's
> entity convergence, and the §59/§60 edges named in §0. The ordering rationale
> is kept because it still explains *why* a gap was ranked where it was.

Ordered by (risk removed ÷ effort), with the reason this order and not another:

1. **G1** — TTL vs frozen evidence sets. Silent, time-delayed corruption of
   research reproducibility; small fix; the only gap here that damages data
   already in the database.
2. **G8.1 (kill-switch → session halt)** — the highest-risk of the §59 open
   edges; a frozen gate with a `running` session is a split-brain an operator
   will misread.
3. **R1 + R3 + R4** — repair the document the next agent reads first. Cheap,
   and every later item is cheaper once the roadmap stops lying about status
   and routes.
4. **G3** — connector retry/backoff/429/circuit-breaker + dead-letter queue,
   with the §60.17 connector tests (G7) written alongside. This is Slice F's
   real content and the precondition for trusting any wider source expansion.
5. **G2** — economic/corporate calendar, starting with the schedule-only
   Fed/ECB/BLS releases and FRED vintages already collected; it rescues the
   orphaned `MacroCalendarEvent` model and closes §60 slice C.
6. **G8.2, G8.4** — WS monitor into the §35 gate; standalone heartbeat
   alerter.
7. **G10** — news domain events (correction/retraction reaching outlooks and
   research views).
8. **G5, then G8** — coverage expansion per market group (2026-10-17: all five
   pilot groups now have a source, 12 feeds — see §0 (G5); residual is a
   dedicated FX/gold feed, an official Vietnam connector and corporate actions);
   decide the translation rule before the first non-English source lands.
9. **G6, R2, R5, R6** — entity/model convergence records and structural doc
   hygiene. Real, but the cheapest to defer and the most expensive to do while
   the higher items are still open.

Nothing in this list requires a new architectural decision; every item is
already described in §59 or §60.
