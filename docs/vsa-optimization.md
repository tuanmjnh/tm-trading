# Chẩn đoán & tối ưu TM VSA Wyckoff

> **Ngày:** 2026-10-01 · **Dữ liệu:** BTCUSDT futures (Binance fapi), 4000 nến mỗi khung
> (5m/15m ≈ 14 ngày · 1h ≈ 166 ngày) · **Công cụ:** `engine/signals.mjs` (bản port đã kiểm chứng
> parity với Pine). Mọi con số dưới đây **đo được**, không phải suy đoán.

---

## 1. Kết luận ngắn

Quan sát "toàn SL" của bạn **đúng**, và nguyên nhân chính **không phải** tín hiệu VSA kém.
Đó là **stop quá hẹp so với phí giao dịch** — một ràng buộc toán học:

> `slBuf = 0.5 ATR` (mặc định) ⇒ riêng phí round-trip 0.1% đã bằng **1.40 R** trên khung 5m.
> Lệnh vào đã âm 1.4R trước khi giá kịp đi. **Không tín hiệu nào thắng được mức đó.**

---

## 2. Bằng chứng đo được

### 2.1 ATR% và phí quy ra R — đây là bảng quan trọng nhất

`fee_R = phí_round-trip / (slBuf × ATR%)`, phí taker 0.05% × 2 = 0.1% notional.

| Khung | ATR% giá | fee_R @slBuf=0.5 | fee_R @slBuf=1.0 | fee_R @slBuf=2.0 | **slBuf tối thiểu** để fee_R ≤ 0.15 |
|---|---|---|---|---|---|
| 5m | 0.14% | **1.40** | 0.70 | 0.35 | **4.7 ATR** |
| 15m | 0.27% | **0.75** | 0.37 | 0.19 | **2.5 ATR** |
| 1h | 0.56% | 0.36 | 0.18 | 0.09 | **1.2 ATR** |
| 4h | 1.33% | 0.15 | 0.08 | 0.04 | **0.5 ATR** |

**Vì sao khác nhau:** ATR% tăng theo khung, còn phí là **hằng số**. Cùng `slBuf = 0.5`, trên 5m
stop chỉ rộng 0.07% giá nhưng phí đã 0.1% → **phí lớn hơn cả stop**. Trên 4h stop rộng 0.67% giá
→ phí chỉ còn 0.15R.

### 2.2 Tỉ lệ thắng thật (bắt buộc entry khớp, cùng bar chạm cả 2 → tính SL)

| Khung | slBuf=0.5 (hiện tại) | slBuf=1.0 | slBuf=2.5 |
|---|---|---|---|
| 5m | 9% | 16% | 30% |
| 15m | **3%** | 10% | 29% |
| 1h | 7% | 14% | 37% |

Nới stop làm tỉ lệ thắng tăng **đều ở mọi khung** — đúng dấu hiệu "stop bị nhiễu quét", không phải
"tín hiệu sai".

### 2.3 Expectancy sau phí (TP cố định theo R, không dùng pivot, để R so sánh được)

| Khung | tốt nhất trong lưới | expR sau phí | có ý nghĩa thống kê? |
|---|---|---|---|
| 5m | slBuf=3.0, rr=3 | **+0.03** | không (≈0) |
| 15m | slBuf=3.0, rr=3 | +0.23 ± 0.16 | **chưa** (1.4×SE) |
| 1h | slBuf=3.0, rr=3 | **+0.64 ± 0.19** | **có** (>3×SE) |
| 1h | slBuf=2.5, rr=1.5 | +0.31 ± 0.12 | **có** |

⇒ **5m và 15m âm hoặc bằng 0 ở MỌI cấu hình thử được.** Chỉ 1h có dấu hiệu dương.

---

## 3. Trả lời: "có nên tối ưu cho các mốc thời gian không?"

**Có — và đây không phải chuyện tinh chỉnh cho đẹp, mà là điều kiện sống còn.** Lý do là bảng §2.1:

- Một hằng số `slBuf` **không thể đúng cho mọi khung**, vì ATR% đổi theo khung còn phí thì không.
- **5m gần như không dùng được** với phương pháp này: cần stop ≥ 4.7 ATR chỉ để phí ≤ 0.15R, mà
  stop 4.7 ATR thì TP (RR 2) phải 9.4 ATR — hiếm khi tới trong phiên; lệnh giữ rất lâu.
- **15m cần stop ≥ 2.5 ATR**, và đo thực tế vẫn chưa dương rõ.
- **1h cần ≥ 1.2 ATR** — và đo thực tế cho kết quả dương rõ nhất.
- **4h** thoải mái nhất (chỉ cần 0.5 ATR).

**Đề xuất:** đặt `slBuf` mặc định **theo khung** (preset), không dùng một số cho tất cả:
1h/4h → 1.5–2.5 · 15m → 2.5+ · 5m → **không khuyến nghị dùng**.

---

## 4. Lỗi cần sửa trong code (không phải lựa chọn — là SAI)

### 4.1 Auto-close không kiểm tra entry đã khớp chưa

`pine/parts-vsa/40_events.pine` dòng 67–85: cứ sau bar ST là kiểm tra TP/SL **bất kể entry có được
khớp hay không**. Hệ quả: setup chưa từng vào lệnh vẫn được ghi "TP"/"SL" → báo cáo trên chart sai.

Đo được: entry được chạm 95–98% số setup, nên sai lệch không lớn về số lượng — nhưng khi cùng một
bar vừa khớp entry vừa xuyên qua SL (rất thường gặp với stop 0.5 ATR), cách tính hiện tại ghi nhận
sai. Đã đo chênh lệch: 5m `TP 44` (cách cũ) so với `TP 15` (có bắt buộc khớp) — **lệch gần 3 lần**.

### 4.2 Chưa có bảo vệ "stop quá hẹp so với phí"

Không chỗ nào cảnh báo khi `slBuf × ATR% < vài lần phí`. Đây chính là cái đã khiến mọi lệnh SL.

---

## 5. Việc nên làm, theo thứ tự giá trị

| # | Việc | Loại | Vì sao |
|---|---|---|---|
| 1 | Cảnh báo + chặn mềm khi `fee_R > 0.15` (hiện `fee_R` trên dashboard) | **Sửa sai** | Ngăn cấu hình bất khả thi về mặt toán học |
| 2 | Sửa auto-close: bắt buộc entry khớp; cùng bar khớp entry + chạm SL → tính **SL** | **Sửa sai** | Báo cáo trên chart đang sai |
| 3 | `slBuf` mặc định **theo khung** (1h/4h: 1.5–2.5 · 15m: 2.5+) | Tối ưu | Bảng §2.1 |
| 4 | Hiển thị: đánh dấu setup **chưa khớp entry**; hiện R thực tế của setup đã đóng | Hiển thị | Để nhìn chart là biết đúng/sai |
| 5 | Loại 5m khỏi preset khuyến nghị | Tối ưu | §2.3 |

**Cách tính nên đổi:** hiện `TP = pivot đối diện nếu RR ≥ 1, ngược lại fallback rrFb × R`. Vì TP
theo pivot làm R mỗi lệnh rất khác nhau, **không so sánh được giữa các lệnh** và vài lệnh thắng lớn
chi phối toàn bộ thống kê (đã thấy: win 9% mà expectancy dương — dấu hiệu của outlier, không phải
edge). Đề xuất: **TP cố định theo R** làm mặc định, để pivot thành *tuỳ chọn*.

---

## 5b. ✅ ĐÃ LÀM #1 + #2 (2026-10-01) — và phát hiện thêm một vấn đề lớn hơn

**Đã sửa:**
- `pine/parts-vsa/20_volume.pine` + `40_events.pine` + `60_viz.pine`, và `engine/signals.mjs` (parity):
  thêm `tm_lvlFill`/`tm_lvlFillBar`; auto-close **chỉ** xét TP/SL sau khi entry đã khớp; cùng bar
  vừa khớp vừa xuyên SL → tính SL.
- Thêm `fee_R` + `feeOk` + `slBuf tối thiểu`; dashboard 2×11 có dòng **"Phi/R"** (đỏ khi vượt
  ngưỡng) và **"slBuf tối thiểu"**; nhãn Entry ghi `da khop`/`cho khop` và `/ PHI CAO`; nhãn SL
  hiện luôn **R thực tế** của setup.
- `ENGINE_VERSION` 0.3.0 → **0.4.0** (hành vi đổi ⇒ run cũ không so sánh được với run mới).
- `ENGINE_VERSION` 0.4.0 → **0.5.0** (Phase 4): tách VSA thành plugin + thêm `slipPct` vào
  `DEFAULTS` ⇒ **mọi run mới xấu hơn run cũ và không so sánh được**. Xem `engine/version.mjs`.
- Test: engine 120 assertion (thêm 8 cho `fee_R`, 3 case mới cho entry-fill), smoke 158 assertion
  (thêm 8 khoá hành vi Pine). Tất cả xanh.

### Phát hiện mới: **phần lớn setup KHÔNG BAO GIỜ khớp entry**

Đo lại sau khi sửa (BTCUSDT, 4000 nến/khung):

| khung | setup | TP | SL | **chưa khớp** | win% (trên số đã đóng) |
|---|---|---|---|---|---|
| 5m | 168 | 2 | 55 | **111 (66%)** | 4% |
| 15m | 146 | 1 | 52 | **93 (64%)** | 2% |
| 1h | 116 | 0 | 33 | **83 (72%)** | 0% |

**Vì sao mâu thuẫn với "entry được chạm 95–98%" ở §2?** Vì phép đo §2 tìm **không giới hạn** về sau,
còn thực tế một setup bị **setup ST kế tiếp thay thế** (hành vi D5) — nên nó chỉ có một cửa sổ ngắn
để giá quay lại mức entry. Hết cửa sổ mà chưa khớp → setup biến mất, không thành lệnh.

⇒ **Mô hình entry hiện tại ("limit tại cực trị SV/BC") sai về bản chất**, không chỉ sai tham số:
- 64–72% setup không bao giờ thành lệnh → tín hiệu trên chart **không phải lệnh**;
- trong số ít khớp được, phần lớn khớp vì giá **đang đâm xuyên qua** mức đó → gần như chắc chắn SL.

Đây chính là lý do quan sát "toàn SL" của bạn **vẫn đúng sau khi sửa #1/#2** — hai lỗi đó là lỗi
*báo cáo*, không phải lỗi *vào lệnh*. Muốn hết phải đổi **mô hình entry** (mục #5/C: vào lệnh theo
xác nhận tại bar ST thay vì limit tại cực trị), và đó là thay đổi phương pháp cần bạn quyết.

---

## 5c. ✅ ĐÃ ĐỔI MÔ HÌNH ENTRY/VÀO LỆNH (2026-10-01) — và kết quả trung thực

**Đã thêm 2 input (giữ được hành vi cũ để A/B):**

| Input | Mặc định MỚI | Lựa chọn còn lại (hành vi cũ) |
|---|---|---|
| `Kieu vao lenh` | **Market (xác nhận ST)** — vào tại `close` bar ST | Limit (cực trị SV/BC) |
| `Kieu dat TP` | **Theo R (cố định)** — `TP = rrFb × R` | Pivot đối diện |

SL **luôn** đặt theo cấu trúc (ngoài cực trị SV/BC) ở cả hai chế độ; setup bị **bỏ qua** nếu
`risk ≤ 0`. `risk = |entry − SL|` là **rủi ro thật**, dùng cho TP theo R và cho `fee_R` của setup
(nhãn Entry hiện luôn `risk` quy ra ATR).

### Đo lại — mô phỏng ĐỘC LẬP (giữ tới TP/SL, tối đa 500 nến), phí theo rủi ro thật

> Lưu ý phương pháp: bản đo trước đó bị **thiên lệch** vì tin vào "setup bị ST kế tiếp thay thế"
> — đó là hành vi *hiển thị*, không phải thoát lệnh thật. Nó loại bỏ 70–85% lệnh, chỉ còn lại phần
> đóng nhanh (thường là SL) → kéo expectancy xuống giả tạo. Bảng dưới là bản đã sửa.

| Mô hình | khung | win% | expR sau phí |
|---|---|---|---|
| A. limit + pivot (**cũ**) | 5m / 15m / 1h | 5% / 6% / **0%** | −1.57 / −1.30 / −1.39 |
| C. market + R (**mới**) | 5m / 15m / 1h | **37% / 31% / 28%** | −0.62 / −0.85 / −0.35 |
| D. market + R, `slBuf=1.5` | 5m / 15m / 1h | 35% / 33% / 32% | −0.28 / −0.22 / −0.13 |
| E. market + R, `slBuf=2.5` | 5m / 15m / 1h | 37% / 36% / 41% | −0.05 / −0.06 / **+0.16** |

**Đổi mô hình là cải thiện THẬT và lớn**: win 0–6% → 28–41%; expR −1.4 → −0.1. Nhưng **vẫn chưa
dương** ở hầu hết cấu hình (ô +0.16 nằm trong nhiễu: SE ±0.14).

### 🔴 Baseline ngẫu nhiên (D12) — câu trả lời quyết định: **CHƯA CÓ LỢI THẾ**

Cùng số lệnh, cùng tỷ lệ LONG/SHORT, cùng hình học SL/TP, cùng phí; 300 lần thử:

| khung | slBuf | VSA expR | Ngẫu nhiên expR (p95) | VSA hơn? |
|---|---|---|---|---|
| 5m | 0.5 | −1.30 | −1.79 (−1.58) | có |
| 5m | 1.5 | −0.49 | −0.58 (−0.39) | **không** |
| 5m | 2.5 | −0.08 | −0.39 (−0.22) | có |
| 15m | 0.5 | −1.09 | −0.93 (−0.74) | **không** |
| 15m | 1.5 | −0.50 | −0.39 (−0.21) | **không** |
| 15m | 2.5 | −0.20 | −0.23 (−0.02) | **không** |
| 1h | 0.5 | −0.37 | −0.44 (−0.20) | **không** |
| 1h | 1.5 | −0.26 | **−0.14** (0.08) | **không** |
| 1h | 2.5 | −0.12 | **−0.10** (0.11) | **không** |

**7/9 cấu hình: VSA KHÔNG phân biệt được với vào lệnh ngẫu nhiên.** Ở 1h, vào lệnh ngẫu nhiên còn
**tốt hơn** VSA (−0.14 vs −0.26; −0.10 vs −0.12). Hai ô "có" đều ở 5m — nơi cả hai đều lỗ nặng, nên
không có ý nghĩa thực tiễn.

### Kết luận — và đây là lúc **tiêu chí dừng** trong roadmap phát huy tác dụng

Theo **D12**: *"không vượt baseline rõ ràng → **dừng tối ưu tham số và sửa luật**, không quay grid tiếp."*

⇒ **KHÔNG nên làm #3 (preset theo khung) và #5 (loại 5m) như những bước "tối ưu" nữa** — tối ưu tham
số trên một luật chưa chứng minh được lợi thế chỉ tạo ra overfit tự tin hơn. Việc đúng tiếp theo là
**xem lại LUẬT**, không phải con số:

1. **SV/BC→ST có thể không phải tín hiệu đảo chiều.** Hiện tại nó bắt đáy/đỉnh ("mua vào đúng
   cấu trúc") — mà bằng chứng cho thấy điều đó không khác ngẫu nhiên. Cân nhắc dùng SV/BC như
   **bối cảnh** (vùng cung/cầu) và vào lệnh theo **xác nhận xu hướng** (BOS/CHoCH — Phase 10),
   tức VSA lọc chứ không phát tín hiệu.
2. **`runDown`/`runUp` quá yếu** (chỉ so `close` với `close[5]`) → gần như mọi bar đều thoả trong
   vài chế độ thị trường. Cần định nghĩa xu hướng bằng cấu trúc, không bằng 5 nến.
3. **Không có bộ lọc chế độ thị trường.** Bắt đáy trong xu hướng giảm là lỗi hệ thống; cần regime
   filter (Phase 9) hoặc điều kiện xu hướng khung lớn.
4. **Đúng là cần đa khung** — nhưng vì lý do khác: hiện tín hiệu chỉ nhìn một khung. Xác nhận
   khung lớn (ví dụ 1h cho tín hiệu 15m) là hướng có cơ sở hơn là chỉnh `slBuf` theo khung.

---

## 5f. ✅ ĐÃ CHẠY ĐA SYMBOL (2026-10-01) — và kết quả **lật ngược** kết luận đơn symbol

> **Thứ tự đọc:** §5b → §5c → §5d (SMC, đã thay thế) → §5f.1 (Wyckoff đơn symbol) → **§5f (đa symbol —
> đây là kết luận)**. Trong file, §5f nằm trước §5f.1/§5d vì là kết luận mới nhất.

**Thiết kế:** 8 symbol (BTC, ETH, SOL, BNB, XRP, DOGE, ADA, LINK) × 2 khung (15m, 1h), 4000 nến mỗi
cặp. Tham số **chọn trước**, không tune theo symbol: `slBuf=1.5`, market, `TP = 2R`, phí 0.1%
round-trip. Mẫu **GỘP** rồi so với baseline ngẫu nhiên gộp (150 lần thử) — không đếm "bao nhiêu
symbol dương" vì đó lại là multiple comparisons.

### Kết quả gộp

| Sự kiện | n gộp | win% | expR ± SE | baseline p95 | vượt? |
|---|---|---|---|---|---|
| **spring** | **599** | 39% | **+0.05 ± 0.06** | −0.10 | có |
| **sos** | **279** | 41% | **+0.16 ± 0.09** | −0.02 | có |
| **lps** | 254 | 33% | **−0.11 ± 0.09** | −0.04 | **KHÔNG** |

### 🔴 Phát hiện then chốt: **LPS — cái tốt nhất trên BTC — KHÔNG trụ được**

Trên BTC đơn lẻ, LPS là ứng viên sáng giá nhất (+0.38 ở 5m, +0.53 ở 15m). Khi chạy 8 symbol:
**LPS thành −0.11 và KHÔNG vượt baseline.** Đây đúng là thứ mà phép thử đa symbol sinh ra để phát hiện.

Và thứ hạng **đảo hoàn toàn**:

| | BTC đơn lẻ (§5f.1) | 8 symbol gộp (§5f) |
|---|---|---|
| tốt nhất | LPS | **SOS** |
| tệ nhất | spring | **LPS** |

⇒ Kết luận đơn symbol ở §5f.1 **không đáng tin**. Bài học: kết quả trên một symbol, một giai đoạn
**không dự đoán được** thứ tự trên tập symbol khác — kể cả khi cùng khung, cùng tham số.

### ⚠️ Kể cả SOS cũng CHƯA đủ để hành động

1. **SOS: +0.16 ± 0.09 → t ≈ 1.8.** Ở 3 sự kiện đã thử, kỳ vọng có ~0.15 lần "vượt oan"; có 1 (SOS)
   → không đáng ngạc nhiên.
2. **Spring +0.05 ± 0.06 gần như đúng bằng 0** (khoảng tin cậy 95% ≈ [−0.07, +0.17]).
3. **Vấn đề nặng nhất — tương quan:** cả 8 symbol đều là crypto, biến động **cùng nhau** trong cùng
   giai đoạn. Gộp 8 symbol **KHÔNG** cho 8 lần lượng thông tin độc lập; cỡ mẫu hiệu dụng gần với
   **số giai đoạn** (~1) hơn là 599. Vì vậy **SE 0.09 bị lạc quan quá mức** — sai số thật lớn hơn nhiều.
4. Phân tán giữa symbol rất lớn (SOL 1h LPS −0.88 so với DOGE 15m LPS +1.26) — đúng dấu hiệu của nhiễu.

⇒ **Kết luận đúng: KHÔNG có cấu hình nào cho thấy lợi thế đủ chắc để ra quyết định.** SPRING/SOS
hơn baseline ngẫu nhiên một chút, nhưng "hơn ngẫu nhiên" ≠ "kiếm được tiền" — nhất là khi mức
+0.05 đến +0.16 nằm trong sai số thật (đã bị thổi phồng bởi tương quan).

### Việc tiếp theo: phải kiểm theo THỜI GIAN, không phải thêm symbol

Thêm symbol **không giải quyết được** vấn đề tương quan. Cách đúng:

1. **Walk-forward theo thời gian** — chia lịch sử dài (≥ 2 năm) thành nhiều cửa sổ, tối ưu trên cửa
   sổ trước, kiểm trên cửa sổ sau. Đây là phép thử **duy nhất** đồng thời xử lý overfit và tương quan.
2. **Bootstrap theo khối thời gian** cho SE — thay vì SE thường (giả định các lệnh độc lập).
3. Chỉ khi walk-forward dương ổn định mới bàn tới preset/khung.

> **Trạng thái tổng thể của TM VSA sau toàn bộ quá trình:** đã sửa **2 lỗi báo cáo thật** (auto-close
> không cần entry khớp; `slBuf=0.5` bất khả thi vì phí), đã cải thiện **mô hình vào lệnh** (win
> 0–6% → 28–41%), đã **thay xác nhận sang Wyckoff** cho nhất quán trường phái — nhưng **vẫn CHƯA
> chứng minh được lợi thế**. Đây là kết luận trung thực, không phải thất bại: biết chắc điều đó rẻ
> hơn nhiều so với việc đưa tiền thật vào một luật chưa kiểm chứng.

> **§5d ở trên đã bị THAY THẾ.** BOS/CHoCH là kỹ thuật **SMC**, không phải Wyckoff → đã bỏ để
> nhất quán trường phái (theo yêu cầu). Ghi lại để biết: nó cho ra 3–22 lệnh/4000 nến nên
> không thể kết luận, và không cấu hình nào vượt baseline.

### 5f.1 Kết quả ĐƠN SYMBOL (BTC) — chỉ để so sánh, KHÔNG dùng để kết luận

### Đã cài: xác nhận bằng sự kiện Wyckoff

| Khái niệm | Cài bằng |
|---|---|
| **Spring** (Phase C) | `low < support` **nhưng** `close > support` và `close > open` — phá vỡ **thất bại** mới là tín hiệu |
| **UTAD** (gương) | `high > resistance` **nhưng** `close < resistance` và `close < open` |
| **SOS** (Phase D) | `close > resistance` + thân ≥ `sosSpread × ATR` + volume ≥ `sosVol × MA` |
| **SOW** (gương) | `close < support` + thân mạnh + volume mạnh |
| **LPS** | Pullback sau SOS giữ **trên đáy bar SOS**, cách ≤ `lpsTol × ATR` |
| **LPSY** (gương) | Hồi lên sau SOW giữ **dưới đỉnh bar SOW** |

Input mới: `Chien luoc` (`VSA dao chieu` / `VSA loc + Wyckoff`), `Su kien Wyckoff`
(`Spring` / `SOS` / `LPS`), `sosSpread`, `sosVol`, `lpsTol`. Ở chế độ Wyckoff: entry luôn
**market**, và **SL đặt ngoài đáy/đỉnh của chính bar kích hoạt**. VSA (`svFresh`/`bcFresh`) chỉ
còn là **bộ lọc vùng**. SHORT là gương đối xứng của LONG.

### Tần suất — lần này KHỎE (khác hẳn bản SMC)

| khung | spring | utad | sos | sow | lps | lpsy |
|---|---|---|---|---|---|---|
| 5m | 55 | 69 | 103 | 72 | 76 | 89 |
| 15m | 50 | 80 | 112 | 73 | 117 | 81 |
| 1h | 43 | 57 | 91 | 80 | 62 | 56 |

### 🔎 Kết quả đo (slBuf=1.5, market, TP theo R=2, phí theo rủi ro thật, baseline ngẫu nhiên)

| Sự kiện | khung | n | win% | expR | hơn ngẫu nhiên (p95)? |
|---|---|---|---|---|---|
| spring | 5m / 15m / 1h | 70 / 57 / 47 | 33% / 32% / 28% | −0.34 / −0.26 / −0.25 | không / không / không |
| **sos** | **1h** | **28** | **61%** | **+0.71** | **CÓ** |
| sos | 5m / 15m | 36 / 8 | 36% / 25% | −0.17 / −0.37 | không / không |
| **lps** | **5m** | **35** | **57%** | **+0.38** | **CÓ** |
| **lps** | **15m** | **14** | **57%** | **+0.53** | **CÓ** |
| lps | 1h | 18 | 44% | +0.22 | không |

**Đây là lần đầu tiên trong toàn bộ quá trình điều tra có thứ vượt được baseline.**

### Phát hiện đáng chú ý nhất: **Spring — kỹ thuật nổi tiếng nhất của Wyckoff — lại TỆ NHẤT**

Spring âm ở **cả ba khung** (−0.25 … −0.34) và không bao giờ vượt baseline. Trong khi đó **LPS**
(vào sau khi SOS đã xác nhận) và **SOS** lại dương. Diễn giải: bắt đúng cái spring = bắt dao rơi;
**chờ xác nhận rồi vào** mới là cách dùng Wyckoff có cơ sở — đúng tinh thần "chờ dấu hiệu sức mạnh"
(Phase D) thay vì đoán đáy (Phase C).

### ⚠️ Chưa được kết luận — đọc kỹ trước khi tin

1. **n rất nhỏ** (14–35) → SE 0.25–0.40. "CÓ" nghĩa là trên phân vị 95 của phân bố ngẫu nhiên, nhưng
   với n=14 thì mong manh.
2. **Đã thử 9 tổ hợp** (3 sự kiện × 3 khung). Với mức 95%, kỳ vọng ngẫu nhiên đã có ~0.45 lần dương
   oan; ở đây có 4 → **gợi ý, chưa phải bằng chứng**.
3. **Một symbol, một giai đoạn, in-sample** — BTC ~41 ngày (15m). Chưa walk-forward, chưa hold-out.
4. ~~**Chưa có slippage**, giả định khớp đúng giá đóng cửa.~~ → **Đã có slippage** trong
   `engine/backtest.mjs` từ `ENGINE_VERSION` **0.5.0** (`slipPct` mặc định 0.02% mỗi chiều,
   cộng phí round-trip `feePct` 0.05%). Lưu ý: *số liệu ở mục này vẫn được tính trên Pine với
   `slippage=0`* — nên phần kết luận 1–3 **chưa** được chạy lại với chi phí thật.

⇒ Kết luận đúng: **LPS/SOS là hướng ĐÁNG đi tiếp, không phải hướng đã chứng minh.** Việc cần làm
trước khi tin: đo trên **nhiều symbol** (không chỉ BTC) và **lịch sử dài hơn**, rồi walk-forward.

### Việc tiếp theo (theo thứ tự)

1. **Đa symbol** — chạy LPS/SOS trên ETH, SOL và vài alt để xem còn dương không. Đây là phép thử
   rẻ nhất và mạnh nhất để loại bỏ may mắn của một symbol.
2. **Lịch sử dài hơn** (≥ 1 năm) + walk-forward 70/30.
3. Chỉ sau đó mới bàn tới preset theo khung (`slBuf` v.v.).

> ⚠️ Vẫn còn cảnh báo từ §6: kể cả khi LPS dương trên nhiều symbol, **20–35 lệnh là quá ít** để
> kết luận thống kê. Cần cỡ mẫu hàng trăm lệnh mỗi cấu hình.

## 5d. ⛔ ĐÃ BỊ THAY THẾ — chiến lược SMC (BOS/CHoCH), ghi lại để tham chiếu

> Khối này nằm ở cuối file vì tài liệu được bổ sung dần theo thời gian. Nội dung đã bị §5e/§5f
> thay thế (BOS/CHoCH là kỹ thuật SMC, không phải Wyckoff) — giữ lại để biết đã thử gì và vì sao bỏ.

### Đã cài (engine + Pine, có test khoá hành vi)

| Input | Giá trị |
|---|---|
| `Chien luoc` | `VSA dao chieu` (mặc định, hành vi cũ) · `VSA loc + xac nhan xu huong` |
| `Loai pha cau truc` | `BOS + CHoCH` · `Chi BOS` · `Chi CHoCH` |

Cách cài (quan trọng để không hiểu sai):
- BOS/CHoCH dùng phép **"cắt"**: `close[1] <= muc && close > muc` → mỗi mức chỉ kích hoạt **một lần**,
  không lặp lại mỗi bar khi giá còn nằm trên mức đó.
- Phân biệt BOS vs CHoCH bằng `tm_structDir`: pha **tiếp** hướng cấu trúc = BOS; pha **ngược** = CHoCH.
- Ở chế độ trend, `entryMode` tự chuyển thành **market** (limit tại cực trị không còn nghĩa lý).
- VSA chỉ còn vai trò **bộ lọc vùng**: `svFresh` cho LONG (vùng cầu), `bcFresh` cho SHORT (vùng cung).
- Dashboard thêm dòng **"Chien luoc"**.

> Trong lúc port, mình **vô tình bỏ `tm_okBar`** (gate "chỉ nến đã đóng") ở cả hai nhánh chiến lược.
> Đã sửa và thêm test khoá riêng (`GIU tm_okBar o CA HAI nhanh`) — nếu không, tín hiệu sẽ phát cả
> trên nến chưa đóng và gây repaint.

### 🔴 Kết quả đo: KHÔNG như mong đợi — và **không thể kết luận**

`slBuf=1.5`, mô phỏng độc lập 500 nến, phí theo rủi ro thật, so với baseline ngẫu nhiên:

| Mô hình | khung | n | win% | expR | hơn ngẫu nhiên (p95)? |
|---|---|---|---|---|---|
| **vsa** (hiện tại) | 5m | 168 | 35% | −0.28 | có |
| vsa | 15m | 146 | 34% | −0.22 | không |
| vsa | 1h | 116 | 32% | −0.13 | không |
| **trend** both | 5m | **22** | 18% | −0.60 | không |
| trend both | 15m | **6** | 17% | −0.78 | không |
| trend both | 1h | **17** | 53% | +0.19 | không |
| trend chỉ BOS | 15m | **3** | 33% | −0.50 | không |
| trend chỉ CHoCH | 1h | **5** | 80% | +0.68 | không |

**Vấn đề số 1 không phải kết quả, mà là SỐ LỆNH SỤP: 116–168 → 3–22.**

Lý do: điều kiện "vừa có vùng SV/BC còn hiệu lực, **vừa** có pha cấu trúc" rất chặt, mà `pivLen = 20`
làm pivot **hiếm** và **xác nhận trễ 20 nến**. Với n = 3–22 thì **không thể kết luận thống kê gì** —
kể cả ô "win 80%" (n=5) cũng chỉ là nhiễu.

⇒ Kết luận đúng: **chiến lược mới CHƯA được chứng minh, nhưng cũng CHƯA bị bác bỏ** — mẫu quá nhỏ.
Không được nói nó tốt hơn, cũng không được nói nó tệ hơn.

### Việc cần làm để kết luận được

1. **Đo trên lịch sử dài hơn nhiều.** 4000 nến 15m ≈ 41 ngày — quá ngắn cho một chiến lược ra
   ~0.15 tín hiệu/100 nến. TradingView nạp ~20.000 nến/khung → dùng chart để A/B thay vì tin vào
   mẫu nhỏ này.
2. **`pivLen` là tham số CẤU TRÚC, không phải tham số tối ưu.** Với BOS/CHoCH, `pivLen = 20` nghĩa
   là swing 20 nến hai bên — rất thô. Hạ về 5–10 là điều chỉnh **đúng về phương pháp** (độ nhạy
   swing), không phải "grid search". Hãy chọn theo khung, không chọn theo kết quả.
3. **Cảnh báo phương pháp:** BOS/CHoCH là kỹ thuật của SMC, không phải Wyckoff. Mình đã cài đúng
   như yêu cầu, nhưng cần biết đây là **ghép hai trường phái** — nếu sau này muốn thuần Wyckoff thì
   tín hiệu xác nhận phải là *spring / test / SOS (sign of strength)*, không phải phá swing.

---

## 6. Cảnh báo về độ tin cậy — ĐỌC TRƯỚC KHI DÙNG SỐ

Các con số trên **chỉ để định hướng**, chưa đủ để tin:

1. **Một symbol, một giai đoạn, in-sample.** BTC 1h trong ~166 ngày gần đây — nếu giai đoạn đó
   tăng giá thì "mua đáy" thắng là nhờ thị trường, không phải nhờ phương pháp.
2. **Chưa walk-forward, chưa hold-out** (roadmap **D12** yêu cầu baseline ngẫu nhiên cùng phân phối
   SL/TP — chưa làm).
3. **Expectancy 1h vẫn tăng ở mép lưới `slBuf = 3.0`** → chưa tìm ra đỉnh, dấu hiệu cần mở rộng lưới
   **và** kiểm tra ngoài mẫu trước khi kết luận.
4. **Chưa tính trượt giá**; giả định limit khớp đúng giá.
5. **Các setup chồng lấn được tính độc lập** — không có ràng buộc vốn.

⇒ Kết luận đúng đắn hiện tại: **`slBuf = 0.5` là cấu hình sai về mặt toán học ở mọi khung, và 5m/15m
không phù hợp với phương pháp này.** Còn "1h có edge" thì **chưa được chứng minh** — phải qua
Phase 4 (backtest đầy đủ + walk-forward + hold-out + baseline).