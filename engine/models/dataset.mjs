// engine/models/dataset.mjs
// Dataset retention manifest (roadmap v3 §23.4 — "Every raw dataset must
// declare: retention, compression, schemaVersion, source, start/end, checksum").
//
// One row per recorded dataset (kind×source×symbol×timeframe). It is updated
// idempotently by the recorder as new rows land ($min/$max/$inc). `checksum` is
// declared and stays null while the dataset is a live append stream — a TRUE
// whole-dataset checksum only exists after an offline reconcile (§24), which
// will backfill it. Never fabricate a fake checksum (D12).
import mongoose from 'mongoose'

import { DATASET_SCHEMA_VERSION } from '../../market/recorder.mjs'

const DatasetSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // `${kind}:${source}:${symbol}:${timeframe}`
    // Explicit indexed copy of the manifest key: recorder/retention/reconcile
    // all query docs BY datasetId, and `strictQuery: true` (engine/db.mjs)
    // silently STRIPS unknown filter paths — an unlisted field here would turn
    // `{datasetId}` into `{}` and hit the WRONG dataset (data corruption).
    datasetId: { type: String, required: true, index: true },
    kind: { type: String, required: true }, // 'candles' | ...
    source: { type: String, default: null },
    symbol: { type: String, default: null },
    timeframe: { type: String, default: null },

    schemaVersion: { type: String, default: DATASET_SCHEMA_VERSION }, // D1 stamp
    retentionDays: { type: Number, default: 90 },
    compression: { type: String, enum: ['none', 'parquet', 'zst'], default: 'none' },
    checksum: { type: String, default: null }, // null until offline reconcile (§24)

    startTs: { type: Number, default: null },
    endTs: { type: Number, default: null },
    count: { type: Number, default: 0 },

    // §24.2 reconciliation state — written by services/reconcile.mjs, read by
    // every consumer that trusts this dataset (backtest, replay, AI training).
    lastReconcileAt: { type: Date, default: null },
    lastReconcile: { type: mongoose.Schema.Types.Mixed, default: null }, // {verdict, checked, matched, mismatches, missingLocal, missingVenue}
    suspect: { type: Boolean, default: false }, // verdict suspect/gap -> derived data must be invalidated
  },
  { timestamps: true, collection: 'datasets' },
)

DatasetSchema.index({ kind: 1, source: 1, symbol: 1, timeframe: 1 })

export const Dataset = mongoose.models.datasets || mongoose.model('datasets', DatasetSchema)