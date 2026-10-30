import mongoose from 'mongoose'

// =============================================================================
//  VenuePreference (roadmap §64.4) — a user-scoped choice of preferred DEMO
//  execution venue + backup order + failover policy. One doc per (owner, account).
//
//  Invariants enforced by the store (exec/exchange/venuePreferenceStore.mjs):
//   - executionEnvironment is ALWAYS 'DEMO' (no production/mainnet selection).
//   - executionSwitchPolicy is ALWAYS 'MANUAL_NEW_SESSION_ONLY' (§64.5B) — an
//     active session never auto-switches execution venue.
//   - marketDataPolicy is PREFERRED_ONLY (default, safest) or
//     ALLOW_REFERENCE_FAILOVER (labelled reference fallback only).
// =============================================================================

export const MARKET_DATA_POLICIES = Object.freeze(['PREFERRED_ONLY', 'ALLOW_REFERENCE_FAILOVER'])
export const EXECUTION_SWITCH_POLICIES = Object.freeze(['MANUAL_NEW_SESSION_ONLY'])
export const PREFERENCE_VENUES = Object.freeze(['bybit', 'binance', 'okx'])

const VenuePreferenceSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${ownerId}:${accountId}`
  ownerId: { type: String, required: true, index: true },
  accountId: { type: String, default: 'default' },
  preferredVenue: { type: String, enum: [...PREFERENCE_VENUES], required: true },
  executionEnvironment: { type: String, enum: ['DEMO'], default: 'DEMO' },
  marketDataPolicy: { type: String, enum: [...MARKET_DATA_POLICIES], default: 'PREFERRED_ONLY' },
  marketDataFallbackOrder: { type: [String], default: [] }, // subset/order of PREFERENCE_VENUES
  executionSwitchPolicy: { type: String, enum: [...EXECUTION_SWITCH_POLICIES], default: 'MANUAL_NEW_SESSION_ONLY' },
  // Audited "switch for next session" intent — applied only when a NEW session starts.
  pendingVenueSwitch: {
    targetVenue: { type: String, enum: [...PREFERENCE_VENUES, null], default: null },
    requestedAt: { type: Number, default: null },
    reason: { type: String, default: null },
  },
  schemaVersion: { type: String, default: 'venuePreference.v1' },
}, { timestamps: true, collection: 'venue_preferences' })

VenuePreferenceSchema.index({ ownerId: 1, accountId: 1 }, { unique: true })

export const VenuePreference = mongoose.models.venue_preferences
  || mongoose.model('venue_preferences', VenuePreferenceSchema)
