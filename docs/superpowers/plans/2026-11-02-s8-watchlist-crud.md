# S8 — Watchlist CRUD (chunk 1)

**Date:** 2026-11-02
**Status:** IN PROGRESS
**Approach:** A (wrap-not-replace) — keep one default list, add named additional lists.

## Goal

Give the user multiple named watchlists persisted server-side (per `ownerId`), with a
"Lists" tab on `/watchlist` to create / rename / delete / switch between them. The trading
panel keeps showing the default list exactly as it does today (no UX change on `/trading`).

## Scope (chunk 1)

- New mongoose model `engine/models/watchlist.mjs` (collection `watchlists`, per-owner
  compound index on `ownerId + name`, `isDefault` flag, `timestamps: true`).
- New server store `server/utils/watchlists.ts` mirroring `aiAgents.ts`:
  `AgentError`-style `WatchlistError`, `watchlistsHttpError`, fail-soft `listWatchlists`,
  throwing `getWatchlist`, `createWatchlist`, `updateWatchlist`, `deleteWatchlist`.
  Conflict (409) on duplicate name or on deleting the default list; 404 on unknown id.
- New API routes (flat files, mirroring `ai-agents`):
  `server/api/v1/watchlists/index.get.ts`, `index.post.ts`, `[id].get.ts`,
  `[id].patch.ts`, `[id].delete.ts`.
- New shared types `shared/types/watchlist.ts` (`#shared/types/watchlist` alias).
- New composable `app/composables/useWatchlists.ts` (fail-soft reads, throwing writes).
- New page component for the Lists tab.
- Migrate `useTerminalPrefs` watchlist consumers to server lists, seeded once from the
  existing localStorage blob (`watchlist` array) — destructive but pre-approved.
- i18n keys in both `en.json` and `vi.json` (incl. `watchlistWorkspace.tabs.lists`).
- New test `tests/watchlists.test.ts` covering pure/sanitized logic.

## Out of scope (chunk 1)

- Drag-to-reorder on the Lists tab (chunk 2).
- Bulk symbol import / export (chunk 2).
- Sharing watchlists across owners (chunk 3).

## Files to create

| File | Purpose |
|------|---------|
| `shared/types/watchlist.ts` | Item + response wrappers |
| `engine/models/watchlist.mjs` | Mongoose schema + model export |
| `server/utils/watchlists.ts` | Store + error helpers |
| `server/api/v1/watchlists/index.get.ts` | `GET /api/v1/watchlists` |
| `server/api/v1/watchlists/index.post.ts` | `POST /api/v1/watchlists` |
| `server/api/v1/watchlists/[id].get.ts` | `GET /api/v1/watchlists/:id` |
| `server/api/v1/watchlists/[id].patch.ts` | `PATCH /api/v1/watchlists/:id` |
| `server/api/v1/watchlists/[id].delete.ts` | `DELETE /api/v1/watchlists/:id` |
| `app/composables/useWatchlists.ts` | Vue composable |
| `app/components/watchlist/ListsTab.vue` | Lists tab page component |
| `tests/watchlists.test.ts` | Pure/sanitized logic tests |

## Files to modify

| File | Change |
|------|--------|
| `server/utils/engineModel.ts` | Add `watchlistsModel()` resolver |
| `app/composables/useTerminalPrefs.ts` | Keep `watchlist`/`watchlistSeeded` for backward compat; add `seedFromServer` hook consumed at first load |
| `app/components/trading/Watchlist.vue` | Read symbols from server list (default) instead of localStorage |
| `app/components/trading/SymbolSearchModal.vue` | Use server list for add/remove checks |
| `app/pages/watchlist.vue` | Add third `lists` tab to `WorkspaceShell` |
| `i18n/locales/en.json` | New keys |
| `i18n/locales/vi.json` | New keys |

## Gates (all four must be green)

- `npm run verify`
- `npm run test:app`
- `npm run typecheck`
- `npm run docs:check`

## Commit

Single logical commit per chunk; message avoids em dashes. New code/comments in English.