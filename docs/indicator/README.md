# Trung tâm Tài liệu Chỉ báo & Pine Script (Indicator Master Hub)

Thư mục này quản lý toàn bộ tài liệu kỹ thuật, đặc tả kiến trúc, hướng dẫn tham số, và quy tắc kiểm định của hệ sinh thái **5 bộ chỉ báo giao dịch định lượng** trên nền tảng **TM Trading**.

---

## 1. Bảng Tổng quan 5 Bộ Chỉ báo Chính thức (Active Production Suites)

Toàn bộ 5 bộ chỉ báo đều được xây dựng trên nền tảng **Pine Script v6**, biên dịch tự động qua `tools/build.mjs`, tích hợp sẵn **phiên bản kép** (Indicator trực quan + Strategy Backtest kiểm định) và nhúng **thông tin version** trong mã nguồn và webhook payload.

| Bộ chỉ báo | Thư mục nguồn | File phân phối (`pine/dist/`) | Version | Webhook Alert Schema | Thị trường tối ưu | Triết lý cốt lõi |
|---|---|---|:---:|:---:|---|---|
| **1. TM Indicator 2** | `pine/parts-tm/` | `TM Indicator 2.pine`<br>`TM Indicator Strategy Lab 2.pine` | **2.1.0** | `tm2.signal.v2.1` | Futures Đa tài sản (BTC, ETH, Altcoins, XAU) | 7 trụ cột định lượng: Chấm điểm 2 chiều (Direction-aware), 3 Entry Modes (A/B/C), Auto BE tại TP1, Trailing TP2, Stagnation Exit. |
| **2. TM XAU Signals 2** | `pine/parts-xau/` | `TM XAU Signals 2.pine` | **2.0.0** | `xau.signal.v2.0` | Vàng (XAUUSD) & Ngoại hối | Săn thanh khoản chuyên sâu (Liquidity Sweeps, Sessions London/NY, PDH/PDL, Trendline Liquidity, FVG/OB, HTF Veto). |
| **3. LongKaco VSA** | `pine/parts-longkaco-vsa/` | `LongKaco VSA.pine`<br>`LongKaco VSA Backtest.pine` | **1.0.0** | `"version":"1.0.0"` | Crypto & Futures | Volume Spread Analysis & Wyckoff thực chiến: Quét thanh khoản trước Retest (A-P0-1), TP Measured Move (A-P1-1), Climax Exit (A-P1-2), Pyramiding (A-P1-3). |
| **4. Price Action MTF** | `pine/parts-price-action-mtf/` | `Price Action MTF.pine`<br>`Price Action MTF Backtest.pine` | **1.0.0** | `pa-mtf.signal.v1.0` | Vàng (XAUUSD) & Forex | Phương pháp Nh Kiến Thức: Mô hình giá phá Neckline (DT/DB/H&S), nến IB/Doji/3S/3C, Confluence Engine 3/3, Volume Veto, Regime Gate. |
| **5. TM Fusion Zones** | `pine/parts-fusion-zones/` | `TM Fusion Zones.pine`<br>`TM Fusion Zones Backtest.pine` | **1.0.0** | `fz.signal.v1.0` | Đa tài sản (Crypto, XAU, Forex) | Hợp lưu Trend Ribbon + Dynamic Supply/Demand Zones, Quét thanh khoản, 3 Setup độc lập, Chấm điểm 2 chiều 0-100, Obstacle Gate. |

---

## 2. Bảng Tra cứu Lệnh Build & Copy Nhanh

Các lệnh CLI được tích hợp sẵn trong `package.json` để biên dịch và copy thẳng vào Clipboard dán lên TradingView:

| Chỉ báo | Lệnh Build từ CLI | Lệnh Copy vào Clipboard |
|---|---|---|
| **Toàn bộ hệ thống** | `npm run pine:build` *(Build toàn bộ file)* | — |
| **TM Indicator 2** | `npm run pine:tm` | `npm run pine:copy:tm` |
| **TM Indicator Strategy Lab 2** | `npm run pine:tm-strat` | `npm run pine:copy:tm-strat` |
| **TM XAU Signals 2** | `npm run pine:xau` | `npm run pine:copy:xau` |
| **LongKaco VSA** | `npm run pine:lk-vsa` | `npm run pine:copy:lk-vsa` |
| **LongKaco VSA Backtest** | `npm run pine:lk-vsa:backtest` | `npm run pine:copy:lk-vsa:backtest` |
| **Price Action MTF** | `npm run pine:pa-mtf` | `npm run pine:copy:pa-mtf` |
| **Price Action MTF Backtest** | `npm run pine:pa-mtf:backtest` | `npm run pine:copy:pa-mtf:backtest` |
| **TM Fusion Zones** | `npm run pine:fz` | `npm run pine:copy:fz` |
| **TM Fusion Zones Backtest** | `npm run pine:fz:backtest` | `npm run pine:copy:fz:backtest` |

---

## 3. Bản đồ Tài liệu Chi tiết Từng Bộ

### 3.1 TM Indicator 2 (`docs/indicator/tm-indicator-2/`)
Bộ chỉ báo định lượng thế hệ mới cho thị trường phái sinh đa tài sản:
- [README.md](./tm-indicator-2/README.md): Tổng quan kiến trúc 7 trụ cột, 14 module parts, chấm điểm hai chiều v2.1, 3 Entry Modes, và Alert contract.
- [INPUTS.md](./tm-indicator-2/INPUTS.md): Bảng tra cứu toàn bộ tham số, giải thích từng biến và presets cho BTC, ETH, XAU, Altcoins.
- [TM_Indicator_Roadmap_v2.1.md](./tm-indicator-2/TM_Indicator_Roadmap_v2.1.md): Chi tiết lộ trình nâng cấp v2.1 (P0 directional scoring, P1 entry modes, compact dashboard).
- [futures-risk-model.md](./tm-indicator-2/futures-risk-model.md): Mô hình toán rủi ro ký quỹ Futures, đòn bẩy an toàn và khoảng cách giá cháy.
- [asset-profiles.md](./tm-indicator-2/asset-profiles.md): Cấu hình hồ sơ tài sản tự động (BTC, ETH, XAU, Altcoins).
- [audit-baseline.md](./tm-indicator-2/audit-baseline.md), [ablation-walkforward-protocol.md](./tm-indicator-2/ablation-walkforward-protocol.md), [regression-checklist.md](./tm-indicator-2/regression-checklist.md): Báo cáo audit, ma trận kiểm thử bóc tách A–E và checklist hồi quy.

### 3.2 TM XAU Signals 2 (`docs/indicator/xau/`)
Hệ thống săn thanh khoản chuyên sâu cho Vàng và Ngoại hối:
- [README.md](./xau/README.md): Cẩm nang kỹ thuật & hướng dẫn sử dụng chi tiết: 13 module parts, phiên Á/London/NY, PDH/PDL, Sweeps, FVG/OB, HTF Veto, và Alert JSON `xau.signal.v2.0`.
- [INPUTS.md](./xau/INPUTS.md): Bảng tra cứu toàn bộ tham số cấu hình và presets chuẩn cho M5 Scalping, M15 Day Trading, H1 Swing Trading.
- [xau-price-action-method.md](./xau/xau-price-action-method.md): Nghiên cứu tổng hợp phương pháp Price Action & MTF Confluence trên thị trường Vàng.

### 3.3 LongKaco VSA (`docs/indicator/longkaco-vsa/`)
Bộ chỉ báo VSA Wyckoff thực chiến độc lập kết hợp 4 afterfix:
- [README.md](./longkaco-vsa/README.md): Tổng quan cấu trúc, 4 afterfix cốt lõi (A-P0-1 Sweep, A-P1-1 MM TP, A-P1-2 CLX-E, A-P1-3 Pyramid), dashboard, alert contract và giao thức kiểm định.
- [BUILD.md](./longkaco-vsa/BUILD.md): Đặc tả kỹ thuật chi tiết từng file, sơ đồ phụ thuộc tín hiệu, và giải pháp triệt tiêu rủi ro lookahead / pyramiding.
- [INPUTS.md](./longkaco-vsa/INPUTS.md): Toàn bộ tham số cấu hình, giải thích ý nghĩa và presets cho các khung thời gian.

### 3.4 Price Action MTF (`docs/indicator/price-action-mtf/`)
Bộ chỉ báo Price Action & Đa khung thời gian theo phương pháp Nh Kiến Thức Trading:
- [README.md](./price-action-mtf/README.md): Tổng quan kiến trúc, 7 afterfix (mô hình phá Neckline, nến mở rộng, Confluence 3/3, Volume Veto, Regime Gate, TP Measured Move, Engulfing Streak), dashboard 2x27, và alert contract `pa-mtf.signal.v1.0`.
- [BUILD.md](./price-action-mtf/BUILD.md): Đặc tả 14 file mã nguồn, luồng dữ liệu, thuật toán tính Neckline và cơ chế chống repaint.
- [INPUTS.md](./price-action-mtf/INPUTS.md): Bảng tra cứu tham số chi tiết và presets cho Scalp (M5/M15) vs Swing (H1/H4).

### 3.5 TM Fusion Zones (`docs/indicator/TM Fusion Zones/`)
Hệ thống hợp lưu Trend Ribbon & Dynamic Zones toàn diện:
- [README.md](./TM%20Fusion%20Zones/README.md): Tổng quan kiến trúc, 12 module parts, Trend Ribbon Cloud, Dynamic Supply/Demand Zones, 3 Setup vào lệnh độc lập, Scoring 0–100, Obstacle Gate và HUD Dashboard.
- [BUILD.md](./TM%20Fusion%20Zones/BUILD.md): Quy trình build module, kiểm thử smoke test và quy tắc biên dịch Pine Script v6.
- [INPUTS.md](./TM%20Fusion%20Zones/INPUTS.md): Bảng tra cứu toàn bộ tham số cài đặt, asset profiles và ngưỡng rủi ro.
- [signal-rules.md](./TM%20Fusion%20Zones/signal-rules.md): Đặc tả định lượng quy tắc 3 setup, 5 trọng số chấm điểm và cổng cản trở Obstacle Gate.
- [design-decisions.md](./TM%20Fusion%20Zones/design-decisions.md): Ghi nhận các quyết định kiến trúc, mặc định an toàn và đánh đổi thiết kế.
- [TM_Fusion_Zones_Roadmap_v1.0.md](./TM%20Fusion%20Zones/TM_Fusion_Zones_Roadmap_v1.0.md): Lộ trình thiết kế và tài liệu gốc.

---

## 4. Tài liệu Bổ trợ & Phương pháp Gốc

- [docs/indicator/vsa-wyckoff/](./vsa-wyckoff/): Tài liệu nghiên cứu gốc về Volume Spread Analysis & phương pháp Wyckoff (Method 0).
  - [vsa-wyckoff-method.md](./vsa-wyckoff/vsa-wyckoff-method.md): Đặc tả toán học và định nghĩa nến VSA, Stopping Volume, Buying Climax.
  - [vsa-optimization.md](./vsa-wyckoff/vsa-optimization.md): Báo cáo thực nghiệm đo lường hiệu quả tham số và baseline ngẫu nhiên.
  - [vsa-sweep-pine-build.md](./vsa-wyckoff/vsa-sweep-pine-build.md): Bảng ánh xạ video LongKaco và nguồn gốc thiết kế của bộ LongKaco VSA.
- [docs/indicator/liquidity/](./liquidity/): Nghiên cứu cấu trúc thanh khoản thể chế, vùng tích lũy và bẫy giá.
  - [liquidity-sweep.md](./liquidity/liquidity-sweep.md): Quy tắc quét thanh khoản, râu từ chối và tín hiệu xác nhận.
- [docs/indicator/tm-indicator/](./tm-indicator/): Tài liệu lưu trữ về các giai đoạn phát triển ban đầu của TM Indicator v1 (Phase 0–8).
- [docs/indicator/mtf-one-candle/](./mtf-one-candle/): Phương pháp **quét khung lớn → 1 cây nến** (2 video mới 10/2026, USOIL + XAU).
  - [README.md](./mtf-one-candle/README.md): Bằng chứng theo mốc thời gian (D1→H4→H1→M30→M15→M5), định nghĩa nến mồi, công thức Entry/SL/TP, thang nhồi lệnh L0–L3 và đánh giá điểm yếu.
  - [BUILD.md](./mtf-one-candle/BUILD.md): Spec build chỉ báo `MTF One-Candle` (11 module, input, thuật toán, alert `mtf1c.signal.v1.0`, twin backtest, nghiệm thu).

---

## 5. Quy chuẩn Cảnh báo Webhook JSON (Bot Integration)

Cả 5 bộ chỉ báo đều hỗ trợ phát tín hiệu qua webhook tự động đến trade desk hoặc server bot (`server/webhook.mjs`). Cấu trúc dữ liệu JSON luôn đính kèm trường phiên bản:

| Bộ chỉ báo | Phiên bản | Trường version trong JSON | Mẫu Alert String |
|---|:---:|---|---|
| **TM Indicator 2** | `2.1.0` | `"version": "2.1.0"`, `"schema": "tm2.signal.v2.1"`, `"v": 2.1` | `{"version":"2.1.0","action":"{{strategy.order.action}}",...}` |
| **TM XAU Signals 2** | `2.0.0` | `"version": "2.0.0"`, `"schema": "xau.signal.v2.0"`, `"v": 2` | `{"v":2,"version":"2.0.0","action":"BUY",...}` |
| **LongKaco VSA** | `1.0.0` | `"version": "1.0.0"` | `{"version":"1.0.0","action":"LK VSA LONG",...}` |
| **Price Action MTF** | `1.0.0` | `"version": "1.0.0"`, `"schema": "pa-mtf.signal.v1.0"`, `"v": 1` | `{"v":1,"version":"1.0.0","action":"BUY",...}` |
| **TM Fusion Zones** | `1.0.0` | `"version": "1.0.0"`, `"schema": "fz.signal.v1.0"`, `"v": 1` | `{"v":1,"version":"1.0.0","action":"ENTRY",...}` |

---

## 6. Cổng Kiểm định Tự động (Verification Gate)

Để đảm bảo tài liệu và mã nguồn luôn đồng bộ và không có liên kết đứt gãy hoặc lỗi biên dịch, toàn bộ hệ sinh thái chỉ báo được bảo vệ bởi cổng kiểm định:

```bash
npm run verify        # Build toàn bộ chỉ báo + Kiểm tra docs + Chạy toàn bộ test suites
npm run docs:check    # Kiểm tra tính toàn vẹn giữa tài liệu và mã nguồn thực tế
npm run pine:test     # Smoke test toàn diện các file dist của 5 bộ chỉ báo
```
