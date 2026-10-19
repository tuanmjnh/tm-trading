// engine/models/macroCalendarEvent.mjs
// Scheduled macro releases (V3.5 §60.7 / Slice C): previous/consensus/actual
// with SEPARATE provenance each.
//
// Rows are written by services/macro.mjs from the release CADENCE actually
// observed in the FRED vintages (`engine/macro.mjs` projectNextRelease). Such a
// row is `projected: true` and must be rendered as a projection, not as an
// official schedule — the FOMC/ECB/BLS official calendars are separate licensed
// sources that are still not wired. `consensus` stays null because no licensed
// consensus source exists: an empty consensus is honest, an invented one is not.
// An official row (projected: false) can be upserted by a future connector and
// is never overwritten by a projection ($setOnInsert on the same _id).
import mongoose from 'mongoose'

const ValueSchema = new mongoose.Schema(
  {
    value: { type: Number, default: null },
    sourceId: { type: String, default: null },
    vintageAt: { type: Date, default: null },
  },
  { _id: false },
)

const MacroCalendarEventSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // seriesId|refPeriod|scheduledAt
    seriesId: { type: String, required: true, index: true },
    refPeriod: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    title: { type: String, default: '' },
    marketGroup: { type: String, default: 'macro_cb', index: true },
    kind: {
      type: String,
      enum: ['macro_release', 'central_bank', 'corporate_action', 'earnings', 'exchange_notice'],
      default: 'macro_release',
      index: true,
    },
    importance: { type: String, enum: ['high', 'med', 'low'], default: 'med' },
    projected: { type: Boolean, default: true }, // true = cadence estimate, not an official schedule
    projection: {
      method: { type: String, default: null },
      cadence: { type: String, default: null },
      samples: { type: Number, default: null },
      confidence: { type: String, enum: ['low', 'medium', null], default: 'low' },
    },
    computedAt: { type: Date, default: null },
    sourceId: { type: String, default: null },
    previous: { type: ValueSchema, default: () => ({}) },
    consensus: { type: ValueSchema, default: () => ({}) },
    actual: { type: ValueSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ['scheduled', 'released', 'revised', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: true, collection: 'news_macro_calendar' },
)

MacroCalendarEventSchema.index({ scheduledAt: 1, status: 1 })

export const MacroCalendarEvent =
  mongoose.models.news_macro_calendar || mongoose.model('news_macro_calendar', MacroCalendarEventSchema)
