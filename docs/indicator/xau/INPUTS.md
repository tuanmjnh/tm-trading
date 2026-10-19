# TM XAU Signals 2 — Bảng Tra cứu Tham số Inputs & Presets (v2.0.0)

Tài liệu này giải thích chi tiết toàn bộ các thông số cấu hình của **`TM XAU Signals 2.pine`** (nguồn `pine/parts-xau/10_config.pine`).

---

## 1. Bảng Tra cứu Toàn bộ Tham số

### Nhóm 1: Cấu hình Chung (`XAU2 · Chung`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Chi tin hieu nen da dong (no-repaint) | `x2_confirmOnly` | bool | `true` | Bật = chỉ kích hoạt tín hiệu khi nến đã đóng hoàn toàn, triệt tiêu 100% hiện tượng vẽ lại (Repaint). |
| Webhook payload | `x2_payloadMode` | string | `"Full"` | Tùy chọn format JSON gửi webhook: `"Full"`, `"Slim"`, `"Off"`. |

---

### Nhóm 2: Cấu trúc Thị trường (`XAU2 · Market Structure`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Swing lookback (nen) | `x2_ms_swLen` | int | `5` | Số nến nhìn về hai phía để xác định đỉnh/đáy swing. M5/M15 dùng 3–5; H1 dùng 5–8. |
| Hien thi BOS | `x2_ms_bosOn` | bool | `true` | Hiển thị đường phá vỡ cấu trúc tiếp diễn xu hướng. |
| Hien thi CHoCH | `x2_ms_chochOn` | bool | `true` | Hiển thị tín hiệu đổi tính chất xu hướng (đảo chiều tiềm năng). |
| Hien thi MSS (break + displ.) | `x2_ms_mssOn` | bool | `true` | Phá vỡ cấu trúc kèm nến nổ xung lực mạnh (Market Structure Shift). |
| Phat hien Retest sau BOS | `x2_ms_retestOn` | bool | `true` | Nhận diện nhịp pullback quay lại kiểm tra vùng vừa phá vỡ. |
| Cua so retest (nen) | `x2_ms_retestBars` | int | `10` | Số nến tối đa để chấp nhận một nhịp retest sau BOS. |
| Retest tolerance (x ATR) | `x2_ms_retestTol` | float | `0.5` | Dung sai khoảng cách retest tính theo bội số của ATR. |
| Phat hien Failed Breakout | `x2_ms_failOn` | bool | `true` | Nhận diện bẫy phá vỡ giả (giá vượt đỉnh/đáy rồi lập tức thụt lùi). |
| Cua so failed breakout (nen) | `x2_ms_failBars` | int | `5` | Số nến tối đa để xác nhận nến đóng ngược vào vùng. |
| Trend continuation (HH/LL) | `x2_ms_contOn` | bool | `true` | Xác nhận xu hướng bằng chuỗi đỉnh cao hơn (HH) hoặc đáy thấp hơn (LL). |
| Pullback ve EMA | `x2_ms_pullOn` | bool | `true` | Tìm điểm vào lệnh khi giá hồi về EMA 20/50 trong xu hướng mạnh. |

---

### Nhóm 3: Thanh khoản & Phiên (`XAU2 · Liquidity`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Equal Hi/Lo tolerance (x ATR) | `x2_liq_eqTol` | float | `0.05` | Ngưỡng xác định hai đỉnh/đáy bằng nhau (vùng thanh khoản dày). |
| Hien thi Liquidity Sweep | `x2_liq_sweepOn` | bool | `true` | Hiển thị các pha quét râu qua cản thanh khoản rồi đóng ngược lại. |
| Hien thi PDH / PDL | `x2_liq_pdOn` | bool | `true` | Vẽ đường Đỉnh/Đáy ngày hôm trước (Previous Day High/Low). |
| Hien thi PWH / PWL | `x2_liq_pwOn` | bool | `true` | Vẽ đường Đỉnh/Đáy tuần hôm trước (Previous Week High/Low). |
| Hien thi Session High / Low | `x2_liq_sessOn` | bool | `true` | Vẽ biên đỉnh/đáy các phiên Á, London, New York. |
| Trendline 2 diem | `x2_liq_tlOn` | bool | `true` | Tự động nối đường xu hướng dựa trên các swing hợp lệ. |
| Trendline touch tolerance (x ATR) | `x2_liq_tlTol` | float | `0.25` | Dung sai khoảng cách để tính là chạm trendline. |
| Trendline toi da xa gia (x ATR) | `x2_liq_tlMaxDev` | float | `10.0` | Giới hạn khoảng cách tối đa để tránh vẽ trendline quá xa giá hiện tại. |

---

### Nhóm 4: Vùng cản S/R, FVG & Order Block
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Zone pivot left / right | `x2_sr_left`, `x2_sr_right` | int | `10` | Số nến trái/phải để tạo vùng S/R quan trọng. |
| Zone width (x ATR) | `x2_sr_width` | float | `0.5` | Độ dày của hộp S/R. |
| Max zones | `x2_sr_maxZone` | int | `8` | Số vùng S/R tối đa vẽ trên màn hình để tránh rối chart. |
| Hien thi S/R zones | `x2_sr_showOn` | bool | `true` | Bật/tắt vẽ vùng hỗ trợ/kháng cự. |
| Hien thi FVG | `x2_fvg_showOn` | bool | `true` | Bật/tắt vẽ Fair Value Gap. |
| FVG toi thieu (x ATR) | `x2_fvg_minAtr` | float | `0.3` | Độ rộng FVG tối thiểu để lọc bỏ các khoảng trống nhỏ không có ý nghĩa. |
| FVG toi da | `x2_fvg_max` | int | `20` | Giới hạn số lượng FVG lưu trữ. |
| FVG tuoi tho toi da (nen) | `x2_fvg_life` | int | `100` | Tự động xóa FVG sau N nến nếu chưa được lấp đầy. |
| Hien thi Order Block | `x2_ob_showOn` | bool | `true` | Bật/tắt vẽ vùng Order Block thể chế. |
| Order Block toi da | `x2_ob_max` | int | `20` | Số lượng Order Block tối đa hiển thị. |

---

### Nhóm 5: Mô hình Nến Đảo chiều (`XAU2 · Candle Patterns`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Pin bar ratio (wick/body) | `x2_cp_pinRatio` | float | `2.0` | Râu nến phải dài tối thiểu gấp 2 lần thân nến. |
| Engulfing | `x2_cp_engulf` | bool | `true` | Nhận diện nến nhấn chìm tăng/giảm. |
| Pin Bar | `x2_cp_pin` | bool | `true` | Nhận diện nến búa (Hammer) hoặc nến sao băng (Shooting Star). |
| Displacement | `x2_cp_disp` | bool | `true` | Nhận diện nến bứt phá xung lực mạnh. |
| Displacement: body >= ATR x | `x2_cp_dispAtr` | float | `1.5` | Thân nến phải dài $\ge 1.5\times\text{ATR}$ mới tính là nến nổ. |
| Rejection Candle | `x2_cp_rej` | bool | `true` | Nến râu dài từ chối giá tại các vùng cản quan trọng. |

---

### Nhóm 6: Chỉ báo Xu hướng, Động lượng & Khối lượng (`XAU2 · Indicators`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| EMA fast / mid / slow | `x2_emaFast/Mid/Slow` | int | `20, 50, 200` | Bộ 3 đường trung bình động xác định cấu trúc sóng và xu hướng lớn. |
| ATR length | `x2_atrLen` | int | `14` | Chu kỳ tính độ biến động trung bình thực tế. |
| RSI length | `x2_rsiLen` | int | `14` | Chu kỳ chỉ số sức mạnh tương đối RSI. |
| RSI overbought / oversold | `x2_rsiOb`, `x2_rsiOs` | float | `70, 30` | Ngưỡng quá mua / quá bán. |
| MACD fast / slow / signal | `x2_macdF/S/SigLen` | int | `12, 26, 9` | Thông số chuẩn đường trung bình phân kỳ hội tụ MACD. |
| DMI / ADX length & smooth | `x2_dmiLen/Smooth` | int | `14, 14` | Đo cường độ xu hướng. |
| ADX nguong manh xu huong | `x2_adxMin` | float | `20.0` | Thị trường có xu hướng rõ ràng khi $\text{ADX} \ge 20$. |
| Bollinger length / mult | `x2_bbLen`, `x2_bbMult` | int, float | `20, 2.0` | Dải Bollinger Bands đo biên nén và bứt phá. |
| RelVol window / nguong | `x2_rvLen`, `x2_rvMin` | int, float | `20, 1.2` | Tỷ lệ khối lượng tương đối so với trung bình 20 nến gần nhất. |
| OBV slope window (nen) | `x2_obvLen` | int | `20` | Độ dốc tích lũy/phân phối của dòng tiền trên On-Balance Volume. |

---

### Nhóm 7: Khối lượng VSA (`XAU2 · Volume VSA`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Cua so Volume MA (Wilder RMA) | `x2_vol_maLen` | int | `20` | Đường trung bình khối lượng chuẩn Wilder. |
| TIM - cot dot bien (ratio) | `x2_vol_spikeR` | float | `2.2` | Tỷ lệ cột khối lượng TÍM (Ultra High) $\ge 2.2\times\text{MA}$. |
| VeryHigh / High / Normal / Low | `x2_vol_rVH/rH/rN/rL` | float | `1.8, 1.2, 0.8, 0.4` | Các ngưỡng phân loại volume VSA. |
| Loc phien giao dich | `x2_vol_sessOn` | bool | `false` | Bật lọc để chỉ tính volume trong phiên chỉ định. |
| Phien Volume & Múi giờ | `x2_vol_sess`, `x2_vol_tz` | session, string | `"0800-1600"`, `"Asia/Ho_Chi_Minh"` | Giờ giao dịch cụ thể để lọc volume. |

---

### Nhóm 8: Đa Khung Thời Gian (`XAU2 · MTF Context`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| Context TF (H4/D/W/M) | `x2_ctxTf` | timeframe | `"D"` | Khung thời gian bối cảnh lớn nhất. Khuyến nghị `"D"` hoặc `"240"` (H4). |
| Context EMA length | `x2_ctxLen` | int | `200` | Đường EMA 200 trên khung Context. |
| Setup TF (H1/M15) | `x2_setupTf` | timeframe | `"60"` | Khung thời gian định hình setup trước khi vào lệnh. |
| Setup EMA length | `x2_setupLen` | int | `50` | Đường EMA 50 trên khung Setup. |
| Loc theo Setup TF | `x2_htfFilter` | bool | `true` | Bắt buộc xu hướng trên Setup TF phải cùng pha với lệnh. |
| HTF VETO | `x2_htfVetoOn` | bool | `true` | **Quan trọng:** Phủ quyết lệnh tuyệt đối khi khung bối cảnh lớn đối lập xu hướng. |

---

### Nhóm 9: Quản lý Lệnh & Rủi ro (`XAU2 · Risk`)
| Tên tham số trên giao diện | Mã biến trong code | Kiểu dữ liệu | Mặc định | Ý nghĩa & Khuyến nghị |
|---|---|:---:|:---:|---|
| SL = ATR x | `x2_sl_atrMul` | float | `1.5` | Khoảng cách Stop Loss tính theo ATR nến. |
| Swing lookback SL | `x2_sl_swing` | int | `10` | Số nến nhìn lại để tìm đỉnh/đáy swing đặt SL. |
| Dem sau swing (x ATR) | `x2_sl_padAtr` | float | `0.2` | Khoảng đệm an toàn lùi xa khỏi đỉnh/đáy swing. |
| SL min / max (x ATR) | `x2_sl_minAtr`, `x2_sl_maxAtr` | float | `0.5, 3.0` | Chặn trên và chặn dưới khoảng cách SL. |
| TP1 / TP2 / TP3 (R) | `x2_rr1, x2_rr2, x2_rr3` | float | `1.0, 2.0, 3.0` | Tỷ lệ R:R cho 3 mốc Take Profit. |
| RR toi thieu | `x2_rrMin` | float | `1.5` | Lọc bỏ các setup có tiềm năng lợi nhuận $< 1.5\text{R}$. |
| Lenh toi da / ngay | `x2_maxDay` | int | `3` | Giới hạn số lệnh tối đa trong một ngày giao dịch. |
| Cooldown (nen) | `x2_coolBars` | int | `10` | Số nến nghỉ bắt buộc sau khi một lệnh đóng trước khi mở lệnh mới. |

---

## 2. Các Bộ Cấu hình Khuyến nghị (Recommended Presets)

### Preset 1: Gold Scalping M5 (Đánh nhanh theo phiên Á & London)
- **Chart TF:** `5` (M5)
- **Setup TF:** `15` (M15), **Context TF:** `60` (H1)
- **Swing lookback:** `3`
- **SL = ATR x:** `1.2` (Pad: `0.15`)
- **TP1 / TP2 / TP3:** `1.0R / 1.8R / 2.5R`
- **Score ngưỡng kích hoạt:** $\ge 68$ (SETUP)
- **Mục tiêu:** Bắt các nhịp giật quét thanh khoản (Sweeps) tại phiên Á và đầu phiên London để ăn nhịp hồi ngắn 30–60 pips.

### Preset 2: Gold Day Trading M15 (Tiêu chuẩn - Khuyến nghị cho hầu hết Trader)
- **Chart TF:** `15` (M15)
- **Setup TF:** `60` (H1), **Context TF:** `D` (Daily)
- **Swing lookback:** `5`
- **SL = ATR x:** `1.5` (Pad: `0.2`)
- **TP1 / TP2 / TP3:** `1.0R / 2.0R / 3.0R`
- **HTF VETO:** `BẬT` (Bảo vệ khỏi các pha ngược xu hướng nến ngày)
- **Score ngưỡng kích hoạt:** $\ge 72$
- **Mục tiêu:** Vào lệnh tại London Open và New York Open với xác nhận đầy đủ của cấu trúc BOS/MSS và FVG/OB.

### Preset 3: Gold Swing H1 (Đánh theo sóng lớn)
- **Chart TF:** `60` (H1)
- **Setup TF:** `240` (H4), **Context TF:** `W` (Weekly)
- **Swing lookback:** `8`
- **SL = ATR x:** `2.0` (Pad: `0.3`)
- **TP1 / TP2 / TP3:** `1.5R / 3.0R / 5.0R`
- **Score ngưỡng kích hoạt:** $\ge 75$ (STRONG)
- **Mục tiêu:** Nắm giữ vị thế theo chu kỳ tuần, tận dụng tối đa các nhịp mở rộng xu hướng lớn của Vàng.
