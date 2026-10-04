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
