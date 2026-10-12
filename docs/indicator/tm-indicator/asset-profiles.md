# Asset & Timeframe Profiles — TM Indicator

> **Status:** Phase 2 Completed — Asset & Timeframe Profiles Architecture
> **Reference Document:** [TM_Indicator_Roadmap.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/TM_Indicator_Roadmap.md)
> **Active Target:** [TM Indicator.pine](file:///d:/Applications/tm-trading/pine/dist/TM%20Indicator.pine) (`pine/parts-tm/`)
> **Verification Gate:** `npm run verify`

---

## 1. Mục tiêu kiến trúc Phase 2

Trong mã nguồn gốc `TM XAU Signals 2.pine`, toàn bộ thông số, trọng số phiên (session weights) và giả định giao dịch được thiết kế mặc định riêng cho thị trường Vàng (XAUUSD/XAUUSDT). Khi áp dụng trực tiếp lên tiền mã hóa (Crypto) hoặc các tài sản khác, phát sinh các bất cập:
1. **Áp đặt trọng số phiên không phù hợp:** Thị trường crypto hoạt động 24/7/365, việc trừ điểm vào phiên châu Á hoặc ngày cuối tuần khiến setup đẹp bị đánh giá thấp vô lý.
2. **Khác biệt về đặc tính thanh khoản và biến động:** Vàng có biên độ biến động khác biệt so với BTC/ETH và các altcoin vốn hóa nhỏ.
3. **Cố định khung thời gian:** Không kiểm tra tính hợp lệ của thứ tự đa khung thời gian (ví dụ chart M15 nhưng Setup H1 và Context Daily).

---

## 2. Danh mục Asset Profiles

Hệ thống hỗ trợ 7 chế độ cấu hình tài sản qua input `tm_assetMode`:

| Profile | Nhận diện tự động (Auto) | Đặc tính biến động & Thanh khoản | Chính sách Session | Bộ lọc bổ sung |
|---|---|---|---|---|
| **Auto** | Tự động quét `syminfo.ticker` | Gán tự động vào XAU, BTC, ETH hoặc Custom | Theo profile nhận diện | - |
| **XAU** | Ticker chứa `XAU` hoặc `GOLD` | Biến động mạnh phiên Âu/Mỹ, spread hẹp | Phiên Á (0.2), London (0.6), NY (0.8), Overlap (1.0) | Volume VSA & Sweep mức quan trọng (PDH/PDL, Sess Hi/Lo) |
| **BTC** | Ticker chứa `BTC` | Thanh khoản lớn nhất thị trường crypto, biên độ 24/7 | **Session Neutral (1.0)** — không phạt phiên | Volume RMA, EMA Stack 20/50/200, FVG/OB |
| **ETH** | Ticker chứa `ETH` | Beta cao hơn BTC, thanh khoản cao, 24/7 | **Session Neutral (1.0)** — không phạt phiên | Tương tự BTC, độ co dãn SL rộng hơn |
| **Liquid Altcoin** | Chỉ định thủ công (SOL, BNB, XRP...) | Beta cao, thanh khoản dồi dào | **Session Neutral (1.0)** | Yêu cầu `volume > 0` và `relVol` xác nhận |
| **High-Risk Altcoin** | Chỉ định thủ công | Thanh khoản mỏng, rủi ro spread rộng/bơm xả | **Session Neutral (1.0)** | **Chặn lệnh bắt buộc** khi volume bằng 0 hoặc MA volume bất thường |
| **Custom** | Mặc định an toàn khi không nhận diện | Tùy biến hoàn toàn theo người dùng | Mặc định an toàn, không tự ý áp đặt XAU | Người dùng chủ động bật/tắt từng nhóm chỉ báo |

---

## 3. Chính sách phiên Crypto 24/7 (Session Policy)

- **Nguyên tắc cốt lõi:** Khi tài sản thuộc nhóm Crypto (`BTC`, `ETH`, `Liquid Altcoin`, `High-Risk Altcoin`) và bật tùy chọn `tm_cryptoSessionNeutral = true` (mặc định bật):
  ```pine
  float tm_sessScore = (tm_isCrypto and tm_cryptoSessionNeutral) ? 1.0 : tm_sessScoreRaw
  ```
- **Ý nghĩa định lượng:** Điểm nhóm Session luôn giữ mức trung tính tối đa (1.0) trên mọi nến của Crypto. Tín hiệu vào ngày thứ Bảy/Chủ Nhật hoặc phiên đêm không bị suy giảm điểm số do thiên kiến thị trường ngoại hối truyền thống.

---

## 4. Quy tắc kiểm thực đa khung thời gian (Timeframe Hierarchy Policy)

Hệ thống phân chia 3 cấp độ khung thời gian:
1. **Entry TF:** Khung thời gian của biểu đồ đang mở (`timeframe.period`, khuyến nghị M1, M3, M5, M15).
2. **Setup TF:** Khung phát hiện setup và cấu trúc trung hạn (`tm_setupTf`, các tùy chọn `15`, `30`, `60`, `240`).
3. **Context TF:** Khung bối cảnh xu hướng vĩ mô (`tm_ctxTf`, các tùy chọn `60`, `240`, `D`, `W`, `M`).

### Quy tắc kiểm tra thứ bậc (Hierarchy Check)
Để triệt tiêu lỗi lấy dữ liệu MTF ngược (ví dụ chart Daily nhưng Setup lại là M15):
```pine
int tm_secChart = timeframe.in_seconds(timeframe.period)
int tm_secSetup = timeframe.in_seconds(tm_setupTf)
int tm_secCtx   = timeframe.in_seconds(tm_ctxTf)
bool tm_tfHierarchyOk = tm_secChart <= tm_secSetup and tm_secSetup <= tm_secCtx
```
- Nếu `tm_tfHierarchyOk == true`: Hệ thống áp dụng đầy đủ MTF alignment score và HTF VETO gate.
- Nếu `tm_tfHierarchyOk == false`:
  - Bảng Dashboard hiển thị cảnh báo màu vàng `TF_WARN` tại dòng Context TF và Setup TF.
  - Tự động hạ MTF bias về trung tính (`0.0`) và vô hiệu hóa VETO gate không hợp lệ, bảo vệ hệ thống khỏi các quyết định sai lầm do so sánh ngược khung.

---

## 5. Chuẩn hóa ngưỡng tương đối (Relative Normalization)

Nhằm đảm bảo một bộ code hoạt động chuẩn xác trên cả tài sản giá vài chục nghìn USD (BTC) lẫn tài sản giá vài USD (Altcoin) hay Vàng:
- Không dùng bước giá USD cố định.
- Toàn bộ khoảng cách dừng lỗ, chốt lời, dung sai retest và độ lệch trendline được tính theo bội số của **ATR** hoặc **ATR%**:
  - `dist = clamp((atrMul + swingPad) * 0.5, minAtr * atr, maxAtr * atr)`
  - `retestTol = tm_ms_retestTol * atr`
  - `equalThreshold = tm_atr * tm_liq_eqTol`
  - `trendlineTolerance = tm_liq_tlTol * tm_atr`
