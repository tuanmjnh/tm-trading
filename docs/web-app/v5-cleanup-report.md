# TM Trading V5.0 — Cleanup Report

> Branch: `refactor/central-intelligence-dashboard-v5`
> Starting SHA: `f8a6edc01f2a21f451f9d8bc32f03f08b3fbcf68` (`docs: add V5 repository baseline and cleanup inventory`)
> Working tree at start: clean, except one untracked Windows artifact `nul`.

## 1. Deleted files

Every deletion below was preceded by a reference scan:
`grep -rn "<path>" --include='*' .` (excluding `node_modules`, `.git`) plus a check of
`package.json` scripts, `tests/`, `tools/`, and `docs/`.

| Path | Why it was safe | Evidence |
|---|---|---|
| `nuxt.config.bak.txt` | Manual backup of a config that predates the current `nuxt.config.ts`; never read by code or scripts | No reference anywhere except the V5 baseline inventory |
| `tools/tmp-bot-create.mjs` | One-off script that created a live bot instance and enqueued a start command; execution surface retired by V5.0 §1 | Referenced only by the baseline inventory |
| `tools/tmp-inspect-bot-data.mjs` | One-off inspection helper for bot data | Same |
| `tools/tmp-params.json` | Literal `{"pivLen":10}` scratch input for the deleted script | Same |
| `tools/tmp-proposal.json` | Frozen scratch research-proposal payload; the real store is `/api/v1/research/proposals` | Same |
| `nul` (untracked) | Windows redirection artifact, 46 bytes, not a source file | `git status` showed it as untracked |

`tools/docs-check.mjs` gained an exception block for these five paths because the
baseline inventory and this report cite them as deletion records. The check remains
strict for every live path.

## 2. Not deleted, on purpose

| Candidate | Decision | Reason |
|---|---|---|
| `exec/` (risk, drift, paper, exchange demo) | **QUARANTINE** | `server/utils/orders.ts`, `positionActions.ts`, `replayBroker.ts`, `aiAgents.ts` still import `exec/risk.mjs` / `exec/paper.mjs`. The routes are unreachable from the UI (redirect) but the code path exists; deleting requires a data/test review (V5.0 §9.4) |
| `simulation/` | KEEP | Test suite `test:simulation` (232 assertions) and replay broker depend on it |
| `app/pages/trading/*`, `app/components/trading/*` | KEEP (unrouted) | Rollback path; V5.0 §2 "do not delete page files in the first migration pass" |
| `app/pages/operations.vue` (2494 lines) | KEEP | Still the source of the detailed service drill-down; route redirects to the Control Center |
| Legacy dashboard page content (risk cards, bot sessions, proposals, backtest runs) | REMOVED FROM THE PAGE, code kept | `app/pages/index.vue` was rewritten; the APIs and composables (`useRisk`, `useBots`, `useResearch`, `useRuns`) remain in use by their own pages |
| `pine/dist` | KEEP (generated) | Also flagged in the earlier git status sweep; it is build output, not a duplicate source tree |
| Duplicate confirm-modal wrappers | NOT MERGED | Behaviour differs per consumer; V5.0 §3 requires consumer-test parity first |

## 3. Dependencies

No dependency was added or removed.

Rationale: the Dashboard was built from packages already installed and already used
(`@nuxt/ui`, `@vueuse/core`, `zod`, `date-fns`). Removing anything would have required
an import/build scan across 190 API routes and 127 components with no measured benefit,
and V5.0 §9.8 only authorises removal after such a scan proves the package is unused.

## 4. Package manager

**Decision: `pnpm` is canonical.** Evidence:

| Signal | Value |
|---|---|
| Lockfile present | `pnpm-lock.yaml` (lockfileVersion 9.0); no `package-lock.json` |
| Workspace file | `pnpm-workspace.yaml` with pnpm 11+ semantics (`allowBuilds`, `minimumReleaseAgeExclude`) |
| Installed tree | `node_modules/.pnpm/` + `node_modules/.modules.yaml` (pnpm layout) |
| `.npmrc` | pnpm-specific keys (`shamefully-hoist`, `only-built-dependencies`) |
| Prior decision | Comment in `pnpm-workspace.yaml`: moved from npm to pnpm on 2026-10-03 |
| pnpm version installed | 12.15.0 |

Changes: `package.json` now declares `"packageManager": "pnpm@12.15.0"`. `AGENTS.md`,
`.agents/AGENTS.md` and `README.md` state the pnpm lockfile as the installed state.
No lockfile was deleted, and no second lockfile was introduced. `npm run <script>`
examples were left in place because npm executes the same scripts; the install command
was corrected to `pnpm install`.

## 5. Security fixes in this pass

| Fix | File | Before | After |
|---|---|---|---|
| Wildcard CORS on every API route | `nuxt.config.ts` (`nitro.routeRules['/api/**']`) | `Access-Control-Allow-Origin: *` baked in, plus `cors: true` | Route-rule CORS removed; CORS is owned by `server/middleware/api-guards.ts` |
| CORS allow-list | `server/middleware/api-guards.ts` | Empty list → `*` for everyone, including production | Explicit origins from flags + `API_ALLOWED_ORIGINS`; same-origin always allowed; production with an empty list is same-origin only; wildcard credentials never combined with `*` |
| Weak JWT fallback | `nuxt.config.ts` | `AUTH_JWT_SECRET \|\| 'super-secure-shared-secret-key-32-chars-min'` | Placeholder only when `NODE_ENV !== 'production'`; production with neither `AUTH_JWT_SECRET` nor `AUTH_JWT_PUBLIC_KEYS` logs a security error and rejects tokens (fail closed) |
| Secret exposure in the Dashboard | new Control Center | — | Provider keys are read through the existing masked projection (`secretMask`); no full secret is ever requested by the UI |

Not changed: secret rotation (no deployment config was inspected or touched), Hub
permission model, and existing server-side capability checks.

## 6. Documentation and config changes

| File | Change |
|---|---|
| `docs/web-app/v5-route-migration-map.md` | NEW — every route disposition, redirects, deep-link contract |
| `docs/web-app/v5-component-disposition.md` | NEW — component-level KEEP/MERGE/HIDDEN/ARCHIVE |
| `docs/web-app/v5-service-runtime-map.md` | NEW — supervisor ownership, embedded/kill-switch state, freshness contract |
| `docs/web-app/v5-cleanup-report.md` | NEW — this file |
| `docs/web-app/v5-baseline-inventory.md` | UPDATED §11 with the implementation pass result |
| `app/utils/navTree.ts` | `DASHBOARD_REPLACED_PREFIXES` + hidden-prefix filter |
| `app/composables/useNavMenu.ts` | Passes the hidden prefixes to `selectNavRoutes` |
| `server/utils/legacy-redirect.ts` | `keepRest` flag; execution subtree retired; `/operations` → Control Center |
| `i18n/locales/{en,vi}.json` | New `dash.*` namespace (197 keys per locale) + the missing `signals.lifecycle_closed` key |

## 7. Pre-existing defects found (not caused by this pass)

| Defect | Evidence | Handling |
|---|---|---|
| `signals.lifecycle_closed` key missing in both locales, used by `app/pages/trading/signals.vue` | `node tests/run-tests.mjs` failed on `tests/i18n-keys.test.ts` before any Dashboard work touched that page | Fixed by adding the key to both locales (translation, not a test edit) |
| `tests/legacy-redirect.test.ts` assumed every redirect target is a bare path | Would reject the supported `/?panel=control&section=services` target | Test now resolves the path before the query; assertion strength unchanged |
| Duplicate type imports in `shared/types/permission.ts` vs `server/types/permission.ts` | `nuxt prepare` warns every run | Out of scope; recorded for a follow-up |

## 8. Rollback

- Deleted files: `git checkout <sha> -- nuxt.config.bak.txt tools/tmp-*.mjs tools/tmp-params.json tools/tmp-proposal.json`.
- Config: revert `nuxt.config.ts` and `server/middleware/api-guards.ts`; the wildcard
  CORS returns with them.
- Routes/menus: revert `server/utils/legacy-redirect.ts` and `app/utils/navTree.ts`.
- Dashboard: revert `app/pages/index.vue` and delete `app/components/dashboard/*` +
  the two new composables. No data migration was performed, so there is nothing to
  unwind in the database.
