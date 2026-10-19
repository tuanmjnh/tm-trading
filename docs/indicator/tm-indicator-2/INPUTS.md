# TM Indicator 2 — Bảng Tra cứu Tham số Inputs & Presets (v2.1.0)

Tài liệu này giải thích chi tiết toàn bộ các thông số cấu hình của **`TM Indicator 2.pine`** & **`TM Indicator Strategy Lab 2.pine`** (nguồn `pine/parts-tm/01_inputs_and_profiles.pine`).

---

## 1. Bảng Tra cứu Toàn bộ Tham số

### Nhóm 1: Cấu hình Chung & Chế độ Chạy (`TM · Chung`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Chi tin hieu nen da dong (no-repaint) | `tm_confirmOnly` | bool | `true` | Bật = chỉ kích hoạt tín hiệu khi nến đã đóng hoàn toàn, triệt tiêu 100% Repaint. |
| Webhook payload | `tm_payloadMode` | string | `"Full"` | Cấu hình định dạng JSON webhook: `"Full"`, `"Slim"`, `"Off"`. |

---

### Nhóm 2: Hồ sơ Tài sản & Liên thị trường (`TM · Asset Profile`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Asset Profile | `tm_assetMode` | string | `"Auto"` | Hồ sơ tự động nhận diện theo mã ticker (`"Auto"`, `"XAU"`, `"BTC"`, `"ETH"`, `"Liquid Altcoin"`, `"High-Risk Altcoin"`, `"Custom"`). |
| Crypto 24/7: Session neutral | `tm_cryptoSessionNeutral` | bool | `true` | Không phạt điểm phiên giao dịch đối với thị trường Crypto hoạt động 24/7. |
| Kiem tra thanh khoan toi thieu | `tm_minVolCheck` | bool | `true` | Chặn lệnh nếu thanh khoản tài sản quá mỏng. |
| Weekend Low-Liquidity Filter (Crypto) | `tm_weekendFilter` | bool | `true` | Khóa lệnh vào cuối tuần đối với Crypto để phòng tránh trượt giá và bẫy cá voi. |
| BTC Leader Filter (cho ETH/Altcoin) | `tm_btcLeaderOn` | bool | `true` | Kiểm tra xung lực của Bitcoin để bảo vệ lệnh mua/bán của Altcoin. |
| BTC Leader Ticker | `tm_btcTicker` | symbol | `"BINANCE:BTCUSDT.P"` | Mã hợp đồng phái sinh của Bitcoin dùng để tham chiếu. |
| BTC Impulse Filter (x ATR) | `tm_btcImpulseAtr` | float | `1.5` | Ngưỡng biến động đột biến của BTC để ngắt tạm thời tín hiệu Altcoin. |

---

### Nhóm 3: Khớp lệnh Thông minh & Entry Modes (`TM · Smart Entry Execution & Entry Modes`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Che do vao lenh | `tm_entryMode` | string | `"Auto (Adaptive)"` | `"Market on Confirm"`, `"Pullback Limit (Strict)"`, `"Auto (Adaptive)"`. |
| Vi tri dat Limit | `tm_limitSource` | string | `"50% FVG"` | `"50% FVG"`, `"Order Block Edge"`, `"EMA Fast Pullback"`. |
| Huy Limit sau K nen khong khop | `tm_limitCancelBars` | int | `5` | Tự động hủy lệnh Limit nếu sau N nến không hồi về khớp. |
| Huy Limit neu gia da cham TP1 truoc | `tm_limitCancelOnTp1` | bool | `true` | Hủy ngay lệnh Limit nếu giá đã chạy chạm TP1 trước khi khớp. |
| Require an active entry mode (A/B/C) | `tm_modeFilterOn` | bool | `true` | Bắt buộc setup phải thuộc về 1 trong 3 Mode A/B/C được kích hoạt. |
| Mode A: Trend Pullback | `tm_modeA_on` | bool | `true` | Đánh tiếp diễn khi thị trường Trending và giá pullback về EMA/FVG/OB. |
| Mode B: Liquidity Sweep Reversal | `tm_modeB_on` | bool | `true` | Đánh đảo chiều sau khi quét thanh khoản (Liquidity Sweep). |
| Mode C: Range Mean-Reversion | `tm_modeC_on` | bool | `false` | Đánh bật ngược biên khi thị trường Ranging (mặc định tắt cho người mới). |
| Mode B confirmation window (bars) | `tm_modeSweepBars` | int | `3` | Cửa sổ xác nhận nến đảo chiều sau pha sweep. |
| Mode A pullback tolerance (x ATR) | `tm_modePullTol` | float | `0.35` | Dung sai khoảng cách giá hồi về EMA/FVG. |
| Mode C range-edge tolerance (x ATR) | `tm_modeRangeTol` | float | `0.35` | Dung sai khoảng cách tới biên hộp tích lũy. |

---

### Nhóm 4: Quản lý Vị thế Động (`TM · Dynamic Management`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Auto Break-Even tai TP1 | `tm_autoBeOn` | bool | `true` | Tự động dời SL về điểm hòa vốn (cộng đệm phí) ngay khi chạm TP1 (1.0R). |
| Dem BE bao ve phi (x ATR) | `tm_beOffsetAtr` | float | `0.05` | Khoảng cộng thêm trên giá Entry để bù đắp phí giao dịch và trượt giá. |
| Trailing Stop sau khi cham TP2 | `tm_trailOn` | bool | `true` | Kích hoạt thả trôi lợi nhuận bảo vệ tối thiểu 1.0R khi đã chạm TP2. |
| Kieu Trailing | `tm_trailType` | string | `"ATR Dynamic"` | `"ATR Dynamic"` hoặc `"Structure Swing"`. |
| Khoang cach Trail (x ATR) | `tm_trailDistAtr` | float | `1.5` | Khoảng cách bám theo giá của đường Trailing Stop. |
| Time-Decay / Stagnation Exit | `tm_timeDecayOn` | bool | `true` | Cắt lệnh hòa vốn sớm nếu giá đi ngang không tiến triển sau nhiều nến. |
| Nen thoat lenh neu < 0.3R | `tm_stagnantBars` | int | `15` | Thoát lệnh sau 15 nến nếu lợi nhuận chưa đạt $0.3\text{R}$ và động lượng suy yếu. |
| Thoi gian giu toi da (nen timeout) | `tm_maxHoldBars` | int | `300` | Giới hạn tối đa số nến giữ một vị thế. |

---

### Nhóm 5: Cổng An toàn & Phủ quyết (`TM · Eligibility Gates`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Gate 1: Market Regime Filter | `tm_gate_regime` | bool | `true` | Chặn các lệnh Breakout khi thị trường đang Choppy/Squeeze. |
| Gate 2: MTF & BTC Leader Consensus | `tm_gate_mtf` | bool | `true` | Chặn lệnh khi khung lớn hoặc BTC Leader đối lập xu hướng. |
| Gate 3: Obstacle Gate (Room-to-Left) | `tm_gate_obstacle` | bool | `true` | Chặn lệnh nếu có cản cứng (S/R, FVG) gần hơn khoảng cách tới TP1. |
| Gate 4: Anti-Overextension Gate | `tm_gate_overext` | bool | `true` | Chặn mua/bán đuổi khi giá đã giãn quá xa EMA ($> 2.2\times\text{ATR}$). |
| Gate 5: Circuit Breaker & Max Losses | `tm_gate_circuit` | bool | `true` | Ngắt giao dịch trong ngày khi chuỗi thua liên tiếp chạm giới hạn. |
| Gate 6: Futures Margin & Liquidation | `tm_gate_risk` | bool | `true` | Kiểm tra khoảng cách giá cháy (Liquidation Price) an toàn sau Stop-Loss. |

---

### Nhóm 6: Phân loại Trạng thái Thị trường (`TM · Market Regime`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| ADX nguong TRENDING | `tm_regimeAdxTrending` | float | `22.0` | Thị trường bước vào pha Trend rõ ràng khi $\text{ADX} \ge 22$. |
| ADX nguong CHOP / SQUEEZE | `tm_regimeAdxChop` | float | `18.0` | Thị trường rơi vào pha tích lũy/hỗn loạn khi $\text{ADX} < 18$. |
| Bollinger Width lookback | `tm_regimeBbwLen` | int | `100` | Chu kỳ nến đo độ co thắt của dải Bollinger Bands. |
| BBW Squeeze Percentile (%) | `tm_regimeBbwSqueezePct` | float | `20.0` | Ngưỡng phần trăm độ co thắt xác định pha Squeeze nén chặt. |

---

### Nhóm 7: Chấm điểm Hai chiều & Ngưỡng Chất lượng (`TM · Score Thresholds`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Score <= NO TRADE | `tm_scr_noTrade` | int | `49` | Dưới 50 điểm: Không đủ điều kiện vào lệnh. |
| Score <= WEAK | `tm_scr_weak` | int | `64` | 50–64 điểm: Tín hiệu yếu, chỉ theo dõi. |
| Score <= SETUP | `tm_scr_setup` | int | `74` | 65–74 điểm: Đủ chuẩn SETUP. |
| Score <= STRONG | `tm_scr_strong` | int | `84` | 75–84 điểm: Tín hiệu STRONG tin cậy cao. |
| Cap do chat luong toi thieu | `tm_minQuality` | string | `"SETUP"` | Bộ lọc chất lượng tối thiểu để phát alert: `"WEAK"`, `"SETUP"`, `"STRONG"`, `"A+"`. |
| Min LONG/SHORT score gap | `tm_scoreMargin` | int | `8` | **v2.1:** Điểm bên chọn phải lớn hơn bên đối diện tối thiểu 8 điểm, tránh ép lệnh khi tín hiệu tranh chấp. |
| Ablation feature config | `tm_ablationMode` | string | `"E (Full)"` | Cấu hình kiểm thử bóc tách tính năng (A đến E). |

---

### Nhóm 8: Quản lý Rủi ro Futures & Mục tiêu (`TM · Risk & Targets & Futures Risk`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| SL = ATR x | `tm_sl_atrMul` | float | `1.5` | Khoảng cách SL tính theo ATR. |
| Swing lookback SL | `tm_sl_swing` | int | `10` | Số nến tìm đỉnh/đáy swing để neo SL. |
| TP1 (R) [Partial & Auto-BE] | `tm_rr1` | float | `1.0` | Chốt lời 1: Chốt 50% khối lượng và dời SL về BE. |
| TP2 (R) [Standard Target] | `tm_rr2` | float | `2.0` | Chốt lời 2: Chốt thêm 30% khối lượng và kích hoạt trailing stop. |
| TP3 (R) [Runner Target] | `tm_rr3` | float | `3.0` | Chốt lời 3: Chốt nốt phần còn lại. |
| RR toi thieu kiem tra tai TP2 | `tm_rrMin` | float | `1.5` | Lọc bỏ các setup có $R:R < 1.5$ tại TP2. |
| Lenh toi da / ngay | `tm_maxDay` | int | `4` | Số lệnh tối đa trong ngày. |
| Cooldown giua 2 lenh (nen) | `tm_coolBars` | int | `8` | Số nến nghỉ bắt buộc sau mỗi lệnh. |
| Von tai khoan (USDT) | `tm_risk_equity` | float | `10000.0` | Vốn giả lập tính toán khối lượng vị thế. |
| Rui ro moi lenh (% von) | `tm_risk_pct` | float | `1.0` | Rủi ro tối đa trên mỗi giao dịch ($1\%$). |
| Don bay toi da cho phep (x) | `tm_risk_maxLev` | float | `20.0` | Giới hạn đòn bẩy an toàn không vượt quá $20\times$. |
| Ngat mach khi thua lien tiep | `tm_risk_maxLosses` | int | `3` | Tự động khóa giao dịch sau 3 lệnh thua liên tiếp trong ngày. |

---

## 2. Presets Cấu hình Theo Thị trường & Phong cách

### Preset 1: BTC/ETH Futures Day Trading (M15)
- **Asset Profile:** `"BTC"` hoặc `"ETH"`
- **Chart TF:** `15` (M15), **Setup TF:** `60` (H1), **Context TF:** `D` (Daily)
- **Che do vao lenh:** `"Auto (Adaptive)"`
- **Entry Modes:** Mode A (`BẬT`), Mode B (`BẬT`), Mode C (`TẮT`)
- **Ngưỡng chất lượng tối thiểu:** `"SETUP"` ($\text{Score} \ge 65$, gap $\ge 8$)
- **SL:** Swing Lookback 10 + Pad $0.2\times\text{ATR}$
- **TP1 / TP2 / TP3:** $1.0\text{R} / 2.0\text{R} / 3.0\text{R}$ (Auto BE tại TP1)

### Preset 2: Vàng Futures & Forex Scalping (M5)
- **Asset Profile:** `"XAU"`
- **Chart TF:** `5` (M5), **Setup TF:** `15` (M15), **Context TF:** `240` (H4)
- **Crypto Session Neutral:** `TẮT`
- **Che do vao lenh:** `"Market on Confirm"`
- **Entry Modes:** Mode B (`BẬT` - chuyên săn Liquidity Sweep), Mode A (`BẬT`)
- **SL:** ATR x `1.2`, Pad `0.15`
- **TP1 / TP2 / TP3:** $1.0\text{R} / 1.8\text{R} / 2.5\text{R}$

### Preset 3: Liquid Altcoins Pullback (M15 / H1)
- **Asset Profile:** `"Liquid Altcoin"`
- **BTC Leader Filter:** `BẬT` (Bắt buộc kiểm tra BTC)
- **Weekend Filter:** `BẬT`
- **Che do vao lenh:** `"Pullback Limit (Strict)"` tại `"50% FVG"`
- **Entry Modes:** Mode A (`BẬT`), Mode B (`TẮT`), Mode C (`TẮT`)
- **Ngưỡng chất lượng tối thiểu:** `"STRONG"` ($\text{Score} \ge 75$)
- **Đòn bẩy tối đa:** $\le 10\times$
