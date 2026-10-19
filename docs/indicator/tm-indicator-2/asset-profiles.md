# Multi-Asset & Inter-Market Profiles — TM Indicator 2 (v2.0)

> **Document Type:** Quantitative Asset Profiling & Inter-Market Specification  
> **Target Script:** `TM Indicator 2.pine` & `TM Indicator Strategy Lab 2.pine`  
> **Status:** APPROVED — Phase 2 Standard

---

## 1. Triết lý Thiết kế Đa Tài sản (Asset-Neutral & Adaptive)

Trong giao dịch phái sinh (Futures), mỗi nhóm tài sản sở hữu cấu trúc biến động, độ sâu thanh khoản và hành vi vi mô (microstructure) hoàn toàn khác nhau:
- **XAU (Gold):** Bị chi phối mạnh bởi phiên giao dịch (London Open, New York Open), phản ứng cực nhạy với tin tức kinh tế Mỹ (CPI, FOMC, NFP) và có tính tôn trọng các vùng thanh khoản S/R / PDH / PDL cao.
- **BTC (Bitcoin):** Tài sản dẫn dắt thanh khoản toàn bộ thị trường tiền mã hóa, vận hành 24/7/365, nhạy cảm với các nhịp nén biến động (Volatility Squeeze) và bùng nổ xung lực mạnh (Impulse moves).
- **ETH & Liquid Altcoins (SOL, BNB, XRP, ...):** Chịu rủi ro hệ thống (Beta risk) từ BTC. Mọi vị thế Long Altcoin đều có xác suất thua lỗ cực cao nếu BTC đang trong một nhịp bán tháo mạnh (Bearish Impulse/Dump).
- **High-Risk Altcoins:** Thanh khoản mỏng, chênh lệch giá (Spread) lớn, dễ bị thao túng hoặc quét râu nhân tạo (Wick hunting).

Hệ thống **TM Indicator 2** giải quyết triệt để vấn đề này bằng cách:
1. **Chuẩn hóa toàn bộ tham số khoảng cách sang ATR, ATR% và R-multiples:** Không dùng giá trị pips hay USD cố định.
2. **Hệ thống Profiles động với cơ chế Auto-Detection:** Tự động điều chỉnh độ nhạy theo từng nhóm tài sản.
3. **Bộ lọc dẫn dắt liên thị trường (BTC Leader Filter):** Bảo vệ các vị thế ETH và Altcoins.
4. **Bộ lọc thanh khoản cuối tuần (Crypto Weekend Filter):** Phòng tránh các bẫy thanh khoản thấp vào Thứ Bảy / Chủ Nhật.

---

## 2. Ma trận Cấu hình Tham số theo Profile (Asset Matrix)

| Tham số / Cơ chế | `XAU` (Vàng) | `BTC` | `ETH` | `Liquid Altcoin` | `High-Risk Altcoin` | `Custom` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SL Multiplier (x ATR)** | `1.5x` | `1.8x` | `2.0x` | `2.2x` | `2.8x` | User Config |
| **SL Pad sau Swing (x ATR)** | `0.20x` | `0.25x` | `0.25x` | `0.30x` | `0.40x` | User Config |
| **TP1 (Quick BE)** | `1.0R` | `1.0R` | `1.0R` | `1.0R` | `1.2R` | User Config |
| **TP2 (Standard Target)** | `2.0R` | `2.0R` | `2.0R` | `2.2R` | `2.5R` | User Config |
| **TP3 (Runner Target)** | `3.0R` | `3.5R` | `3.5R` | `4.0R` | `4.5R` | User Config |
| **Min RR (kiểm tra tại TP2)**| `1.5R` | `1.5R` | `1.5R` | `1.8R` | `2.0R` | User Config |
| **Session Weighting** | **Bật (Cao)** | Trung tính (0) | Trung tính (0) | Trung tính (0) | Trung tính (0) | Tùy chọn |
| **BTC Leader Filter** | Tắt | Tắt (Self) | **Bật** | **Bật** | **Bật (Bắt buộc)** | Tùy chọn |
| **Weekend Filter** | Tắt (Đóng cửa) | **Bật** | **Bật** | **Bật** | **Bật (Khóa lệnh)** | Tùy chọn |
| **Max Hold Timeout (nến)** | `200` | `300` | `300` | `250` | `150` | User Config |
| **Phí + Trượt giá Buffer** | `0.04%` | `0.08%` | `0.08%` | `0.10%` | `0.20%` | User Config |
| **Đòn bẩy tối đa khuyến nghị**| `20x` | `15x` | `10x` | `5x` | `2x - 3x` | User Config |

---

## 3. Cơ chế Hoạt động của Bộ lọc Liên thị trường (BTC Leader Filter)

### 3.1 Nguyên lý Toán học & Dữ liệu
- Script thực hiện truy vấn dữ liệu từ mã chuẩn hóa `BINANCE:BTCUSDT.P` trên cùng khung thời gian thông qua hàm đóng gói Tuple:
  ```pinescript
  [btcClose, btcEmaF, btcRsi, btcAtr] = request.security(tm_btcTicker, timeframe.period, [close[1], ta.ema(close, 20)[1], ta.rsi(close, 14)[1], ta.atr(14)[1]], lookahead = barmerge.lookahead_on, gaps = barmerge.gaps_off)
  ```
- Định nghĩa trạng thái **BTC Bearish Impulse (Xả mạnh):**
  $$\text{BTC Dumping} = \left(\text{Close}_{\text{BTC}} < \text{EMA}_{20} - 1.5 \times \text{ATR}_{\text{BTC}}\right) \lor \left(\text{RSI}_{\text{BTC}} < 32\right)$$
- Định nghĩa trạng thái **BTC Bullish Impulse (Bơm mạnh):**
  $$\text{BTC Pumping} = \left(\text{Close}_{\text{BTC}} > \text{EMA}_{20} + 1.5 \times \text{ATR}_{\text{BTC}}\right) \lor \left(\text{RSI}_{\text{BTC}} > 68\right)$$

### 3.2 Logic Can thiệp Lệnh (Veto Rules)
1. **Chặn lệnh LONG Altcoin:** Nếu một Altcoin (ví dụ SOLUSDT) xuất hiện tín hiệu LONG hợp lệ theo cấu trúc cục bộ, nhưng BTC đang ở trạng thái `BTC Dumping`, hệ thống ngay lập tức kích hoạt cổng chặn `BTC_DUMPING_VETO`. Lệnh bị hủy bỏ ngay tại tầng Eligibility Gate để tránh hiện tượng "bắt đáy dao rơi".
2. **Chặn lệnh SHORT Altcoin:** Ngược lại, nếu Altcoin có tín hiệu SHORT nhưng BTC đang `BTC Pumping`, cổng `BTC_PUMPING_VETO` sẽ khóa lệnh SHORT để tránh bị quét bởi lực kéo toàn thị trường.

---

## 4. Chính sách Thanh khoản Cuối tuần (Crypto Weekend Filter)

### 4.1 Vấn đề Thực nghiệm
Vào Thứ Bảy và Chủ Nhật, dòng tiền từ các quỹ đầu tư tổ chức (Institutional Market Makers) và các thị trường chứng khoán truyền thống tạm ngưng hoạt động. Khối lượng giao dịch Crypto sụt giảm từ 40% đến 70%, dẫn đến:
- Hiện tượng giá dao động quanh biên hẹp (Chop/Range) sinh ra nhiều tín hiệu phá vỡ giả (Fake Breakout / Bull Trap).
- Tỷ lệ trượt giá (Slippage) tăng cao bất thường.

### 4.2 Giải pháp Xử lý
- Kiểm tra biến thời gian: `isWeekend = dayofweek == dayofweek.saturday or dayofweek == dayofweek.sunday`.
- Nếu tài sản là Crypto và `tm_weekendFilter == true`:
  - Kiểm tra điều kiện suy giảm thanh khoản: $\text{Volume Ratio} < 0.8 \lor \text{ATR}\% < 0.6\%$.
  - Khi thỏa mãn, hệ thống chuyển sang trạng thái cảnh báo thanh khoản thấp `WEEKEND_LOW_LIQUIDITY` trên Dashboard và khóa các tín hiệu phá vỡ biên (Breakout Signals), chỉ cho phép các thiết lập đảo chiều có xác nhận cực cao ($Score \ge 85$).
