// engine/models/marketFeed.mjs
// Raw market FEED ledger (roadmap §23.3 P1): funding/OI rows (one per funding
// settlement period) and liquidation events, in one append-friendly time-series
// collection (`market_feed`). Trades/orderbook reuse this ledger when their
// streams are wired. `_id` = feedId (natural key, D3), and each row carries its
// own `retentionDays` (§23.4) so the retention sweep honours a per-kind window.
//
// Honesty (D12): eventTime is the feed data's OWN time, ingestTime when WE
// observed it (D16); absent OI etc. stays null — never fabricated.
import mongoose from 'mongoose'

import { FEED_SCHEMA_VERSION } from '../../market/feedRecorder.mjs'

const MarketFeedSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `feed:<kind>:<symbol>:...`
    feedId: { type: String, required: true },
    kind: { type: String, required: true }, // 'funding' | 'liquidation' | ...
    symbol: { type: String, required: true },
    venue: { type: String, default: null },
    market: { type: String, default: null },

    eventTime: { type: Number, required: true }, // D16: feed data's own time
    ingestTime: { type: Number, default: null }, // D16: when WE observed/wrote

    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    retentionDays: { type: Number, default: 90 },
    schemaVersion: { type: String, default: FEED_SCHEMA_VERSION }, // D1
  },
  { timestamps: true, collection: 'market_feed' },
)

MarketFeedSchema.index({ kind: 1, symbol: 1, eventTime: -1 })
MarketFeedSchema.index({ kind: 1, eventTime: -1 })
MarketFeedSchema.index({ eventTime: -1 })

export const MarketFeed = mongoose.models.market_feed || mongoose.model('market_feed', MarketFeedSchema)