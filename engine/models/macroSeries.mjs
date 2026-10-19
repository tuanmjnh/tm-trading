// engine/models/macroSeries.mjs
// Canonical macro series identity (V3.5 §60 Slice C). `_id = seriesId`
// (e.g. 'US_CPI_YOY'). No pilot source is wired — this is the registry the
// first macro connector (Slice F) will reference.
import mongoose from 'mongoose'

const MacroSeriesSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // seriesId
    seriesId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    marketGroup: { type: String, default: 'macro_cb' },
    geography: { type: String, default: null },
    unit: { type: String, default: '' },
    frequency: { type: String, default: null },
    sourceId: { type: String, default: null },
    licenseStatus: { type: String, enum: ['ok', 'unknown', 'revoked'], default: 'unknown' },
    schemaVersion: { type: String, default: '1' },
  },
  { timestamps: true, collection: 'news_macro_series' },
)

export const MacroSeries =
  mongoose.models.news_macro_series || mongoose.model('news_macro_series', MacroSeriesSchema)
