# Wonderwhales — TradingView Indicator (Pine Script v6)

**Phiên bản:** v1.1.4  
**Tác giả:** TM Trading Platform  
**Nền tảng:** TradingView / Pine Script v6  
**Loại script:** Technical Indicator (`overlay = true`) — Hỗ trợ nhận diện đảo chiều xu hướng

---

## 1. Giới thiệu tổng quan

**Wonderwhales** là chỉ báo kỹ thuật hiển thị trực tiếp trên biểu đồ nến, kết hợp thuật toán **Parabolic SAR (PSAR)** cùng các bộ lọc xu hướng **EMA** và biến động **ATR** tùy chọn. 

Từ phiên bản **v1.1.0**, chỉ báo bổ sung thêm hệ thống **hiển thị trực quan Volume VSA** (bật mặc định), các chỉ báo xu hướng/biến động bổ trợ (EMA 200, Bollinger Bands) và **HUD Dashboard Table** tổng hợp trạng thái đa chỉ số thu nhỏ ở góc màn hình (tùy chọn bật/tắt).

> [!IMPORTANT]
> **Nguyên tắc cấu trúc tín hiệu**: Toàn bộ cấu trúc logic phát tín hiệu cốt lõi (4 modes: `Parabolic SAR Reversal`, `EMA Crossover`, `SAR + EMA Trend Filter`, `SAR + EMA + ATR Filter`) được **giữ nguyên vẹn 100%**. Việc nâng cấp chỉ tập trung vào việc **hiển thị thêm thông tin (Visual Overlays)** và cung cấp công tắc bật/tắt độc lập cho từng tính năng.

---

## 2. Các tính năng chính (v1.1.0)

1. **Parabolic SAR Flip Engine (Nguyên bản)**:
   - Sử dụng hàm chuẩn `ta.sar()` với bộ tham số mặc định: `Start = 0.02`, `Increment = 0.02`, `Maximum = 0.2`.
   - Hiển thị dấu cross/dots màu tím hồng (`#d946ef`) trên biểu đồ giá theo đúng trạng thái xu hướng.
2. **Nhãn tín hiệu trực quan**:
   - Nhãn xanh **BUY** (hoặc tiếng Trung **买**) nằm bên dưới nến khi xu hướng chuyển sang tăng.
   - Nhãn đỏ **SELL** (hoặc tiếng Trung **卖**) nằm phía trên nến khi xu hướng chuyển sang giảm.
   - Hỗ trợ 3 kích cỡ: `Tiny`, `Small`, `Normal`.
3. **Cơ chế chống Repainting (Bar-Close Confirmation)**:
   - Tùy chọn `Confirm signals on bar close` (mặc định bật `true`).
   - Tín hiệu vẽ trên biểu đồ và cảnh báo Alert chỉ kích hoạt khi nến đóng hoàn tất (`barstate.isconfirmed`).
4. **Volume VSA Display (Mặc định BẬT)**:
   - **Tô màu nến VSA (Barcolor)**: Phân loại 6 bucket volume chuẩn: Tím (Climax >= 2.5x), Đỏ (Very High >= 2.0x), Cam (High >= 1.5x), Xanh (Normal >= 1.0x), Xanh dương (Low >= 0.5x), Xám bạc (Ultra Low < 0.5x).
   - **Dấu Climax Spike Markers**: Hiển thị dấu `x` tím phía trên các nến có volume đột biến cao trào.
   - Có công tắc bật/tắt riêng trong phần cài đặt.
5. **Chỉ báo bổ trợ hiển thị thêm (Mặc định TẮT - Opt-in)**:
   - **200 EMA Baseline**: Đường xu hướng dài hạn màu vàng (`Show 200 EMA Baseline`).
   - **Bollinger Bands**: Dải băng biến động chuẩn kèm vùng nền mờ (`Show Bollinger Bands`).
   - **Fast / Slow EMA Lines**: Đường EMA 20 và 50 (`Show Fast/Slow EMA Lines`).
6. **HUD Dashboard Table (Mặc định TẮT - Opt-in)**:
   - Bảng hiển thị đa chỉ báo thu nhỏ tại góc chart (`Top Right`, `Bottom Right`, `Top Left`, `Bottom Left`).
   - Cung cấp cái nhìn toàn cảnh tức thời:
     - Trạng thái xu hướng PSAR (BULLISH / BEARISH).
     - Bucket Volume VSA hiện tại kèm hệ số ratio (ví dụ: `VeryHigh (2.15x)`).
     - Trạng thái RSI (14) (Chỉ số + Overbought/Oversold/Neutral).
     - Trạng thái EMA (20/50) và ATR % biến động.
     - Vị thế so với đường 200 EMA.
7. **Cảnh báo (Alerts)**:
   - `Wonderwhales BUY`, `Wonderwhales SELL`, `Wonderwhales Any Signal`.
   - Bổ sung `Wonderwhales VSA Climax` cảnh báo khi xuất hiện nến volume tím.

---

## 3. Cấu hình tham số (Inputs)

### Nhóm: Parabolic SAR
| Tham số | Giá trị mặc định | Giải thích |
|---|---:|---|
| **Initial Acceleration Factor** | `0.02` | Hệ số gia tốc ban đầu cho PSAR |
| **Increment** | `0.02` | Bước tăng hệ số gia tốc mỗi khi giá tạo đỉnh/đáy mới |
| **Maximum Acceleration Factor** | `0.2` | Ngưỡng trần tối đa cho hệ số gia tốc |

### Nhóm: Signal Settings (Cấu trúc giữ nguyên)
| Tham số | Giá trị mặc định | Giải thích |
|---|---:|---|
| **Signal Mode** | `Parabolic SAR Reversal` | Chế độ tính tín hiệu (PSAR Reversal / EMA Crossover / SAR+EMA / SAR+EMA+ATR) |
| **Confirm signals on bar close** | `true` | Chỉ chốt tín hiệu khi nến đã đóng để chống repaint |
| **Label Language** | `EN (BUY/SELL)` | Ngôn ngữ hiển thị nhãn: `EN (BUY/SELL)` hoặc `CN (买/卖)` |

### Nhóm: Volume VSA (Display - Mặc định BẬT)
| Tham số | Giá trị mặc định | Giải thích |
|---|---:|---|
| **Color Bars by VSA Volume** | `true` | Tô màu thân nến theo 6 bucket Volume VSA |
| **Show VSA Climax Markers** | `true` | Hiển thị dấu x tím trên nến có Volume đột biến |
| **Volume MA Length** | `20` | Chu kỳ trung bình động của khối lượng |
| **Climax / Spike Ratio** | `2.5x` | Ngưỡng khối lượng đột biến (Tím) |
| **Very High Ratio** | `2.0x` | Ngưỡng khối lượng siêu cao (Đỏ) |
| **High Ratio** | `1.5x` | Ngưỡng khối lượng cao (Cam) |
| **Normal Ratio** | `1.0x` | Ngưỡng khối lượng bình thường (Xanh) |
| **Low Ratio** | `0.5x` | Ngưỡng khối lượng thấp (Xanh dương / Bạc) |

### Nhóm: Secondary Indicators (Display - Mặc định TẮT)
| Tham số | Giá trị mặc định | Giải thích |
|---|---:|---|
| **Show 200 EMA Baseline** | `false` | Bật/tắt hiển thị đường 200 EMA xu hướng dài hạn |
| **200 EMA Length** | `200` | Chu kỳ đường baseline EMA |
| **Show Bollinger Bands** | `false` | Bật/tắt hiển thị dải Bollinger Bands |
| **BB Length** | `20` | Chu kỳ SMA của Bollinger Bands |
| **BB StdDev Multiplier** | `2.0` | Hệ số độ lệch chuẩn Bollinger Bands |
| **Show Fast/Slow EMA Lines** | `false` | Bật/tắt hiển thị đường EMA nhanh (20) và chậm (50) |

### Nhóm: HUD Dashboard (Display - Mặc định TẮT)
| Tham số | Giá trị mặc định | Giải thích |
|---|---:|---|
| **Show HUD Dashboard** | `false` | Bật/tắt bảng trạng thái đa chỉ báo ở góc màn hình |
| **Dashboard Position** | `Top Right` | Vị trí đặt bảng: `Top Right`, `Bottom Right`, `Top Left`, `Bottom Left` |
| **Dashboard Text Size** | `Small` | Kích cỡ chữ trong bảng: `Tiny`, `Small`, `Normal` |
| **RSI Length for HUD** | `14` | Chu kỳ RSI hiển thị trong bảng điều khiển |

---

## 4. Hướng dẫn cài đặt vào TradingView

Sử dụng lệnh copy tự động qua clipboard:
```bash
npm run pine:copy:ww
# hoặc
npm run pine:copy:wonderwhales
```
Mã nguồn [pine/dist/Wonderwhales.pine](file:///d:/Applications/tm-trading/pine/dist/Wonderwhales.pine) sẽ được copy tự động vào clipboard -> Dán vào Pine Editor trên TradingView -> Bấm **Add to chart**.
