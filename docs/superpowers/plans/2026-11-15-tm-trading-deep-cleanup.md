# TM Trading V5.0 — Deep Cleanup & Operation Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate legacy path anomalies, standardize Nuxt 4 alias mappings (`#shared/`), enforce the admin toolbar/filter UX standard, and verify runtime operational isolation.

**Architecture:**
- Move shared utilities from legacy `app/shared/` to `<rootDir>/shared/utils/` and app-only types to `app/types/`.
- Replace all legacy `~/shared/...` and `~~/shared/...` imports with canonical Nuxt 4 `#shared/...` aliases.
- Delete stale and duplicate `app/shared/` tree.
- Standardize admin pages (`permissions.vue`, `logs.vue`, `docs.vue`, `configs.vue`) to strictly adhere to the `AdminFilterPopover` & `SharedListFooter` rules.
- Run complete verification: typecheck (4/4 projects), 18 test suites (2509+ tests), 7/7 supervisor drills, and CSS check.

**Tech Stack:**
- Nuxt 4 (SPA mode)
- Nitro Server
- `@nuxt/ui` v4, Tailwind CSS v4
- `@tuanmjnh/tm-ui`
- TypeScript 5.7+

**Spec:** `docs/web-app/v5-service-runtime-map.md`, `docs/web-app/v5-cleanup-report.md`, and global AGENTS.md rules.

## Global Constraints

- Never use `~/server` or `@/server`.
- Frontend (`app/`) must NEVER import from `server/`.
- Server (`server/`) must NEVER import from `app/`.
- Shared code must reside in `<rootDir>/shared/` and be imported via `#shared/...`.
- No root-level `types/` folder; app-only types in `app/types/`, shared in `shared/types/`.
- Primary search `UInput` must ALWAYS be in `#left` of `UDashboardToolbar`.
- `<AdminFilterPopover>` must ALWAYS be placed on `#right` of `UDashboardToolbar`.
- Pass `popover` prop when there is more than 1 secondary filter.
- Do NOT place item count badges on top toolbar `#right`; place in `#footer` using `<SharedListFooter>`.
- Zero test regressions: all 2509 tests and 7/7 drills must pass.

## Review Focus

1. **Broken Aliases**: Ensure `#shared/utils/errors` and `#shared/utils/helper` resolve identically in TypeScript and Vite build.
2. **Component Slots**: Ensure `UDashboardToolbar` on modified admin pages correctly renders search on left and filter popover on right.
3. **No Uncaught Stale References**: Ensure no residual `~/shared/` references exist in any `.vue` or `.ts` file.
4. **CSS Integrity**: Ensure `check-tmui-css.mjs` continues to report 49/49 classes present and 0 missing.
5. **Supervisor Stability**: Ensure `pnpm run drills` passes 7/7 with no timeout or lingering worker processes.

---

### Task 1: Migrate Shared Utilities and Types to Canonical Locations

**Files:**
- Move: `app/shared/utils/errors.ts` -> `shared/utils/errors.ts`
- Move: `app/shared/utils/helper.ts` -> `app/utils/helper.ts` (app-specific with DOM/i18n)
- Move: `app/shared/utils/constants.ts` -> `shared/utils/constants.ts`
- Move: `app/shared/types/cloudinary.d.ts` -> `app/types/cloudinary.d.ts`
- Remove: `app/shared/google/` (obsolete duplicate of `shared/google/`)
- Remove: `app/shared/` directory

**Steps:**
- [x] Copy `errors.ts`, `constants.ts` to `shared/utils/`, and `helper.ts` to `app/utils/`.
- [x] Move `app/shared/types/cloudinary.d.ts` to `app/types/cloudinary.d.ts`.
- [x] Delete `app/shared/` recursively.
- [x] Update imports across `app/`: replace `'~/shared/utils/errors'` with `'#shared/utils/errors'`, `'~/shared/utils/helper'` with `'~/utils/helper'`, `'~/shared/utils/constants'` with `'#shared/utils/constants'`.
- [x] Update imports across `app/`: replace `'~~/shared/utils/compare'` with `'#shared/utils/compare'`, `'~~/shared/utils/hubEnv'` with `'#shared/utils/hubEnv'`.
- [x] Run `npx nuxi prepare` to refresh `#shared/` virtual paths.
- [x] Run `node tools/typecheck.mjs` and verify all 4 projects pass.
- [x] Commit: `refactor(shared): consolidate shared utils to root shared directory and adopt #shared alias` (`cd5f437`).

---

### Task 2: Standardize Admin Toolbars, Filters & Footers

**Files:**
- Modify: `app/pages/admin-system/permissions.vue`
- Modify: `app/pages/admin-system/logs.vue`
- Modify: `app/pages/admin-system/docs.vue`
- Modify: `app/pages/admin-system/configs.vue`

**Steps:**
- [x] `permissions.vue`: Move `<UInput v-model="search"` from `#right` to `#left` of `UDashboardToolbar`. Keep `#right` empty or for auxiliary actions.
- [x] `logs.vue`: Add search `UInput` on `#left` of `UDashboardToolbar`; move `<AdminFilterPopover>` to `#right` slot alongside `<AdminViewModeToggle>`. Wrap action filter with label inside popover.
- [x] `docs.vue`: Remove `<UBadge :label="t('docs.endpointsCount'..."` from `#right` toolbar. Move `USelect` (module filter) into `<AdminFilterPopover>` on `#right`. Ensure `<SharedListFooter>` in `#footer` carries the endpoint summary.
- [x] `configs.vue`: Replace raw `<div class="flex items-center gap-2 px-4 pb-3 flex-wrap">` with `<UDashboardToolbar>`. Place `<UInput v-model="search"` in `#left`. Place `<AdminFilterPopover>` with category filter in `#right`. Remove inline count badge from toolbar and add `<SharedListFooter :count="displayItems.length" />` in `#footer`.
- [x] Run `node tools/typecheck.mjs` to verify template and script types pass.
- [x] Commit: `fix(admin): standardize toolbars, filters, and list footers across admin-system pages` (`c225693`).

---

### Task 3: Runtime State Hygiene & End-to-End Verification

**Files:**
- Verify: `services/supervisorStore.mjs` & `data/run/`
- Verify: `server/utils/legacy-redirect.ts`
- Verify: `.gitignore`

**Steps:**
- [x] Confirm `.gitignore` properly ignores temporary runtime artifacts (`logs/*.json`, `logs/*.ndjson`, `data/run/*.pid`).
- [x] Run `node ../tm-platform/scripts/check-tmui-css.mjs .` to confirm 50/50 CSS classes present.
- [x] Run `pnpm test` (all 18 suites: 2509 pass, 0 fail).
- [x] Run `pnpm run drills` (all 7 supervisor drills pass in 25s).
- [x] Verify working tree is 100% clean.
