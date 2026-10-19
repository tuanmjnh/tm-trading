# TM XAU Signals 2 — Tài liệu Kỹ thuật & Hướng dẫn Sử dụng (v2.0.0)

> **Hệ thống Chỉ báo Tín hiệu Chuyên sâu cho Vàng (XAUUSD) & Ngoại hối**  
> **Kiến trúc:** Pine Script v6 Modular Build (`tools/build.mjs`, target: `xau`)  
> **Thư mục nguồn:** `pine/parts-xau/` (13 module parts)  
> **File phân phối:** `pine/dist/TM XAU Signals 2.pine` (Version: 2.0.0)  
> **Webhook Alert Schema:** `xau.signal.v2.0` (`"v": 2, "version": "2.0.0"`)

---

## 1. Giới thiệu & Triết lý Phương pháp

**TM XAU Signals 2** là hệ thống chỉ báo kỹ thuật chuyên biệt được tối ưu hóa riêng cho đặc thù hành vi giá của **Vàng (XAUUSD)** và các cặp tiền tệ Forex biến động cao.

### Đặc thù Hành vi Giá của Vàng (XAUUSD)
1. **Săn thanh khoản liên tục (Liquidity Sweeps):** Giá vàng thường xuyên tạo râu nến vượt qua các đỉnh/đáy phiên trước (PDH/PDL, PWH/PWL, Session High/Low) để kích hoạt lệnh Stop-Loss của đám đông rồi mới đảo chiều mạnh mẽ.
2. **Ảnh hưởng cực lớn bởi Phiên giao dịch (Session Dynamics):**
   - **Phiên Á (Asian Session):** Thường tích lũy trong biên hẹp (Range-bound) tạo lập vùng thanh khoản Liquidity Pool.
   - **Phiên London (London Open):** Pha quét thanh khoản (Judas Swing) tạo đỉnh/đáy phiên.
   - **Phiên New York (NY Open & US Data):** Pha mở rộng xu hướng mạnh mẽ (Expansion) hoặc đảo chiều lớn.
3. **Mô hình Khối lượng VSA (Volume Spread Analysis):** Vàng đòi hỏi sự xác nhận của các cột volume đột biến (TIM - Ultra High Volume) và sự bất thường giữa thân nến và khối lượng (Stopping Volume, No Demand, No Supply).

TM XAU Signals 2 kết hợp 11 lớp dữ liệu đa tầng (Multi-layered Confluence) để chỉ đưa ra tín hiệu khi có sự đồng thuận cao nhất giữa cấu trúc, thanh khoản, vùng cản và khối lượng.

---

## 2. Kiến trúc Module Nguồn (`pine/parts-xau/`)

Bộ mã nguồn được module hóa thành 13 file riêng biệt giúp dễ bảo trì và kiểm thử độc lập:

| STT | File Part | Chức năng chính |
|:---:|---|---|
| 0 | `00_header.pine` | Header phiên bản v6, khai báo indicator declaration và template banner |
| 1 | `10_config.pine` | Toàn bộ Inputs: Market Structure, Liquidity, S/R, FVG, OB, Indicators, VSA, Scoring, Risk, Visuals |
| 2 | `20_core.pine` | Hàm cốt lõi: phiên giao dịch (Asian/London/NY), múi giờ, định dạng số, kiểm tra bar đóng |
| 3 | `30_structure.pine` | Cấu trúc thị trường: Swings, BOS, CHoCH, MSS, Retest detection, Failed breakout |
| 4 | `40_liquidity.pine` | Thanh khoản: PDH/PDL, PWH/PWL, Session H/L, Equal Hi/Lo, Liquidity Sweeps, Trendline Liquidity |
| 5 | `50_zones.pine` | Vùng giá: Support/Resistance Zones, Fair Value Gaps (FVG), Order Blocks (OB) |
| 6 | `60_candle.pine` | Mô hình nến đảo chiều: Pin Bar (tỷ lệ wick/body), Bull/Bear Engulfing, Displacement, Rejection |
| 7 | `70_indicators.pine` | Bộ lọc kỹ thuật: EMA stack (20/50/200), ATR(14), RSI(14), MACD, DMI/ADX, Bollinger Bands, Relative Volume, OBV slope |
| 8 | `75_mtf.pine` | Đa khung thời gian (MTF): Context TF (H4/D/W) & Setup TF (H1/M15), HTF Veto logic |
| 9 | `80_scoring_risk.pine` | Chấm điểm đa chiều (Scoring 0–100), Phân loại ngưỡng (NO TRADE / WEAK / SETUP / STRONG), Tính Stop-Loss & Take-Profit 1/2/3 |
| 10 | `90_state.pine` | Quản lý trạng thái lệnh: Theo dõi Entry, Hit TP1/2/3, Hit SL, Cooldown bar sau lệnh |
| 11 | `95_viz.pine` | Hiển thị đồ họa: Vẽ đường PDH/PDL, Session Lines, S/R Boxes, FVG, Trendline, Label Entry, Dashboard thông số |
| 12 | `99_alerts.pine` | Hệ thống cảnh báo tự động: JSON Webhook payload (`xau.signal.v2.0`) & `alertcondition` cho bot TradingView |

---

## 3. Hệ thống Tín hiệu & Lớp Lọc (Signal Mechanics)

### 3.1 Cấu trúc Thị trường (Market Structure)
- **BOS (Break of Structure):** Giá phá vỡ đỉnh/đáy swing cùng xu hướng, thể hiện xu hướng tiếp diễn.
- **CHoCH (Change of Character):** Giá phá vỡ đỉnh/đáy swing ngược xu hướng gần nhất, báo hiệu đảo chiều tiềm năng.
- **MSS (Market Structure Shift):** Phá vỡ cấu trúc đi kèm nến nổ xung lực (Displacement candle $\ge 1.5\times\text{ATR}$).
- **Retest sau BOS:** Nhận diện nhịp pullback hồi về kiểm tra lại đỉnh/đáy vừa phá trong vòng `x2_ms_retestBars` nến.
- **Failed Breakout (Phá vỡ giả):** Giá vượt đỉnh/đáy nhưng đóng nến quay ngược lại trong vùng trong vòng `x2_ms_failBars` nến.

### 3.2 Thanh khoản & Bẫy giá (Liquidity & Sessions)
- **Session High / Low:** Tự động vẽ và cập nhật biên cao/thấp của phiên Á, London, New York theo múi giờ `America/New_York`.
- **PDH / PDL & PWH / PWL:** Mức cao/thấp ngày hôm trước và tuần hôm trước — vùng tập trung lệnh dừng lỗ lớn nhất trên thị trường Vàng.
- **Liquidity Sweep (Quét thanh khoản):** Râu nến vượt qua các mức cản thanh khoản nhưng giá đóng cửa nằm trở lại bên trong $\rightarrow$ bẫy thanh khoản kinh điển trước nhịp đảo chiều.
- **Trendline Liquidity:** Tự động nối các đỉnh/đáy tạo đường xu hướng và nhận diện khi giá quét sạch thanh khoản dọc theo trendline.

### 3.3 Vùng Cản Thể chế: S/R + FVG + Order Block
- **Support / Resistance Zones:** Vùng hỗ trợ/kháng cự động tính theo pivot với độ dày chuẩn hóa theo ATR.
- **Fair Value Gap (FVG):** Khoảng trống thanh khoản giữa nến 1 và nến 3 với độ rộng tối thiểu $\ge 0.3\times\text{ATR}$, tự động đổi màu khi bị giá lấp (mitigated).
- **Order Block (OB):** Cụm nến của tổ chức tài chính trước khi xuất hiện pha nổ xung lực (Displacement).

### 3.4 Khối lượng VSA (Volume Spread Analysis)
Phân loại 5 cấp độ volume chuẩn hóa bằng đường Wilder RMA:
- **TÍM (Spike / TIM):** Khối lượng đột biến $\ge 2.2\times\text{MA}$ $\rightarrow$ Smart Money tham gia.
- **ĐỎ (Very High):** Khối lượng rất cao $\ge 1.8\times\text{MA}$.
- **VÀNG (High):** Khối lượng cao $\ge 1.2\times\text{MA}$.
- **XANH LÁ (Normal):** Khối lượng trung bình $\ge 0.8\times\text{MA}$.
- **TRẮNG (Low):** Khối lượng cạn kiệt $< 0.4\times\text{MA}$ $\rightarrow$ No Demand / No Supply.

---

## 4. Hệ thống Chấm điểm Đa chiều (Scoring Engine 0–100)

Điểm tổng hợp được tính theo trọng số của 11 nhóm yếu tố (tổng trọng số mặc định = 100):

$$\text{Total Score} = \sum_{i=1}^{11} w_i \times S_i$$

| Nhóm yếu tố | Trọng số ($w_i$) | Tiêu chí đánh giá |
|---|:---:|---|
| **Trend (EMA Stack)** | 15% | Trật tự EMA 20, 50, 200 và độ dốc của đường EMA |
| **Market Structure** | 15% | BOS, CHoCH, MSS, Retest hợp lệ |
| **Liquidity** | 12% | Có hành động quét thanh khoản (Sweep) hoặc phá Trendline |
| **S/R + FVG + OB** | 10% | Giá phản ứng ngay tại vùng Order Block, FVG hoặc S/R |
| **Candle Pattern** | 10% | Pin Bar tỷ lệ $\ge 2.0$, Engulfing, Displacement nến lớn |
| **Location** | 8% | Vị trí giá tương quan với VWAP ngày và biên ngày |
| **Volume (VSA)** | 8% | Cột volume đạt mức High / Very High hoặc cạn kiệt kiểm tra |
| **Volatility (ATR)** | 7% | ATR không bị nén nghẹt, độ giãn nến trong giới hạn |
| **Momentum** | 7% | RSI đồng pha, MACD histogram mở rộng, ADX $\ge 20$ |
| **Session** | 4% | Vào lệnh trong các khung giờ vàng (London Open, NY Open) |
| **MTF Alignment** | 4% | Setup TF (H1/M15) cùng hướng với Chart TF |

### Phân loại Tín hiệu theo Ngưỡng Điểm:
- **$\text{Score} \le 49$ (NO TRADE):** Thị trường nhiễu, thiếu xung lực, cấm vào lệnh.
- **$50 \le \text{Score} \le 64$ (WEAK):** Tín hiệu yếu, chỉ theo dõi.
- **$65 \le \text{Score} \le 74$ (SETUP):** Tín hiệu đạt chuẩn, đủ điều kiện kích hoạt Alert.
- **$75 \le \text{Score} \le 100$ (STRONG):** Tín hiệu hội tụ mạnh mẽ, độ tin cậy cao nhất.

### Bộ lọc Phủ quyết Khung lớn (HTF VETO)
Khi `x2_htfVetoOn = true`: Nếu Context TF (H4 hoặc Daily) đang có xu hướng đối lập hoàn toàn (ví dụ giá nằm dưới EMA 200 Context), mọi tín hiệu BUY trên khung nhỏ sẽ bị **khóa hoàn toàn** (`VETO_BLOCKED`), không cho phép khung nhỏ ghi đè khung lớn.

---

## 5. Quản lý Rủi ro & Tỷ lệ R:R

- **Tính Stop-Loss (SL):**
  - Kết hợp giữa độ biến động ATR: $\text{SL}_{\text{ATR}} = \text{Entry} \pm (1.5 \times \text{ATR})$.
  - Và đỉnh/đáy swing gần nhất: $\text{SL}_{\text{Swing}} = \text{Swing Pivot} \pm (0.2 \times \text{ATR})$.
  - Tự động áp đặt cận an toàn: $\text{SL}_{\text{min}} = 0.5 \times \text{ATR}$, $\text{SL}_{\text{max}} = 3.0 \times \text{ATR}$.
- **Mục tiêu Chốt lời (Take-Profit):**
  - **TP1:** $1.0\text{R}$ (Chốt 50% vị thế và dời SL về hòa vốn).
  - **TP2:** $2.0\text{R}$ (Chốt thêm 30% vị thế).
  - **TP3:** $3.0\text{R}$ (Chốt 20% vị thế còn lại hoặc trailing stop).
- **Bộ lọc Lệnh:**
  - $\text{RR}_{\text{min}} \ge 1.5$: Tỷ lệ tiềm năng tối thiểu trước khi phát tín hiệu.
  - Tối đa 3 lệnh / ngày (`x2_maxDay = 3`) tránh overtrading.
  - Cooldown 10 nến (`x2_coolBars = 10`) sau mỗi lệnh đóng.

---

## 6. Cấu trúc Cảnh báo Webhook JSON (`xau.signal.v2.0`)

Khi có tín hiệu đạt ngưỡng `x2_scr_setup`, chỉ báo sẽ kích hoạt alert theo mẫu JSON sau:

```json
{
  "v": 2,
  "version": "2.0.0",
  "schema": "xau.signal.v2.0",
  "action": "BUY",
  "sym": "XAUUSD",
  "tf": "15",
  "p": 2650.50,
  "sl": 2642.00,
  "tp1": 2659.00,
  "tp2": 2667.50,
  "tp3": 2676.00,
  "score": 78,
  "tier": "STRONG",
  "reasons": "SWEEP,OB,PINBAR,EMA_STACK",
  "time": "2026-10-19T14:30:00Z"
}
```

Các trường dữ liệu chuẩn hóa:
- `v`: Số nguyên phiên bản (`2`).
- `version`: Chuỗi semantic version (`"2.0.0"`).
- `schema`: Định dạng hợp đồng tín hiệu (`"xau.signal.v2.0"`).
- `action`: Hành động giao dịch (`"BUY"` hoặc `"SELL"`).
- `sym`, `tf`, `p`: Mã tài sản, khung thời gian, giá vào lệnh (Entry Price).
- `sl`, `tp1`, `tp2`, `tp3`: Các mốc giá dừng lỗ và chốt lời cụ thể.
- `score`, `tier`: Điểm chất lượng (0–100) và cấp độ (`"SETUP"` hoặc `"STRONG"`).
- `reasons`: Danh sách mã nguyên nhân hội tụ cách nhau bởi dấu phẩy.

---

## 7. Hướng dẫn Cài đặt & Sử dụng trên TradingView

### 7.1 Thêm chỉ báo vào Chart
1. Chạy lệnh build:
   ```bash
   npm run pine:xau
   # hoặc copy nhanh vào clipboard:
   npm run pine:copy:xau
   ```
2. Mở TradingView, mở cửa sổ **Pine Editor** ở thanh công cụ dưới.
3. Tạo tab mới, dán toàn bộ nội dung từ clipboard (hoặc file `pine/dist/TM XAU Signals 2.pine`).
4. Nhấn **Save** và chọn **Add to chart**.

### 7.2 Khung thời gian khuyến nghị
- **Khung vào lệnh (Chart TF):** `M5` (Scalping) hoặc `M15` (Day Trading).
- **Khung thiết lập (Setup TF):** `M15` (nếu chart M5) hoặc `H1` (nếu chart M15).
- **Khung bối cảnh (Context TF):** `H4` hoặc `Daily`.

---

## 8. Bảng Tra cứu Tham số Inputs Nhanh

Xem chi tiết từng tham số và các bộ preset mẫu tại: [INPUTS.md](./INPUTS.md).
