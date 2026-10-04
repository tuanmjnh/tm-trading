#!/usr/bin/env node
// =============================================================================
//  TM TRADING - signals.mjs  (DA DOI VI TRI - xem engine/methods/vsa.mjs)
//
//  Log cua su doi vi tri (roadmap Phase 4, muc khoa 🔒):
//
//  TRUOC DAY: toan bo logic VSA nam trong file nay. Van de: `backtest.mjs`
//  (Phase 4) se gan khung vao cac TRUONG RIENG cua no (levels, flags, series...),
//  va den Phase 10 khi them method PA/SMC phai boc lai toan bo backtest.
//
//  NAY: implementation chuyen sang `engine/methods/vsa.mjs` - plugin method 0
//  dang ky vao `engine/methods/index.mjs` theo hop dong Phase 10
//  (`analyze(bars, opts) -> { events, scores, setups }`).
//
//  File nay GIU LAI DE KHONG LAM HONG cac import cu (`version.mjs`,
//  `engine/test.mjs`, doc, script) - no chi re-export, KHONG co logic rieng.
//  Neu ban sua code o day -> sua o dau cung khong co hieu luc. Sua o methods/vsa.mjs.
// =============================================================================

export { DEFAULTS, runVsa, analyze, method as vsaMethod, EVENT_SCORE, ID } from './methods/vsa.mjs'
