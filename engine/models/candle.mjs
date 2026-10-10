// engine/models/candle.mjs
// Recorded CLOSED candles (roadmap v3 §23 — "what to record by default" P0).
// One row per closed bar, _id = `${symbol}:${timeframe}:${openTime}` (D3/D4:
// idempotent natural key, so a re-emitted close upserts instead of duplicating).
// Rows are append-only FACTS (D12): a closed candle is final, never rewritten.
// `state` is pinned to 'closed' — forming bars never cross into the binder.
// Consumers of candles for replay/backtest must declare which source they trust
// (§23.4 dataset manifest), because this store is a digest per provider.
import mongoose from 'mongoose'

import { CANDLE_SCHEMA_VERSION } from '../../market/recorder.mjs'

const CandleSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `${symbol}:${timeframe}:${openTime}`
    symbol: { type: String, required: true },
    timeframe: { type: String, required: true },
    market: { type: String, default: null }, // spot|futures|gold (when known)
    source: { type: String, required: true }, // D21 market data source
    state: { type: String, enum: ['closed'], default: 'closed' },

    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, default: 0 },

    openTime: { type: Number, required: true },
    closeTime: { type: Number, required: true },
    eventTime: { type: Number, default: null }, // D16 trading time
    ingestTime: { type: Number, default: null }, // D16 arrival (observability only)

    schemaVersion: { type: String, default: CANDLE_SCHEMA_VERSION }, // D1 stamp
  },
  { timestamps: true, collection: 'candles' },
)

CandleSchema.index({ symbol: 1, timeframe: 1, openTime: -1 })
CandleSchema.index({ openTime: -1 })
CandleSchema.index({ source: 1, openTime: -1 })

export const Candle = mongoose.models.candles || mongoose.model('candles', CandleSchema)