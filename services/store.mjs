// =============================================================================
//  TM TRADING - ghi/đọc collection `intel` cho services (Phase 8).
//
//  MỘT NGUỒN (D1): snapshot = deleteMany(kind) + insert (dashboard cần top-list
//  hiện tại); event = bulkWrite insertOne ordered:false, unique `key` tự loại
//  trùng — trả về danh sách key MỚI để service quyết định gửi Telegram (chỉ
//  gửi cái thực sự mới, chạy lại không spam — bài học dedupe D4).
//
//  Mongo không sẵn sàng -> trả null (fail-soft, service tự đánh dấu down).
// =============================================================================
import { connectMongo } from '../engine/db.mjs'

/** Model `intel` — null = Mongo không kết nối được. Memo theo process. */
let intelMemo = null
export async function getIntel() {
  if (intelMemo) return intelMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/intel.mjs')
  intelMemo = mod.Intel
  return intelMemo
}

/** Model `datasets` (retention manifest §23.4) — null = Mongo down. */
let datasetMemo = null
export async function getDataset() {
  if (datasetMemo) return datasetMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/dataset.mjs')
  datasetMemo = mod.Dataset
  return datasetMemo
}

/** Model `market_feed` (raw feed ledger §23.3 P1) — null = Mongo down. */
let marketFeedMemo = null
export async function getMarketFeed() {
  if (marketFeedMemo) return marketFeedMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/marketFeed.mjs')
  marketFeedMemo = mod.MarketFeed
  return marketFeedMemo
}

/** Model `notification_logs` (Notification Router audit §25) — null = Mongo down. */
let notificationLogMemo = null
export async function getNotificationLog() {
  if (notificationLogMemo) return notificationLogMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/notificationLog.mjs')
  notificationLogMemo = mod.NotificationLog
  return notificationLogMemo
}

/** Model `experiments` (Experiment Engine §28.1) — null = Mongo down. */
let experimentMemo = null
export async function getExperiment() {
  if (experimentMemo) return experimentMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/experiment.mjs')
  experimentMemo = mod.Experiment
  return experimentMemo
}

/** Model `experiment_runs` (Experiment Engine §28.2 arms) — null = Mongo down. */
let experimentRunMemo = null
export async function getExperimentRun() {
  if (experimentRunMemo) return experimentRunMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/experimentRun.mjs')
  experimentRunMemo = mod.ExperimentRun
  return experimentRunMemo
}

/** Model `ai_proposals` (AI Research §27.3) — null = Mongo down. */
let aiProposalMemo = null
export async function getAiProposal() {
  if (aiProposalMemo) return aiProposalMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/aiProposal.mjs')
  aiProposalMemo = mod.AiProposal
  return aiProposalMemo
}

/** Model `strategy_versions` (Strategy Version Lifecycle §29) — null = Mongo down. */
let strategyVersionMemo = null
export async function getStrategyVersion() {
  if (strategyVersionMemo) return strategyVersionMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/strategyVersion.mjs')
  strategyVersionMemo = mod.StrategyVersion
  return strategyVersionMemo
}

/** Model `strategy_profiles` (Strategy Profile §26.1) — null = Mongo down. */
let strategyProfileMemo = null
export async function getStrategyProfile() {
  if (strategyProfileMemo) return strategyProfileMemo
  const mg = await connectMongo()
  if (!mg) return null
  const mod = await import('../engine/models/strategyProfile.mjs')
  strategyProfileMemo = mod.StrategyProfile
  return strategyProfileMemo
}

/**
 * Ghi snapshot 1 kind: xóa toàn bộ kind cũ, chèn bộ hiện tại.
 * rows: [{ key, symbol?, title?, score?, ts: Date|number, data }]
 * @returns {Promise<number>} số dòng chèn
 */
export async function saveSnapshot(kind, rows) {
  const Intel = await getIntel()
  if (!Intel) return -1
  await Intel.deleteMany({ kind })
  if (!rows.length) return 0
  const docs = rows.map((r) => ({ ...r, kind }))
  await Intel.insertMany(docs, { ordered: false })
  return docs.length
}

/**
 * Chèn event (unique key) — trả về key MỚI (trùng bị bỏ qua, không throw).
 * @param {Array<{key:string, kind:string, symbol?:string|null, title?:string,
 *                score?:number|null, ts:Date|number, data?:object}>} docs
 * @returns {Promise<{inserted:string[], dupes:number}|null>} null = Mongo down
 */
export async function insertEvents(docs) {
  const Intel = await getIntel()
  if (!Intel) return null
  if (!docs.length) return { inserted: [], dupes: 0 }
  const keys = docs.map((d) => d.key)
  // _id = key: giup doc lai key nao da chen khi driver NEM MongoBulkWriteError
  // (driver ném thay vi tra result khi co duplicate — chi dung khi tat ca = 11000).
  const ops = docs.map((d) => ({ insertOne: { document: { ...d, _id: d.key } } }))
  let insertedIds = {}
  try {
    const res = await Intel.collection.bulkWrite(ops, { ordered: false })
    insertedIds = res?.insertedIds || {}
  } catch (e) {
    const wes = e?.writeErrors || e?.result?.writeErrors || []
    const allDup = wes.length > 0 && wes.every((w) => (w?.code ?? w?.err?.code) === 11000)
    if (!allDup) throw e // loi that (network/dong ket noi...) — khong che
    insertedIds = e?.result?.insertedIds || {}
  }
  const inserted = Object.values(insertedIds).map(String)
  return { inserted, dupes: docs.length - inserted.length }
}
