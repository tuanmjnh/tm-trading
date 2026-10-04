#!/usr/bin/env node
// =============================================================================
//  TM TRADING - KET NOI MONGODB (Mongoose) cho ENGINE
//
//  Ke thua pattern cua tm-hub (`server/utils/mongo.ts`), da duoc chung minh:
//   - trang thai tren globalThis  -> song qua HMR / import lai, khong mo nhieu pool;
//   - dedup: nhieu loi goi song song chi tao MOT ket noi;
//   - FAIL-SOFT: chua cau hinh hoac khong ket noi duoc -> tra `null`, KHONG nem.
//     Day la lua chon co y: roadmap D1 noi "ghi NDJSON LUON, ghi Mongo neu co URI"
//     -> thieu Mongo khong duoc lam hong mot lan backtest;
//   - COOLDOWN 30s sau lan loi: fail fast thay vi treo request;
//   - doi URI -> dong ket noi cu roi ket noi lai;
//   - loi/disconnected sau khi ket noi -> bo cache, lan sau thu lai.
//
//  KHAC tm-hub co y:
//   - tm-hub dung `mongoose.createConnection` va tach pool theo TEN, vi no phuc vu
//     nhieu DB (log DB rieng...). Engine chi co MOT DB nen dung ket noi MAC DINH
//     cua mongoose (`mongoose.connect`) - nho vay `mongoose.models.x || model(...)`
//     trong engine/models/*.mjs dung duoc ngay, khong phai bind connection rieng.
//   - tm-hub la serverless nen pool 1-2; engine chay tien trinh dai + ghi nhieu
//     document khi backtest -> pool 5.
//
//  Day la lop DUY NHAT trong engine duoc import mongoose. `ta.mjs`, `signals.mjs`,
//  `version.mjs` va test cua chung VAN chay khi khong cai/khong co Mongo.
// =============================================================================

import mongoose from 'mongoose'

mongoose.set('strictQuery', true)

const g = globalThis
if (g.__tmMongo === undefined) {
  g.__tmMongo = { connected: false, promise: null, uri: null, lastAttempt: 0 }
}
const state = g.__tmMongo

/** Sau moi lan that bai, khong thu lai trong 30s (giong tm-hub). */
export const COOLDOWN_MS = 30_000
export const DEFAULT_DB_NAME = 'tm-trading'

export const MONGO_OPTIONS = {
  bufferCommands: false,
  maxPoolSize: 5,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  heartbeatFrequencyMS: 10000,
  retryWrites: true,
}

/**
 * Ket noi Mongo (idempotent, fail-soft).
 * @returns {Promise<import('mongoose').Mongoose|null>} null neu chua cau hinh / khong ket noi duoc.
 */
/**
 * Ten DB co trong URI (`mongodb://host:27017/ten-db`) - tra '' neu khong co.
 *
 * RAT QUAN TRONG: neu URI da chi ro ten DB thi PHAI ton trong no. Truoc day
 * `dbName: DEFAULT_DB_NAME` duoc set LUON -> ke ca URI ghi `/tm-trading-test`
 * van ket noi vao `tm-trading`, va `test-db.mjs` (co `dropDatabase()`) da XOA HUY
 * database that moi lan `npm test`. Chi dung DEFAULT_DB_NAME khi URI khong co
 * ten DB (vd `mongodb://localhost:27017`).
 */
export function dbNameFromUri(uri) {
  try {
    const p = new URL(String(uri)).pathname || ''
    const name = decodeURIComponent(p.replace(/^\//, '').split('/')[0] ?? '')
    return name || ''
  } catch {
    return '' // URI khong parse duoc -> de mongoose xu ly, khong doan chap
  }
}

export async function connectMongo(uri = process.env.MONGODB_URI, opts = {}) {
  const target = String(uri ?? '').trim()
  if (!target) return null // fail-soft: khong cau hinh thi chi dung NDJSON

  // Doi URI -> dong ket noi cu, bat dau lai (giong tm-hub).
  if (state.uri !== target) {
    await disconnectMongo()
    state.uri = target
  }

  if (state.connected && mongoose.connection.readyState === 1) return mongoose
  if (state.promise) return state.promise
  if (state.lastAttempt && Date.now() - state.lastAttempt < COOLDOWN_MS) return null
  state.lastAttempt = Date.now()

  state.promise = (async () => {
    try {
      // URI chi ro ten DB -> dung cai do (xem dbNameFromUri): day la luat bao ve
      // du lieu, khong phai tuy chon. URI khong chi ro -> DEFAULT_DB_NAME.
      const dbName = opts.dbName || dbNameFromUri(target) || DEFAULT_DB_NAME
      const instance = await mongoose.connect(target, { ...MONGO_OPTIONS, ...opts, dbName })
      // Mat ket noi giua chung -> bo cache de lan sau thu lai.
      mongoose.connection.on('error', (err) => {
        console.warn(`[Mongo] connection error: ${err.message}`)
        state.connected = false
      })
      mongoose.connection.on('disconnected', () => {
        state.connected = false
      })
      state.connected = true
      return instance
    } catch (err) {
      console.warn(`[Mongo] connect failed: ${err?.message}`)
      state.connected = false
      return null
    } finally {
      state.promise = null
    }
  })()

  return state.promise
}

export async function disconnectMongo() {
  try {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
  } catch {
    // Dong loi khong quan trong luc shutdown.
  }
  state.connected = false
  state.promise = null
  state.lastAttempt = 0
}

export const isMongoConnected = () => mongoose.connection.readyState === 1

/** Trang thai gon cho /health (D9). Khong bao gio nem loi. */
export async function mongoStatus() {
  try {
    if (!isMongoConnected()) return { connected: false }
    await mongoose.connection.db.admin().command({ ping: 1 })
    return { connected: true, db: mongoose.connection.name }
  } catch (e) {
    return { connected: false, error: e.message }
  }
}