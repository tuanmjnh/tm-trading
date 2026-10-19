# Price Action MTF — Bảng tra cứu tham số (Inputs Catalog)

Tài liệu này liệt kê toàn bộ các tham số cấu hình trong `pine/parts-price-action-mtf/10_config.pine`, phân loại theo từng nhóm giao diện trên TradingView cùng các cấu hình mẫu (Presets).

---

## 1. Bảng tra cứu chi tiết theo nhóm

### 1.1 PA MTF · Chung (General)
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_confirmOnly` | bool | `true` | Chỉ phát tín hiệu khi nến đã đóng (No-Repaint) |
| `pa_payloadMode` | string | `"Full"` | Chế độ webhook JSON (`"Full"`, `"Slim"`, `"Off"`) |

### 1.2 PA MTF · Market Structure
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_ms_swLen` | int | `5` | Chu kỳ nhìn lại để xác định Swing pivot |
| `pa_ms_bosOn` | bool | `true` | Hiển thị đường và nhãn BOS (Break of Structure) |
| `pa_ms_chochOn` | bool | `true` | Hiển thị đường và nhãn CHoCH (Change of Character) |
| `pa_ms_mssOn` | bool | `true` | Hiển thị MSS (Market Structure Shift kèm nến xung lượng) |
| `pa_ms_retestOn` | bool | `true` | Phát hiện giá Retest vùng vừa bị phá vỡ |
| `pa_ms_retestBars` | int | `10` | Cửa sổ số nến cho phép xảy ra Retest |
| `pa_ms_retestTol` | float | `0.5` | Dung sai khoảng cách Retest ($\times\text{ATR}$) |
| `pa_ms_failOn` | bool | `true` | Phát hiện phá vỡ giả (Failed Breakout) |
| `pa_ms_failBars` | int | `5` | Cửa sổ nến kiểm tra giá quay lại trong vùng |
| `pa_ms_contOn` | bool | `true` | Tín hiệu xu hướng tiếp diễn (HH/LL) |
| `pa_ms_pullOn` | bool | `true` | Tín hiệu Pullback về EMA 50 |

### 1.3 PA MTF · Liquidity & Market Location
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_liq_eqTol` | float | `0.05` | Ngưỡng khoảng cách Equal High / Low ($\times\text{ATR}$) |
| `pa_liq_sweepOn` | bool | `true` | Hiển thị tín hiệu quét thanh khoản (Liquidity Sweep) |
| `pa_liq_pdOn` | bool | `true` | Hiển thị mức Đỉnh/Đáy ngày hôm trước (PDH / PDL) |
| `pa_liq_pwOn` | bool | `true` | Hiển thị mức Đỉnh/Đáy tuần trước (PWH / PWL) |
| `pa_liq_sessOn` | bool | `true` | Hiển thị mức Đỉnh/Đáy của phiên giao dịch |
| `pa_liq_tlOn` | bool | `true` | Kẻ đường Trendline 2 điểm tự động |
| `pa_liq_tlTol` | float | `0.25` | Dung sai chạm Trendline ($\times\text{ATR}$) |
| `pa_liq_tlMaxDev`| float | `10.0` | Khoảng cách tối đa tránh Trendline kéo dãn chart |

### 1.4 PA MTF · SR Zones & FVG & Order Block
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_sr_left` / `pa_sr_right` | int | `10` | Số nến trái/phải để tạo zone hỗ trợ/kháng cự |
| `pa_sr_width` | float | `0.5` | Bề rộng của vùng S/R ($\times\text{ATR}$) |
| `pa_sr_maxZone` | int | `8` | Số vùng S/R tối đa lưu trữ |
| `pa_sr_showOn` | bool | `true` | Bật vẽ vùng S/R trên chart |
| `pa_fvg_showOn` | bool | `true` | Bật vẽ vùng khoảng trống giá FVG |
| `pa_fvg_minAtr` | float | `0.3` | Biên độ FVG tối thiểu ($\times\text{ATR}$) |
| `pa_fvg_max` / `pa_fvg_life` | int | `20` / `100` | Số lượng và tuổi thọ tối đa của FVG |
| `pa_ob_showOn` / `pa_ob_max` | bool / int | `true` / `20` | Bật vẽ Order Block và số lượng tối đa |

### 1.5 PA MTF · Candle Patterns (B-P0-2, B-P1-1, B-P1-4)
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_cp_pinRatio` | float | `2.0` | Tỷ lệ râu nến / thân nến của Pin Bar |
| `pa_cp_engulf` | bool | `true` | Bật nhận diện nến Engulfing |
| `pa_cp_pin` | bool | `true` | Bật nhận diện nến Pin Bar |
| `pa_cp_disp` / `pa_cp_dispAtr` | bool / float | `true` / `1.5` | Nến Displacement (thân nến $\ge 1.5\times\text{ATR}$) |
| `pa_cp_rej` | bool | `true` | Bật nhận diện nến từ chối (Rejection candle) |
| `pa_cp_ibOn` | bool | `true` | **B-P0-2:** Nhận diện và phá vỡ Inside Bar |
| `pa_cp_dojiOn` / `pa_cp_dojiMax` | bool / float | `true` / `0.10` | **B-P0-2:** Nến Doji (thân nến $\le 10\%$ biên độ) |
| `pa_cp_soldOn` / `pa_cp_strongBody`| bool / float | `true` / `0.50` | **B-P0-2:** 3 White Soldiers / 3 Black Crows |
| `pa_cp_volVetoOn` / `pa_cp_volVetoR`| bool / float | `true` / `1.2` | **B-P1-1:** Volume veto (tỷ lệ volume $\ge 1.2$) |
| `pa_cp_streakOn` / `pa_cp_streakMin` | bool / int | `true` / `2` | **B-P1-4:** Đếm chuỗi Engulfing liên tiếp |
| `pa_cp_streakAdd` | float | `0.5` | Điểm cộng thêm khi streak $\ge 2$ |

### 1.6 PA MTF · Pattern (B-P0-1 Mẫu hình giá)
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_patOn` | bool | `true` | **B-P0-1:** Bật quét Double/Triple Top-Bottom & Vai đầu vai |
| `pa_patBand` | float | `0.5` | Dải sai số đỉnh/đáy bằng nhau ($\times\text{ATR}$) |
| `pa_patMaxBars` | int | `200` | Giới hạn số nến tìm kiếm mẫu hình |
| `pa_patHsRatio` | float | `1.2` | Tỷ lệ đỉnh đầu so với 2 vai trong H&S |

### 1.7 PA MTF · Confluence (B-P0-3)
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_cfOn` | bool | `true` | **B-P0-3:** Bật động cơ hội tụ 3 yếu tố |
| `pa_cfLevelTol` | float | `0.5` | Dung sai kiểm tra giá tại vùng Level ($\times\text{ATR}$) |
| `pa_cfBars` | int | `3` | Số nến có hiệu lực cho nến xác nhận |
| `pa_cfRequire3` | bool | `true` | Chỉ phát alert và kích hoạt lệnh khi đủ **3/3** |

### 1.8 PA MTF · Regime Gate (B-P1-2)
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_regOn` | bool | `true` | **B-P1-2:** Bật cổng phân loại chế độ thị trường |
| `pa_regAdxTrend` | float | `25.0` | Ngưỡng ADX xác định trạng thái TRENDING |
| `pa_regAdxChop` | float | `18.0` | Ngưỡng ADX xác định trạng thái CHOPPY |
| `pa_regBbwLen` | int | `100` | Chu kỳ tính phần trăm nén dải Bollinger (BBW) |
| `pa_regBbwSqueeze` | float | `20.0` | Ngưỡng phần trăm BBW xác định Squeeze |
| `pa_regRangeEdge` | float | `0.35` | Khi RANGING: chỉ cho phép vào lệnh sát biên S/R |

### 1.9 PA MTF · Risk & TP Mode (B-P1-3)
| Tên biến | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `pa_sl_atrMul` | float | `1.5` | Khoảng cách SL theo ATR |
| `pa_sl_swing` / `pa_sl_padAtr` | int / float | `10` / `0.2` | SL đặt sau Swing kèm đệm an toàn |
| `pa_sl_minAtr` / `pa_sl_maxAtr` | float | `0.5` / `3.0` | Giới hạn tối thiểu và tối đa cho khoảng cách SL |
| `pa_rr1` / `pa_rr2` / `pa_rr3` | float | `1.0` / `2.0` / `3.0` | Tỷ lệ R cho các mục tiêu TP1, TP2, TP3 |
| `pa_rrMin` | float | `1.5` | Tỷ lệ R tối thiểu để chấp nhận lệnh |
| `pa_maxDay` / `pa_coolBars` | int | `3` / `10` | Giới hạn số lệnh trong ngày và nến nghỉ |
| `pa_tpMode` | string | `"Theo R"` | Lựa chọn: `"Theo R"` hoặc `"Measured move (B-P1-3)"` |
| `pa_tpMmFallback` | bool | `true` | Dự phòng về tỷ lệ R khi thiếu độ cao mô hình |

---

## 2. Cấu hình mẫu khuyến nghị (Presets)

### Preset A: Chuẩn XAUUSD H1 / H4 (Khuyến nghị cho Swing)
- `pa_tpMode`: `"Measured move (B-P1-3)"`
- `pa_cfRequire3`: `true`
- `pa_regOn`: `true`
- `pa_cp_volVetoOn`: `true`
- `pa_ctxTf`: `"D"`
- `pa_setupTf`: `"60"`

### Preset B: Lướt sóng XAUUSD M5 / M15 (Scalping)
- `pa_ctxTf`: `"240"` (H4)
- `pa_setupTf`: `"15"` (M15)
- `pa_ms_swLen`: `3`
- `pa_cfLevelTol`: `0.35`
- `pa_regAdxTrend`: `22.0`
- `pa_rr1`: `1.2`, `pa_rr2`: `2.0`

### Preset C: Đối chứng với bản cũ `TM XAU Signals 2` (A/B Test)
- `pa_patOn`: `false` (tắt B-P0-1)
- `pa_cp_ibOn`: `false`, `pa_cp_dojiOn`: `false`, `pa_cp_soldOn`: `false` (tắt B-P0-2)
- `pa_cfOn`: `false` (tắt B-P0-3)
- `pa_cp_volVetoOn`: `false` (tắt B-P1-1)
- `pa_regOn`: `false` (tắt B-P1-2)
- `pa_tpMode`: `"Theo R"` (tắt B-P1-3)
- `pa_cp_streakOn`: `false` (tắt B-P1-4)
$\rightarrow$ Kết quả điểm số và tín hiệu sẽ tương đồng hoàn toàn với `TM XAU Signals 2`.
