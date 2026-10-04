#!/usr/bin/env node
// =============================================================================
//  TM TRADING - KHOA IDEMPOTENCY (roadmap D3 + D4)
//
//  Hai tang, KHONG duoc gop lam mot:
//   - `alertKey`     : khu trung o tang ALERT. Alert den 2 lan la chuyen nho.
//   - `clientOrderId`: idempotency o tang LENH. Lenh duoc dat 2 lan la chuyen LON.
//     San/MT5 tu choi khi trung clientOrderId -> tang duoi tu chan, khong phu thuoc
//     vao viec tang alert co khu trung dung hay khong.
//
//  Khoa phai ON DINH: cung payload -> cung khoa. Dung `stableStringify` (sort key)
//  tu version.mjs, khong dung JSON.stringify tho.
// =============================================================================

import { createHash } from 'node:crypto'
import { stableStringify } from './version.mjs'

/** Ky tu cho phep cua clientOrderId (Binance/MT5 deu chap nhan tap nay). */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

/**
 * Khoa khu trung cua mot alert.
 * Gom dung cac truong dinh danh su kien: nguon + symbol + tf + thoi diem + hanh dong
 * + huong + gia + level + mode. TradingView retry gui LAI NGUYEN payload -> trung
 * khoa -> bi chan.
 *
 * `level` va `mode` KHONG duoc bo qua (da kiem chung): 2 alert TAKE_PROFIT cho
 * TP1/TP2 cung xay ra trong 1 bar co cung ts/action/side/price -> neu thieu
 * `level` thi alert thu 2 bi coi la retry va BI MAT. Cung vay, chart "live" va
 * chart "closed" cung symbol/tf cung bar khong duoc chan nhau -> can `mode`.
 *
 * Chu y: doi truong trong can nay = doi khoa -> khong the tron duoc voi du lieu
 * da ghi truoc. Chua co alert nao trong DB nen khong can migration (2026-10-02).
 */
export function alertKey(payload, source = 'tradingview') {
  const rawTs = payload?.ts
  const d = rawTs instanceof Date ? rawTs : new Date(rawTs)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`alertKey: ts khong hop le (${JSON.stringify(rawTs)})`)
  }
  const price = Number(payload?.price)
  if (!Number.isFinite(price)) {
    throw new Error(`alertKey: price khong hop le (${JSON.stringify(payload?.price)})`)
  }
  const level = payload?.level === undefined || payload?.level === null ? null : Number(payload.level)

  const canon = {
    source,
    symbol: String(payload?.symbol ?? ''),
    tf: String(payload?.tf ?? ''),
    ts: d.toISOString(),
    action: String(payload?.action ?? ''),
    side: String(payload?.side ?? ''),
    price,
    level: Number.isFinite(level) ? level : null,
    mode: String(payload?.mode ?? ''),
  }
  return 'a1_' + createHash('sha256').update(stableStringify(canon)).digest('hex').slice(0, 40)
}

/**
 * Idempotency o tang LENH. `seq` cho phep tach nhieu lenh cua cung mot alert
 * (vi du vao 1 lan, nhoi them 1 lan) ma van tat dinh.
 *
 * Do dai: 3 + 24 + 1 + len(seq) <= 31 -> vua gioi han cua MT5 (31 ky tu).
 */
export function clientOrderId(key, seq = 0) {
  if (typeof key !== 'string' || key.length < 8) {
    throw new Error('clientOrderId: can alertKey hop le')
  }
  const id = `tm-${key.slice(-24)}-${seq}`
  if (!SAFE_ID.test(id)) throw new Error(`clientOrderId: ky tu khong hop le (${id})`)
  return id
}
