// engine/models/intel.mjs
// COLLECTION `intel` — market intelligence của services (roadmap Phase 8).
//
// Hai KIỂU ghi:
//   - snapshot (mover/flow/accum/funding): service ghi đè theo mỗi chu kỳ
//     (dashboard cần top-list HIỆN TẠI, không phải log sự kiện) — store.mjs
//     deleteMany({kind}) rồi insert.
//   - event (news/alert): append + unique `key` để khu trung vĩnh viễn
//     (y hệt bài học dedupe của alerts/alertKey — D4): RSS bị lỗi/chạy lại
//     2 lần không thể gửi Telegram 2 lần.
//
// TTL 7 ngày trên `ts` dọn event cũ (snapshot tự thay; alert đã gửi không
// cần giữ lâu). Dashboard đọc qua engineModel('intel.mjs','Intel') — fail-soft
// Mongo down -> [] như risk status.
import mongoose from 'mongoose'

const IntelSchema = new mongoose.Schema(
  {
    // Khu trung: snapshot `funding:BTCUSDT` / event `news:<sha1(link)>` /
    // `alert:funding:BTCUSDT:<nextFundingTime>` / `alert:mover:<sym>:<day>:<dir>`.
    // Phase 9: regime (1 doc hien tai), zone (1/symbol), oi + supply (lich su
    // chu ky de tinh trend/drift — chi service doc, dashboard khong show).
    // Phase 10: confluence (1 doc/symbol — diem gop 4 nguon, snapshot 1 ngay/lan).
    key: { type: String, required: true, unique: true },
    kind: { type: String, required: true, enum: ['mover', 'flow', 'accum', 'funding', 'news', 'alert', 'regime', 'zone', 'oi', 'supply', 'confluence'] },
    symbol: { type: String, default: null },
    title: { type: String, default: '' },
    ts: { type: Date, required: true },
    score: { type: Number, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'intel' },
)

IntelSchema.index({ kind: 1, ts: -1 })
IntelSchema.index({ symbol: 1, ts: -1 })
IntelSchema.index({ ts: 1 }, { expireAfterSeconds: 7 * 24 * 3600 })

export const Intel = mongoose.models.intel || mongoose.model('intel', IntelSchema)
