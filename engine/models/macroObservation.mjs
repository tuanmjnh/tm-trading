// engine/models/macroObservation.mjs
// Macro observations with vintage lineage (V3.5 §60 Slice C).
// `_id = seriesId|refPeriod|vintageISO` is DETERMINISTIC (engine/macro.mjs) —
// a revision is a NEW doc, the old vintage is never mutated, so historical
// reads stay reproducible (PIT-safe via observationAsOf).
import mongoose from 'mongoose'

const MacroObservationSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seriesId: { type: String, required: true, index: true },
    refPeriod: { type: String, required: true, index: true },
    value: { type: Number, required: true },
    unit: { type: String, default: '' },
    vintageAt: { type: Date, required: true }, // publication time of THIS vintage
    firstSeenAt: { type: Date, required: true },
    sourceId: { type: String, default: null },
    status: {
      type: String,
      enum: ['actual', 'preliminary', 'revised', 'forecast', 'consensus'],
      default: 'actual',
    },
    hash: { type: String, default: null },
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: false, collection: 'news_macro_observations' },
)

MacroObservationSchema.index({ seriesId: 1, refPeriod: 1, vintageAt: -1 })

export const MacroObservation =
  mongoose.models.news_macro_observations || mongoose.model('news_macro_observations', MacroObservationSchema)
