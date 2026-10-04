#!/usr/bin/env node
// =============================================================================
//  TM TRADING - METHODS REGISTRY LOADER
//
//  Tai toan bo method dang ky vao registry (engine/methods/index.mjs).
//
//  VI SAO CAN FILE NAY: `index.mjs` KHONG the tu import cac method - neu no
//  import `vsa.mjs` thi sinh VONG (vsa.mjs cung import index.mjs de goi
//  registerMethod), va `REGISTRY` (const) se con trong TDZ luc registerMethod
//  chay -> ReferenceError. Nen dang ky phai do TUNG method tu goi, va co mot
//  cho duy nhat gom het lai.
//
//  Cach dung: `import './methods/all.mjs'` (side-effect) truoc khi goi
//  getMethod('vsa'). `backtest.mjs` da lam dieu nay.
//
//  Them method moi o Phase 10 -> chi can them 1 dong import o day.
// =============================================================================

import './vsa.mjs'
// Phase 10 — 3 method moi (ung vien league):
import './priceAction.mjs'
import './trend.mjs'
import './orderflow.mjs'
