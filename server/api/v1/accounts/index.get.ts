import { listAccounts } from '../../../utils/accounts'

/**
 * GET /api/v1/accounts - danh sach account (vi the + equity snapshot moi nhat).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). DOC tuyet doi
 * positions + equity cua engine (D1); Mongo khong ket noi duoc tra 200 +
 * meta.mongo='down' (fail-soft, khong 500). `equity` chua co writer thi
 * latestEquity = null (khong bao gio gia su 0).
 */
export default defineEventHandler(async () => {
  const { items, total, mongo } = await listAccounts()
  return {
    success: true,
    data: items,
    meta: { total, mongo }
  }
})
