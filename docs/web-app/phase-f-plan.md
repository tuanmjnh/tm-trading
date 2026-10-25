# Phase F plan — evidence storage and research feedback

Status: **done (2026-10-20)**. This doc decomposes roadmap §61.17
**Phase F** ("Evidence storage and research feedback",
`tm-trading-roadmap-v3.6.md`) into independently verifiable steps, mirroring how
Phases C, D and E were split.

## Acceptance (from the roadmap)

> Attach market/data/strategy/risk/engine manifests to every run and session.
> Link `Journal`, `NewsEvidencePacket`, `Experiment`, backtest and session
> evidence. Enable AI to analyze completed persisted sessions and create
> experiment drafts. Add baseline-versus-candidate evaluations and strict
> point-in-time controls.
>
> One session can be reconstructed from persisted evidence and the AI analysis
> cites actual record IDs; experiments do not mutate the active strategy.

## What already exists (do not rebuild)

- `engine/evidence.mjs` — pure evidence core: kinds
  (`paper-session|replay-session|backtest-run|dataset`), `buildEvidenceBundle`,
  `evidenceHash`, `freezeEvidenceSet`, `verifyEvidenceSet`,
  `evidenceSufficiency`, `proposalEvidenceLink`, `paperValidationEdge`,
  `candidateIndependence`.
- `server/utils/evidenceSets.ts` — hydration + freeze per source kind, auto-freeze
  on session seal, terminal backfill, owner-scoped list/get/cite, and
  `createPaperValidationSession`.
- `server/utils/research.ts` — proposal validation, experiment creation with
  evidence link enforcement, `report()` comparison + acceptance.
- `engine/experiment.mjs` — `compareArms`, `acceptanceReport`, `armMetrics`,
  `withArm`; `engine/experimentService.mjs` — `persistAiProposal`,
  `persistProposal`, `runArm`, `decide`.
- `engine/journal.mjs` + `models/journal.mjs` — derived trade read model keyed by
  upstream identity (`source` + `sourceId`), `journalKey`, `regimeAt`.
- `engine/models/session.mjs` — `manifest: Mixed` field already present, never
  populated with more than `{account, source}`.

## The gap

1. Sessions and runs carry ad-hoc identity fields, not one versioned manifest, so
   "which engine/strategy/risk/data produced this?" is not answerable from the
   session alone.
2. `session.journalKeys` stays `[]` and nothing joins a session's positions to
   their journal rows; news packets and citing experiments are only reachable by
   unrelated lookups.
3. No path turns a completed session into an AI experiment draft that cites the
   records it actually read.
4. `pointInTime` in a bundle records timestamps but nothing rejects look-ahead;
   baseline-vs-candidate identity is not enforced.

## Steps

### F1 — Versioned manifests (pure core + wiring)

- `engine/manifest.mjs`: `MANIFEST_SCHEMA_VERSION = 'manifest.v1'`,
  `MANIFEST_SECTIONS`, `buildManifest({...})` → normalized `{schema, engine,
  strategy, risk, data, scope, createdAt}` plus `gaps[]`, `manifestFingerprint`
  (`mf1_` + sha256 of the canonical document), `manifestGaps`, and
  `manifestFromSession`.
- `exec/paper.mjs`: `resolvePaperSession(m, config, { identity })` builds the
  manifest once and creates the session with `strategyVersionId`,
  `botProfileId`, `instruments`, `timeframes` and that manifest.
- `services/botWorker.mjs`: passes the instance identity (instance id, strategy
  version, profile, subscriptions) into `resolvePaperSession`.
- `engine/store.mjs` + `models/run.mjs`: runs persist `manifest` (additive Mixed)
  built from the run stamp (engine version, params hash, data hash, scope).
- `engine/manifest.mjs` stays IO-free; `evidenceSufficiency` gains manifest gaps
  as explicit reasons.

### F2 — Evidence links (Journal, news, experiments, backtests)

- `engine/evidenceGraph.mjs` (pure): `bundleCitations` (set id, order/fill/
  position/journal keys), `linkSummary`, `graphLimitations`, `graphDigest`
  (deterministic, ID-carrying text for AI input).
- `server/utils/evidenceSets.ts`: session hydration also loads journal rows by
  upstream identity and fills `keys.journalKeys`; news packets and citing
  experiments are resolved per owner.
- `server/utils/evidenceGraph.ts`: `getSessionEvidenceGraph(sessionId, …)` →
  `{session, evidenceSet, journal, news, experiments, relatedSets, citations,
  pointInTime, mongo}`; fail-soft reads, owner-scoped.
- `GET /api/v1/sessions/[id]/evidence` returns that graph (the reconstruction
  acceptance check).

### F3 — AI session analysis → experiment draft

- `server/utils/sessionAnalysis.ts`: `analyzeSession(sessionId, …)` requires a
  sealed session and a frozen, hash-intact set; builds the digest; calls the AI
  gateway through an injectable `chat`; validates the proposal with
  `validateProposal`; rejects any citation outside the digest's allowlist
  (`INVALID_CITATION`); persists it as an `ai_proposals` row carrying
  `generation` + `evidenceSetId` — never an experiment, never a strategy write.
- `POST /api/v1/research/evidence-sets/[id]/analysis` returns the draft and the
  record ids it cites; `503 ai_unconfigured` when the gateway has no key.
- The existing `POST /api/v1/research/experiments` flow stays the only way a
  draft becomes an experiment, and it still refuses to mutate the active
  strategy.

### F4 — Baseline vs candidate + strict point-in-time

- `engine/pointInTime.mjs` (pure): `pitAudit({bundle, journal, news, asOf})`
  flags records stamped after the session stopped / the freeze moment, and news
  packets published after the decision they justify; `pitStrict` is the policy
  switch, on by default for frozen sets.
- `evidenceSufficiency` includes PIT violations; the graph endpoint reports them
  next to limitations.
- `compareArms`/`acceptanceReport` gain a baseline-identity guard: an experiment
  whose candidate equals its baseline, or whose baseline arm is missing, cannot
  be accepted.

### F5 — Tests and docs

- `tests/manifest.test.ts`, `tests/evidenceGraph.test.ts`,
  `tests/pointInTime.test.ts`, `tests/sessionAnalysis.test.ts` (offline,
  injected AI + models).
- `engine/test-db.mjs` §15: session with manifest → orders/fills/positions →
  journal → freeze → reconstruct graph → AI draft with verified citations →
  experiment created → active profile untouched.
- Update `implementation-tracker.md`, roadmap §61.17 Phase F, and
  `system-integration-map.md`.

## Results (2026-10-20)

- Offline: `tests/manifest.test.ts` 12, `tests/evidenceGraph.test.ts` 8,
  `tests/pointInTime.test.ts` 9, `tests/sessionAnalysis.test.ts` 12,
  `tests/evidence.test.ts` 51, `tests/experiment.test.ts` 18 — all green.
- Integration: `engine/test-db.mjs` §15 (18 checks) proves manifest → sealed
  session → 22-trade frozen set (hash re-verified) → journal/news/experiment
  links → deterministic digest + citation allowlist → `ai_proposals` draft with
  `evidenceSetId` + citations → `proposed` experiment; a candidate equal to its
  baseline fails the `independentArms` gate. Full run: 156 pass, 0 fail.
- A real crash was fixed while proving the acceptance gate: `acceptanceReport`
  compared `candidate?.expectancyR !== null` and then dereferenced `null` for a
  draft with no arms. All gates now treat `null` and `undefined` as "not
  recorded" (`!= null`).

## Deliberate limits

- Manifests describe identity, not provenance guarantees: a manifest records
  what the producer declared; `manifestGaps` lists what it could not.
- AI analysis is advisory only: it writes an `ai_proposals` row, and the
  experiment path still requires the evidence-link check.
- Point-in-time checks use persisted timestamps; they catch records stamped
  after the fact, not a producer that lied about the clock.
- The known global-key tenancy limitation (`evidence_sets`, `experiments`,
  `ai_proposals`) is unchanged; all reads/writes here are owner-scoped.
