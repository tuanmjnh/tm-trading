# Changelog — Wonderwhales

Tất cả các thay đổi và tiến trình phát triển của chỉ báo **Wonderwhales** được lưu vết tại tài liệu này.

---

## [1.2.0] — 2026-10-24

### Architecture (Tách thành 2 bản chuyên biệt chống lỗi Overlay & Co bẹp chart)
- **Bản 1: `Wonderwhales.pine` (Bản Classic + VSA Volume như trước)**:
  - Khai báo: `overlay = false`.
  - Hiển thị đầy đủ Parabolic SAR Reversal, tín hiệu BUY/SELL, bộ lọc EMA (20/50/200), Bollinger Bands, HUD Dashboard.
  - Cửa sổ phụ VSA Volume 6 cột màu + Volume MA hiển thị mượt mà bên dưới chart giá như trước.
  - Không vẽ nến Neon Trend Candles đè lên chart giá $\rightarrow$ Chart hiển thị nến gốc bình thường 100%, không bị co bẹp tỷ lệ giá.
- **Bản 2: `Wonderwhales Overlay.pine` (Bản Overlay thuần chart giá + Hover Neon)**:
  - Khai báo: `overlay = true`.
  - Thuần túy sống trên Pane 0 (biểu đồ giá chính), **KHÔNG có plot Volume VSA** $\rightarrow$ Trục giá tuyệt đối không bị co bẹp hay méo mó.
  - Hỗ trợ đầy đủ tính năng **Interactive Hover Neon Trend Candles**: Khi hover chuột vào dải Parabolic SAR Reversal (`+`), toàn bộ dải nến chu kỳ lập tức phát sáng rực rỡ màu **Xanh Neon** (từ BUY $\rightarrow$ SELL) và **Đỏ Neon** (từ SELL $\rightarrow$ BUY) giống hệt chỉ báo gốc `（向链而行）`.

---

## [1.1.5] — 2026-10-24

### Changed (Overlay = True & Native Hover Focus Elevation)
- **Chuyển đổi khai báo sang `overlay = true`**:
  - Khắc phục triệt để lỗi không nhận hover trên Pane 0: Khi `overlay = false`, chỉ báo thuộc về Subpane 1 nên TradingView chặn toàn bộ sự kiện hover focus chuột trên Pane 0 (chart giá). Chuyển sang `overlay = true` giúp chỉ báo sống trực tiếp trên biểu đồ giá chính giống 100% bản gốc `（向链而行）开放版 (V1.0)`.
  - Giờ đây khi người dùng rê chuột trực tiếp vào **dải dấu cộng tím hồng Parabolic SAR Reversal (+)** trên biểu đồ giá, cơ chế đồ họa của TradingView nhận diện được layer chỉ báo và lập tức kích hoạt **Hover Focus Elevation**, làm bừng sáng dải nến Xanh Neon (BUY $\rightarrow$ SELL) và Đỏ Neon (SELL $\rightarrow$ BUY) đè lên nến gốc!
- **Kích hoạt mặc định `ww_showTrendCandles = true`**:
  - Không còn bị `color = na` ở trạng thái mặc định; nến neon luôn sẵn sàng được TradingView nâng lên tầng trên cùng khi hover.
- **Volume VSA với `format = format.volume`**:
  - Tương thích hoàn hảo với `overlay = true` trên biểu đồ chính mà không làm co bẹp tỷ lệ giá của nến.

---

## [1.1.4] — 2026-10-24

### Added (Parabolic SAR Trend Regime Highlight & Hover Illumination)
- **Cơ chế tô màu xu hướng Parabolic SAR (Trend Regime)**:
  - Khớp 100% đặc tính của chỉ báo tham khảo: toàn bộ nến từ lúc có tín hiệu BUY cho đến khi gặp tín hiệu SELL sẽ mang màu **Xanh Neon (`#00ff00`)**, và từ nến có tín hiệu SELL cho đến khi gặp tín hiệu BUY sẽ mang màu **Đỏ Neon (`#ff0000`)** (`ww_candleTrendCol = ww_sarDir == 1 ? color.rgb(0, 255, 0) : color.rgb(255, 0, 0)`).
- **Hiệu ứng Interactive Hover Illumination trên TradingView**:
  - `plotcandle` được vẽ với `display = display.all` và `force_overlay = true`.
  - Khi thiết lập thứ tự hiển thị `Send to Back` cho chỉ báo (hoặc nến gốc `Bring to Front`): ở trạng thái bình thường nến gốc TradingView che phủ lên trên (giống **1.PNG**). Khi người dùng rê chuột vào dải dấu cộng Parabolic SAR tím hồng, TradingView tự động kích hoạt **Indicator Focus**, đưa layer của chỉ báo lên trên cùng khiến toàn bộ dải nến từ BUY $\rightarrow$ SELL bừng sáng xanh neon, và từ SELL $\rightarrow$ BUY bừng sáng đỏ neon y hệt **3.PNG**!
- **Dòng trạng thái (Status Line)**:
  - Đồng bộ màu sắc BUY Status (`#00ff00`), SELL Status (`#ff0000`) và 4 giá trị OHLC tự động hiển thị xanh/đỏ theo nhịp xu hướng SAR.

---

## [1.1.3] — 2026-10-24

### Added (Interactive Status Line & Candle Color Sync)
- **Status Line Signal & OHLC Plots**: Bổ sung `plot(ww_signalBuy, ...)`, `plot(ww_signalSell, ...)` và `plotcandle(open, high, low, close, ...)` với cấu hình `display = display.status_line`.
- **Đồng bộ đổi màu động khi di chuột qua nến**: Khi di chuột qua các nến khác nhau trên biểu đồ, 4 giá trị O, H, L, C trên thanh tiêu đề tự động đổi sang màu Xanh lá (nến tăng) hoặc màu Đỏ (nến giảm), và giá trị SAR hiển thị màu Tím hồng sáng, giống hệt hành vi hiển thị của chỉ báo tham khảo ở 1.PNG và 3.PNG.

---

## [1.1.2] — 2026-10-24

### Fixed (Timing & Flip Accuracy)
- **Triệt tiêu độ trễ 1 nến khi lật trạng thái SAR**: Thay thế logic `low/high` cũ bằng `ww_psar < close ? 1 : -1`, đảm bảo tín hiệu BUY/SELL kích hoạt ngay tức thì trên cây nến chạm/xuyên qua SAR, khớp 100% thời điểm với chỉ báo tham khảo trên mọi khung thời gian.

### Changed (Visuals & Status Line)
- **Cập nhật màu sắc Parabolic SAR**: Đổi màu mặc định sang mã tím hồng sáng `#ea5bf7` (RGB `[234, 91, 247]`), tăng độ tương phản và hiệu ứng highlight focus trên TradingView.
- **Tối ưu hóa dòng trạng thái (Status Line Legend)**: Thêm `display = display.none` cho các tham số phụ, giúp thanh tiêu đề chỉ hiển thị 3 thông số cốt lõi `(0.02, 0.02, 0.2)` kèm các giá trị plot rõ ràng, không làm rối màn hình.

### Preserved (User Design Invariants)
- Giữ nguyên cấu hình nhãn tín hiệu: Style `Triangle`, Size `Tiny`.
- Giữ nguyên bố cục hiển thị cửa sổ phụ Volume VSA bên dưới.

---

## [1.1.0] — 2026-10-23

### Added (Display Overlays & Multi-Indicators)
- **Volume VSA Display (Bật mặc định)**:
  - Tô màu nến theo 6 bucket Volume VSA chuẩn (`barcolor`): Tím (Climax >= 2.5x), Đỏ (Very High >= 2.0x), Cam (High >= 1.5x), Xanh (Normal >= 1.0x), Xanh dương (Low >= 0.5x), Xám bạc (Ultra Low < 0.5x).
  - Đánh dấu các nến có khối lượng cao trào đột biến (`Show VSA Climax Markers`).
  - Toàn bộ tham số Volume MA length và ratios đều có inputs cấu hình riêng biệt.
- **Secondary Indicators Display (Tắt mặc định - Opt-in)**:
  - Thêm tùy chọn hiển thị đường 200 EMA Baseline (`Show 200 EMA Baseline`).
  - Thêm tùy chọn hiển thị dải Bollinger Bands kèm vùng nền mờ (`Show Bollinger Bands`).
- **HUD Dashboard Table (Tắt mặc định - Opt-in)**:
  - Thêm bảng điều khiển trạng thái đa chỉ số thu nhỏ ở góc màn hình (`Show HUD Dashboard`).
  - Hiển thị tức thời 6 thông số: PSAR Trend, VSA Volume Bucket + Ratio, RSI (14) status, EMA (20/50), ATR % và 200 EMA Bias.
  - Tùy chỉnh 4 vị trí neo góc biểu đồ và 3 kích cỡ chữ hiển thị.
- **Alerts**:
  - Bổ sung `alertcondition` cho `Wonderwhales VSA Climax` phát hiện thanh khoản cao trào.

### Unchanged (Signal Integrity)
- **Giữ nguyên 100% cấu trúc logic tín hiệu**: 4 chế độ tín hiệu ban đầu (`Parabolic SAR Reversal`, `EMA Crossover`, `SAR + EMA Trend Filter`, `SAR + EMA + ATR Filter`) và điều kiện kích hoạt nhãn BUY/SELL không hề bị can thiệp hay thay đổi.

---

## [1.0.0] — 2026-10-23

### Added
- **Core PSAR Engine**:
  - Triển khai Parabolic SAR chuẩn Pine Script v6 (`ta.sar`) với tham số mặc định 0.02 / 0.02 / 0.2.
  - Bộ phát hiện đảo chiều xu hướng `buyFlip` và `sellFlip` chính xác tại thanh nến chuyển tiếp, loại trừ hoàn toàn tín hiệu lặp trong cùng một xu hướng.
  - Xử lý an toàn giá trị `na` ở các thanh nến đầu biểu đồ.
- **Visuals & Labels**:
  - Dấu chấm/cross PSAR màu tím hồng (`#d946ef`) trên biểu đồ giá theo trạng thái bull/bear.
  - Nhãn tín hiệu **BUY** (xanh lá `#22c55e`) bên dưới nến và **SELL** (đỏ `#ef4444`) phía trên nến.
  - Hỗ trợ đa ngôn ngữ nhãn: Tiếng Anh (`BUY`/`SELL`) và Tiếng Trung (`买`/`卖`).
  - Hỗ trợ 3 kích cỡ nhãn: `Tiny`, `Small`, `Normal`.
  - Công tắc bật/tắt hiển thị PSAR và nhãn BUY/SELL riêng biệt.
- **Anti-Repainting Bar Confirmation**:
  - Tùy chọn `Confirm signals on bar close` (mặc định bật `true`) để chỉ chốt tín hiệu khi nến hoàn tất (`barstate.isconfirmed`).
- **Optional EMA & ATR Filters**:
  - 4 chế độ tín hiệu tùy chọn: `Parabolic SAR Reversal` (mặc định), `EMA Crossover`, `SAR + EMA Trend Filter`, `SAR + EMA + ATR Filter`.
  - Bộ lọc xu hướng EMA nhanh (20) / EMA chậm (50) có tùy chọn vẽ trên chart.
  - Bộ lọc biến động ATR% (`ATR(14) / Close * 100 >= Min ATR %`) để lọc sideway biên hẹp.
- **Alerts**:
  - 3 `alertcondition()` riêng biệt cho `Wonderwhales BUY`, `Wonderwhales SELL` và `Wonderwhales Any Signal`.
- **System Integration**:
  - Xây dựng theo cấu trúc phân rã module `pine/parts-wonderwhales/`.
  - Tích hợp vào hệ thống preprocessor `tools/build.mjs`, xuất file phân phối [pine/dist/Wonderwhales.pine](file:///d:/Applications/tm-trading/pine/dist/Wonderwhales.pine).
  - Bổ sung các lệnh npm: `pine:ww`, `pine:wonderwhales`, `pine:copy:ww`, `pine:copy:wonderwhales`.
  - Bổ sung bộ kiểm thử tự động trong `tools/smoke.mjs`.
