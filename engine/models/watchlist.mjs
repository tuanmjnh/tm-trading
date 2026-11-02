// engine/models/watchlist.mjs
// Named watchlists (S8 chunk 1). One row per named list, owned by a hub user
// (`ownerId = sub`). The default list is the one the trading panel reads;
// additional lists are user-created and switchable from the Lists tab.
//
// Tenancy (docs/web-app/user-tenancy-plan.md): `ownerId` is the hub user id, never
// an `account` — an account is a sub-book inside one owner, so two owners can
// share a list name without colliding. The per-owner name index enforces that
// uniqueness server-side (a duplicate name returns 409, never a silent dup).
import mongoose from 'mongoose'

const WatchlistSchema = new mongoose.Schema(
  {
    // Tenancy (roadmap §61.3): the hub user id that owns this list.
    ownerId: { type: String, default: null, index: true },
    // Display name. Case-insensitive unique per owner (collation below).
    name: { type: String, required: true, trim: true },
    // Ordered, uppercase symbol strings (BTCUSDT, ETHUSDT, ...). De-duplicated
    // in order of first appearance on write; the UI never shows dupes. The array
    // order IS the canonical order; `order` is a denormalized hint for UI stability.
    symbols: { type: [String], default: [] },
    // Denormalized UI-stability hint (0-based), mirrors `symbols` order. Written
    // by reorder operations so the trading panel keeps a stable row layout even
    // when the server re-sorts or re-indexes the array.
    order: { type: Number, default: 0 },
    // Exactly one default per owner. The trading panel reads this list; it is
    // the seed target when migrating the legacy localStorage blob (S8).
    isDefault: { type: Boolean, default: false, index: true },
    // Chunk 3: hub user ids this list is shared WITH. A shared list is read-only
    // for the recipient by default; the owner keeps full control (rename, delete,
    // setDefault, share/unshare). Recipients can edit the symbol set.
    sharedWith: { type: [String], default: [], index: true },
  },
  { timestamps: true, collection: 'watchlists' },
)

// Per-owner lookup by name (case-insensitive), so "My List" and "my list" are
// the same list for the same owner. The collation makes the index case-fold;
// the unique flag is what makes a duplicate name a 409 instead of a silent dup.
WatchlistSchema.index(
  { ownerId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 1 } },
)
// Default list is the hot path for /trading; keep it at the top of the index.
WatchlistSchema.index({ ownerId: 1, isDefault: 1, updatedAt: -1 })

export const Watchlist = mongoose.models.watchlists || mongoose.model('watchlists', WatchlistSchema)