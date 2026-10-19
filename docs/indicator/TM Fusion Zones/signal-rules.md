# Định Nghĩa Định Lượng Tín Hiệu — TM Fusion Zones (Signal Rules)

> Tài liệu quy định chi tiết các công thức toán học và logic điều kiện cấu thành tín hiệu
> trong hệ thống **TM Fusion Zones**.

---

## 1. Ba Lớp Quyết Định Vào Lệnh (Decision Layers)

Mỗi tín hiệu chỉ được hình thành sau khi vượt qua tuần tự 3 cổng kiểm duyệt:
1. **Lớp 1 — Nhận diện mẫu hình (Setup Detection)**: Kiểm tra xem có 1 trong 3 setup hợp lệ xuất hiện hay không.
2. **Lớp 2 — Chấm điểm chất lượng (Quality Scoring)**: Điểm chất lượng `longScore` hoặc `shortScore` phải đạt mức tối thiểu $> 49$ (vượt ngưỡng NO TRADE).
3. **Lớp 3 — Cổng an toàn rủi ro (Risk & Obstacle Gate)**: Kiểm tra khoảng cách SL, tỷ lệ R:R, vùng cản trở đối diện và thời gian giãn cách Cooldown.

---

## 2. Định Nghĩa 3 Setup Giao Dịch

### Setup 1: Trend Pullback (Hồi theo xu hướng)
- **Điều kiện LONG**:
  - `fz_trendLongOk`: Đường Ribbon nhanh > Ribbon chậm (`fz_rb_bull`).
  - `fz_htfBull`: Giá trên khung thời gian hiện tại nằm trên đường MA HTF (`close >= fz_htfEma`).
  - `fz_priceInRibbonLong` hoặc `fz_inDemandZone`: Giá chạm dải Ribbon trong biên độ `0.4 x ATR` hoặc chạm vùng Cầu.
  - `fz_candleBull`: Có nến Pinbar từ chối đáy hoặc nến Engulfing hoặc nến tăng thân lớn.
  - `close >= fz_rb_bot`: Nến đóng không bị gãy dưới đáy của Ribbon.
- **Điều kiện SHORT**:
  - Đối xứng hoàn toàn với điều kiện LONG theo hướng giảm giá.

### Setup 2: Liquidity Sweep Reversal (Đảo chiều sau quét thanh khoản)
- **Điều kiện LONG**:
  - Đáy sóng gần nhất (`fz_swL`) hoặc Đáy ngày hôm trước (`fz_pdl`) bị bóng nến xuyên thủng (`low < level`).
  - Cùng cây nến đó hoặc trong vòng `fz_sweep_confBars` (3 nến), giá đóng cửa quay trở lại bên trên mức đã quét (`close > level`).
  - Xuất hiện nến xác nhận tăng (`close > open` hoặc nến Pinbar rút chân tăng mạnh).
- **Điều kiện SHORT**:
  - Đối xứng hoàn toàn tại Đỉnh sóng gần nhất (`fz_swH`) hoặc Đỉnh ngày hôm trước (`fz_pdh`).

### Setup 3: Range Mean-Reversion (Bật nảy trong biên độ đi ngang)
- **Điều kiện kích hoạt**:
  - Chỉ áp dụng khi `fz_regime == "Range"` (Chop Index $\ge 58$ hoặc ADX $< 18$).
  - LONG: Giá chạm vùng Cầu (`fz_inDemandZone`) và có nến từ chối tăng (`fz_candleBull`).
  - SHORT: Giá chạm vùng Cung (`fz_inSupplyZone`) và có nến từ chối giảm (`fz_candleBear`).

---

## 3. Hệ Thống Chấm Điểm Đối Xứng Độc Lập (0–100)

Tổng điểm được tính theo thang điểm trọng số chuẩn hóa:
$$\text{Score} = \frac{\sum (F_i \times W_i)}{\sum W_i} \times 100$$

Trong đó các nhân tố thành phần ($F_i \in [0.0, 1.0]$):
1. **$F_{\text{trend}}$ (Trọng số 25)**: Dải Ribbon mở rộng cùng chiều dốc MA = $1.0$; cùng chiều thường = $0.75$; ngược chiều = $0.0$.
2. **$F_{\text{zone}}$ (Trọng số 25)**: Đang ở trong Vùng Cung/Cầu tương ứng = $1.0$; đang chạm Ribbon = $0.70$; ở khoảng trống = $0.0$.
3. **$F_{\text{struct}}$ (Trọng số 20)**: Xuất hiện CHoCH = $1.0$; Quét thanh khoản Sweep = $0.90$; Phá vỡ BOS = $0.75$; không có = $0.0$.
4. **$F_{\text{candle}}$ (Trọng số 15)**: Nến Pinbar rút chân hoặc Engulfing = $1.0$; nến động lượng = $0.70$; nến yếu = $0.0$.
5. **$F_{\text{mtf}}$ (Trọng số 15)**: Thuận xu hướng khung lớn HTF = $1.0$; ngược xu hướng = $0.0$.

---

## 4. Quy Tắc Cổng Cản Trở (Obstacle Gate)

- Khi phát hiện tín hiệu LONG: Tính khoảng cách tới đáy của Vùng Cung (Supply Zone) chưa bị phá vỡ gần nhất phía trên.
  Nếu khoảng cách cản $< (\text{TP1} - \text{Entry}) \times 0.92$, tín hiệu LONG bị **chặn ngay lập tức** với lý do `"Opposing Supply < TP1"`.
- Khi phát hiện tín hiệu SHORT: Tính khoảng cách tới đỉnh của Vùng Cầu (Demand Zone) chưa bị phá vỡ gần nhất phía dưới.
  Nếu khoảng cách cản $< (\text{Entry} - \text{TP1}) \times 0.92$, tín hiệu SHORT bị **chặn ngay lập tức** với lý do `"Opposing Demand < TP1"`.
