// engine/models/position.mjs
// Vi the THAT (paper / MT5 / san / tay). La nguon chan ly ve "dang giu gi" -
// moi thu khac (dashboard, risk gate, journal) doc tu day.
import mongoose from 'mongoose'

const PositionSchema = new mongoose.Schema(
  {
    account: { type: String, required: true },
    source: { type: String, enum: ['paper', 'mt5', 'exchange', 'manual'], default: 'paper' },

    // Id phia san/MT5 (ticket). Dung de doi chieu khi bo phan sync lech trang thai.
    externalId: { type: String, default: null },

    symbol: { type: String, required: true },
    dir: { type: Number, enum: [1, -1], required: true },
    qty: { type: Number, required: true },

    entryPrice: { type: Number, required: true },
    entryTime: { type: Date, required: true },

    sl: { type: Number, default: null },
    tps: { type: [Number], default: undefined },

    exitPrice: { type: Number, default: null },
    exitTime: { type: Date, default: null },

    status: { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open' },
    pnlPct: { type: Number, default: null },
    pnlAbs: { type: Number, default: null },

    // Truy vet: vi the nay sinh ra tu tin hieu nao, bo tham so nao
    method: { type: String, default: null },
    // FIELD CU (legacy) — cac doc ghi truoc 2026-10-05 chi co truong nay. Gia tri
    // that cua D1 nam trong `stamp.paramsHash`; consumer phai doc `stamp` truoc,
    // va `isStampUnknown()` (engine/stamp.mjs) la noi quyet dinh doc nao la
    // "khong co stamp".
    paramsHash: { type: String, default: null },
    signalKey: { type: String, default: null },

    // --- Version stamp of the LIVE path (roadmap D1 / Phase 13 item 3) --------
    // Nested on purpose (docs/data-model.md §10.3): one identity written together
    // and read together. `paramsHash` is ALWAYS produced by engine/version.mjs
    // paramsHash() and is null only when no live preset was declared — never a
    // fallback to DEFAULTS, because a wrong preset silently compares live trades
    // against a backtest of a different configuration.
    stamp: {
      engineVersion: { type: String, default: null },
      paramsHash: { type: String, default: null },
      params: { type: mongoose.Schema.Types.Mixed, default: null },
      kind: { type: String, enum: ['declared', 'unknown'], default: 'unknown' },
      since: { type: Date, default: null },
    },
    // Positions written BEFORE the stamp existed. Consumers (preset-drift)
    // exclude them instead of bucketing them as `unknown#unknown`.
    stampUnknown: { type: Boolean, default: false },

    // Khung thoi gian tu alert mo lenh (positions khong the tu biet no la TF nao)
    tf: { type: String, default: null },
    // §29: the strategy version that produced this position (D1). Written by the
    // executor from the ACTIVE profile pointer at the moment of the open. null =
    // no live version was declared — honest, never guessed (a version stamped
    // after the fact is look-ahead identity, the same sin as look-ahead regime).
    strategyVersionId: { type: String, default: null, index: true },
    // Vi sao lenh dong: alert:TAKE_PROFIT | alert:STOP_LOSS | alert:TIME_CLOSE |
    // data:tp | data:sl | manual | manual:partial (Phase 7P child doc) | unknown.
    // Chi duong thoat moi biet, nen no duoc
    // ghi tai cho quyet dinh (engine/stamp.mjs exitReasonOf) - khong suy lai.
    exitReason: { type: String, default: null },
    // MEASURED round-trip fees (Phase 7P): entry fee from the modelled fill +
    // exit fee at close, so pnlAbs is fee-NET. null = unknown (legacy docs —
    // never relabelled as 0, because 0 would claim fees were measured).
    fees: { type: Number, default: null },
    // Phase 7P: how the ENTRY filled through the simulation fill model.
    // orderType 'market'|'limit'|'stop' (null = legacy, filled at signal price);
    // slippage = adverse bps applied on top of the quote at the entry fill.
    orderType: { type: String, default: null },
    slippage: { type: Number, default: null },
    // §34: execution fidelity level (F0..F4) — the precision tier of the fill
    // model that produced this position. null = not recorded (legacy).
    fidelity: { type: String, default: null },
  },
  { timestamps: true, collection: 'positions' },
)

PositionSchema.index({ account: 1, status: 1 })
PositionSchema.index({ symbol: 1, entryTime: -1 })
// externalId phai duy nhat TRONG mot account+nguon, nhung cho phep null (lenh tay)
PositionSchema.index({ account: 1, source: 1, externalId: 1 }, { unique: true, sparse: true })

export const Position = mongoose.models.positions || mongoose.model('positions', PositionSchema)
