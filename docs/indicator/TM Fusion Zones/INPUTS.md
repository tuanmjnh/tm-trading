# Bảng Tham Số Cài Đặt (Inputs) — TM Fusion Zones

> Tài liệu mô tả chi tiết tất cả các tham số cấu hình trong chỉ báo **TM Fusion Zones**
> và chiến lược kiểm thử **TM Fusion Zones Backtest**.

---

## 1. Nhóm Chung & Chế Độ (FZ · Chung)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Chỉ tín hiệu nến đã đóng | `fz_confirmOnly` | `true` | bool | Chống repaint: Chỉ phát tín hiệu khi nến đã hoàn thành. |
| Webhook payload | `fz_payloadMode` | `"Full"` | `"Full"`, `"Slim"`, `"Off"` | Cấu hình định dạng cảnh báo JSON gửi tới bot hoặc webhook. |
| Asset Profile | `fz_assetMode` | `"Auto"` | `"Auto"`, `"XAU"`, `"BTC"`, `"ETH"`, `"Crypto Other"`, `"Custom"` | Hồ sơ tài sản tự động tinh chỉnh biên độ đệm biến động ATR. |

---

## 2. Nhóm Trend Ribbon (FZ · Trend Ribbon)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Hiển thị Trend Ribbon | `fz_rb_show` | `true` | bool | Bật/tắt hiển thị dải băng xu hướng trên chart. |
| Ribbon MA Type | `fz_rb_type` | `"EMA"` | `"EMA"`, `"SMA"`, `"HMA"` | Loại đường trung bình động tính cho dải mây. |
| Ribbon Fast Length | `fz_rb_fast` | `20` | `2..200` | Chu kỳ đường MA nhanh của dải băng. |
| Ribbon Slow Length | `fz_rb_slow` | `50` | `5..500` | Chu kỳ đường MA chậm của dải băng. |
| Bắt buộc cùng chiều Ribbon | `fz_rb_filter` | `true` | bool | Bộ lọc xu hướng: chỉ cho phép LONG khi Ribbon xanh và SHORT khi Ribbon đỏ. |

---

## 3. Nhóm Vùng Cung Cầu Động (FZ · Dynamic Zones)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Hiển thị Supply / Demand Zones | `fz_zn_show` | `true` | bool | Bật/tắt vẽ các hộp vùng Cung Cầu động trên biểu đồ. |
| Zone Pivot Lookback | `fz_zn_swLen` | `7` | `2..50` | Số nến nhìn về hai phía để xác nhận điểm Pivot tạo vùng. |
| Zone Width (x ATR) | `fz_zn_widthAtr` | `0.5` | min `0.1`, step `0.05` | Độ dày của vùng tính theo hệ số biến động ATR. |
| Số lượng Zones tối đa | `fz_zn_max` | `10` | `2..30` | Hạn mức số lượng vùng hoạt động để tối ưu bộ nhớ. |

---

## 4. Nhóm Cấu Trúc & Thanh Khoản (FZ · Structure & Liquidity)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Hiển thị BOS / CHoCH | `fz_ms_show` | `true` | bool | Bật/tắt phát hiện và vẽ phá vỡ cấu trúc đỉnh đáy. |
| Structure Swing Lookback | `fz_ms_swLen` | `5` | `2..20` | Độ nhạy của các điểm sóng cấu trúc thị trường. |
| Phát hiện Liquidity Sweep | `fz_ms_sweepOn` | `true` | bool | Nhận diện quét thanh khoản khi bóng nến vượt đỉnh đáy rồi đóng ngược lại. |
| Hiển thị PDH / PDL | `fz_ms_pdOn` | `true` | bool | Theo dõi đỉnh đáy ngày hôm trước (Previous Day High/Low). |

---

## 5. Nhóm 3 Setup Vào Lệnh (FZ · Entry Setups)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Setup 1: Trend Pullback | `fz_setup_pullback` | `true` | bool | Bật/tắt giao dịch theo sóng hồi về Ribbon hoặc Zone thuận xu hướng. |
| Setup 2: Liquidity Sweep Reversal | `fz_setup_sweep` | `true` | bool | Bật/tắt giao dịch đảo chiều sau khi quét thanh khoản. |
| Setup 3: Range Mean-Reversion | `fz_setup_range` | `false` | bool | Bật/tắt đánh bật nảy tại biên vùng khi thị trường đi ngang (Chop/Range). |
| Pullback Tolerance (x ATR) | `fz_pull_tol` | `0.4` | min `0.1`, step `0.05` | Khoảng dung sai cho phép giá tiếp cận dải băng. |
| Cửa sổ xác nhận Sweep | `fz_sweep_confBars` | `3` | `1..10` | Số lượng nến tối đa để tìm nến xác nhận sau cú quét thanh khoản. |

---

## 6. Nhóm Khung Thời Gian Lớn (FZ · MTF Context)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Bật HTF Context Bias | `fz_mtf_on` | `true` | bool | Kích hoạt bộ lọc định hướng theo khung thời gian cao hơn. |
| HTF Context Timeframe | `fz_mtf_tf` | `"240"` (4h) | `"60"`, `"240"`, `"D"`, `"W"` | Khung thời gian bối cảnh tham chiếu. |
| HTF Trend EMA Length | `fz_mtf_len` | `100` | `10..500` | Chu kỳ đường EMA đo lường xu hướng trên khung thời gian lớn. |

---

## 7. Nhóm Trọng Số Điểm (FZ · Scoring Weights & Thresholds)

| Tên tham số | Biến Pine | Mặc định | Trọng số tối đa | Ý nghĩa giao dịch |
|---|---|---|---|---|
| W: Trend (Ribbon) | `fz_w_trend` | `25.0` | 25% | Điểm đóng góp từ xu hướng và độ mở rộng của Ribbon. |
| W: Zone (Supply/Demand) | `fz_w_zone` | `25.0` | 25% | Điểm đóng góp từ việc giá phản ứng tại vùng Cung/Cầu hợp lệ. |
| W: Structure (BOS/Sweep) | `fz_w_struct` | `20.0` | 20% | Điểm đóng góp từ sự kiện cấu trúc (CHoCH, Sweep, BOS). |
| W: Candle Confirmation | `fz_w_candle` | `15.0` | 15% | Điểm đóng góp từ mẫu nến đảo chiều (Pinbar, Engulfing). |
| W: MTF Alignment | `fz_w_mtf` | `15.0` | 15% | Điểm đóng góp từ việc đồng pha với khung thời gian lớn. |
| Score <= NO TRADE | `fz_scr_noTrade` | `49` | `0..99` | Dưới hoặc bằng ngưỡng này sẽ bị Cổng chất lượng loại bỏ. |
| Score <= SETUP | `fz_scr_setup` | `65` | `1..99` | Ngưỡng đạt cấp độ thiết lập giao dịch cơ bản. |
| Score <= STRONG | `fz_scr_strong` | `78` | `1..99` | Ngưỡng thiết lập giao dịch mạnh. |
| Min LONG/SHORT Score Gap | `fz_scoreMargin` | `8` | `0..50` | Chênh lệch điểm tối thiểu khi cả hai hướng đều phát hiện setup. |

---

## 8. Nhóm Quản Trị Rủi Ro & TP/SL (FZ · Risk & TP/SL)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Kiểu đặt SL | `fz_sl_mode` | `"Zone / Swing"` | `"Zone / Swing"`, `"ATR Multiplier"` | Phương pháp định vị mức dừng lỗ. |
| SL = ATR x | `fz_sl_atrMul` | `1.5` | min `0.5`, step `0.1` | Hệ số ATR khi sử dụng chế độ dừng lỗ cố định theo ATR. |
| Đệm SL (x ATR) | `fz_sl_padAtr` | `0.2` | min `0.05`, step `0.05` | Khoảng đệm an toàn đặt ngoài biên vùng hoặc đỉnh đáy sóng. |
| SL min (x ATR) | `fz_sl_minAtr` | `0.5` | min `0.2`, step `0.1` | Giới hạn khoảng cách SL tối thiểu nhằm tránh dính nhiễu. |
| SL max (x ATR) | `fz_sl_maxAtr` | `3.5` | min `1.0`, step `0.1` | Giới hạn khoảng cách SL tối đa nhằm tránh vào lệnh rủi ro quá lớn. |
| TP1 (R) | `fz_rr1` | `1.0` | min `0.5`, step `0.1` | Mức chốt lời 1 đạt tỷ lệ R:R tương ứng. |
| TP2 (R) | `fz_rr2` | `2.0` | min `1.0`, step `0.1` | Mức chốt lời 2 đạt tỷ lệ R:R tương ứng. |
| TP3 (R) | `fz_rr3` | `3.0` | min `1.5`, step `0.1` | Mức chốt lời 3 đạt tỷ lệ R:R tương ứng. |
| RR tối thiểu kiểm tra | `fz_rrMin` | `1.5` | min `0.5`, step `0.1` | Cổng kiểm tra: chặn lệnh nếu RR tới TP2 nhỏ hơn ngưỡng này. |
| Obstacle Gate | `fz_obstacleGate` | `true` | bool | Chặn lệnh nếu có vùng cản đối diện nằm gần hơn mục tiêu TP1. |
| Cooldown giữa 2 lệnh | `fz_coolBars` | `8` | min `0` nến | Thời gian giãn cách tối thiểu giữa 2 tín hiệu liên tiếp. |

---

## 9. Nhóm Giao Diện & Bảng Điều Khiển (FZ · Display)

| Tên tham số | Biến Pine | Mặc định | Tùy chọn / Giới hạn | Ý nghĩa giao dịch |
|---|---|---|---|---|
| Master Visual Switch | `fz_showViz` | `true` | bool | Công tắc tổng: tắt toàn bộ hình vẽ trên biểu đồ chỉ bằng 1 cú click. |
| Màu LONG / Bull Ribbon | `fz_cBull` | `#089981` | color | Màu sắc nhận diện phía tăng giá. |
| Màu SHORT / Bear Ribbon | `fz_cBear` | `#f23645` | color | Màu sắc nhận diện phía giảm giá. |
| Hiển thị nhãn Entry | `fz_showSig` | `true` | bool | Bật/tắt nhãn tam giác vào lệnh LONG / SHORT. |
| Hiển thị nhãn TP/SL hit | `fz_showHit` | `true` | bool | Bật/tắt các điểm đánh dấu khi giá chạm mốc TP1, TP2 hoặc SL. |
| Hiển thị Dashboard | `fz_showDash` | `true` | bool | Bật/tắt bảng HUD thông số góc trên bên phải. |
| Dashboard Mode | `fz_dashMode` | `"Compact"` | `"Compact"`, `"Advanced"` | Chế độ bảng gọn (7 dòng) hoặc chuyên sâu (12 dòng). |
| Dashboard Size | `fz_dashSize` | `"Small"` | `"Tiny"`, `"Small"`, `"Normal"` | Cỡ chữ hiển thị của bảng điều khiển. |
| Múi giờ thị trường | `fz_sessTz` | `"America/New_York"` | `"America/New_York"`, `"UTC"`,... | Múi giờ đối chiếu cho các phiên giao dịch Asia / London / New York. |
