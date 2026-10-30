# MTF One-Candle — Phương pháp "quét khung lớn → 1 cây nến" của Nh Kiến Thức Trading

> **Nguồn:** 2 video mới trong `D:\Trading\nnhkienthuctrading` (tải 29–30/10):
> 1. `Mn có ý tưởng hành trình thử thách gì cứ bl nhé kk #xuhuong #trader #....mp4` (459s, **USOIL**, app điện thoại) — caption mở đầu: *"TUYỆT KỸ NHỒI LỆNH ĐẠI PHÁP ĐÃ GIÚP MÌNH KIẾM 50TR/NGÀY"*.
> 2. `video dài hơn 7 phút cực kỳ giá trị là kinh nghiệm hơn 9 năm trên thị....mp4` (468s, **XAU/USD 15m**, app điện thoại) — caption mở đầu: *"PHƯƠNG PHÁP TRADE CHỈ VỚI 1 CÂY NẾN DUY NHẤT"*.
>
> **Cách trích xuất bằng chứng (khác với series cũ):** hai video này **không có thuyết minh** — track audio chỉ có nhạc
> (đã kiểm tra: `ffprobe` báo audio video 2 dài 60s trên tổng 468s; Whisper large-v3 trả **0 segment**, ép
> `language=vi` thì lặp lại đúng một câu vô nghĩa → xác nhận là nhạc, không có lời). Nội dung thật nằm ở
> **nét vẽ tay + caption chữ trên màn hình**, nên cách đọc là: ffmpeg cắt 1 khung/6s → ghép filmstrip 3×2 →
> đọc caption/nhãn khung thời gian/nét vẽ bằng vision,
> rồi mở lại khung gốc ở các mốc quan trọng để kiểm chứng trực tiếp.
> Nhật ký trích xuất lưu tại `logs/nkt2/timeline.txt` (mốc thời gian → khung TG → nét vẽ).
>
> **Mục đích:** chuẩn hóa thành spec để xây **bộ chỉ báo mới** (đề xuất tên `MTF One-Candle`) — xem
> [BUILD.md](./BUILD.md). Đây **không** phải bản sao của `Price Action MTF`
> ([docs](../price-action-mtf/README.md)): PA MTF là hệ *chấm điểm hội tụ 3/3* trên mẫu hình giá, còn phương pháp
> này là **thang khung thời gian tuyến tính + đúng một cây nến mồi + nhồi lệnh theo bậc**.

---

## 1. Kết luận ngắn

Phương pháp gồm **hai nửa rất khác nhau**, và hai video minh họa đúng hai nửa đó:

```
NỬA A — LỌC (video 2, XAU 15m)              NỬA B — NHỒI LỆNH (video 1, USOIL)
D1  → xu hướng / vùng lớn                   D1  → xu hướng (không vẽ gì)
H4  → khoanh cụm nến = vùng hiện hành       H4  → khoanh cụm nến = vùng cung
H1  → cấu trúc trong vùng                   H1  → cấu trúc trong vùng
M30 → mức vào / dời lệnh                    M10 → hộp đỏ = vùng cầu, mũi tên hướng
M15/M10/M5 → MỘT cây nến mồi → entry        M5  → điểm nhồi tiếp + dời SL
```

Điểm cốt lõi người dùng đã nhận ra là đúng: **kiểm tra nhiều khung lớn trước, chỉ tìm điểm vào ở khung nhỏ**, và
khung nhỏ **không được tự quyết định hướng** — nó chỉ chọn *một cây nến* để đo Entry/SL/TP.

Ba câu chốt của phương pháp:

1. **Hướng do khung lớn, điểm do khung nhỏ.** Khung nhỏ chỉ có quyền chọn *cây nến*, không có quyền đổi chiều.
2. **Một cây nến là đủ để định rủi ro.** Không cần mẫu hình 2–3 đỉnh: chọn 1 nến tại biên vùng, entry khi phá biên
   nến, SL ở phía đối diện của chính nến đó, TP ở vùng đối diện gần nhất.
3. **Đúng hướng thì nhồi, sai thì cắt.** Video 1 tăng khối lượng theo bậc (0.01 → 0.11 → 0.34 → 0.73 lô) và dời SL
   về hoà vốn, không phải vào một lần rồi thả.

---

## 2. Bằng chứng theo mốc thời gian

### 2.1 Video 1 — USOIL, "nhồi lệnh" (459s)

| Thời điểm | Khung TG đọc được | Hành động / nét vẽ quan sát được |
|---|---|---|
| 0–6s | — | Caption: *"TUYỆT KỸ NHỒI LỆNH ĐẠI PHÁP… 50TR/NGÀY"*; *"mn xem cách mình phân tích và xử lý lệnh này để thấy sự logic"* |
| 36–48s | **1 ngày** | Biểu đồ D1 sạch, **không nét vẽ** → chỉ đọc xu hướng/vùng lớn (giá 85 → 103) |
| 54s | **4 h** | **Khoanh đỏ tròn** quanh cụm 3–4 nến gần nhất ở vùng đỉnh → đánh dấu vùng cung hiện hành |
| 60–66s | **1 h** | Xem cấu trúc bên trong vùng vừa khoanh, chưa vẽ thêm |
| 72–78s | **10 m** | **Hộp chữ nhật đỏ** vẽ từ đáy cũ sang phải (vùng cầu) + **mũi tên xanh chỉ lên** |
| 90–102s | 10 m | Bảng lệnh: Buy **0.01 → 0.11 → 0.34 lô** tại ~100.003–100.007 (**nhồi tăng dần**, không phải 1 lệnh) |
| 108s | 10 m | *"Đã mở lệnh USOIL Mua 0.73 lô tại 100.006"* — tổng vị thế 0.73 lô |
| 144–174s | 4 h → **30 m** | Sửa lệnh: nhãn **Entry / TP / SL**; xem lại khung lớn khi chỉnh mức |
| 192–210s | 10 m | **Đường cong đỏ vẽ tay đi xuống** + khoanh đỏ vùng giảm; **mua thêm** 0.73 @100.514, 0.65 @100.506, 0.55 @100.483 (nhồi tiếp khi giá hồi) |
| 228s | **5 m** | Xuống khung nhỏ nhất để canh điểm nhồi cuối |
| 246–264s | 5 m | TP 101.063; *"Lệnh đã sửa đổi"*; **SL dời về 100.006 = entry** (hoà vốn) |
| 288–294s | — | TP ≈ +20.0 triệu VND, **SL = 0** → đã khoá rủi ro trước khi TP |
| 300–324s | 5 m → 30 m → 5 m | Dời lệnh theo giá (100.917 / 100.98 / 101.001 / 101.158) |
| 396–462s | 5 m | Các mức 100.259 / 100.245 rồi 100.238 / 100.224 / 100.000 — chuỗi mức dời SL/TP |

**Đọc ra từ video 1:** thang khung là **D1 → H4 → H1 → M10 → M5** (M30 dùng khi quản lý). Ở mỗi bước chỉ *một* việc:
D1 đọc hướng, H4 khoanh vùng, H1 xem cấu trúc trong vùng, M10 vẽ hộp cầu + mũi tên hướng, M5 canh điểm nhồi. Toàn bộ
phần "kỹ" của video là **quản lý vị thế** (nhồi theo bậc, dời SL về entry), không phải tìm điểm vào.

### 2.2 Video 2 — XAU/USD 15m, "1 cây nến" (468s)

| Thời điểm | Khung TG đọc được | Hành động / nét vẽ quan sát được |
|---|---|---|
| 0–30s | 15 m | Caption: *"PHƯƠNG PHÁP TRADE CHỈ VỚI 1 CÂY NẾN DUY NHẤT"* |
| 36–60s | 15 m | Các đường ngang 4395.07 / 4395.49 / 4375.65; có lệnh **LMT + SL** đang đặt |
| **66s** | 15 m | **Khoanh tròn đỏ đúng 1 cây nến nhỏ** trong cụm nến + mũi tên đỏ chỉ vào → đây là "cây nến" của phương pháp |
| 108–126s | 15 m | Hộp/khoanh đỏ quanh nến; chữ viết tay **"SL – entry – TP"** với 3 đường ngang theo thứ tự **SL trên → entry giữa → TP dưới** (kèo **SELL**); đọc trên trục giá: SL ≈ **4400**, entry ≈ **4394–4396**, TP ≈ **4390–4392** → TP **gần hơn** SL, RR thấp (~1–1.5) |
| 138–216s | 15 m | Chữ viết tay **"TP / Entry / SL"**: TP ≈ **4410** (đỉnh trước, sát trục giá), entry ≈ **4394–4396**, SL ≈ **4391** (ngay dưới nến) + mũi tên hướng lên (kèo **BUY**); TP xa gấp ~3 lần SL (RR ước lượng ~3, đo theo trục giá, sai số ±0.3R) |
| 264–288s | 15 m | Khoanh tròn nến + mũi tên + vùng đỏ (lặp lại thao tác chọn nến) |
| **306–318s** | **1 h** | Nhảy lên H1 giữa bài → kiểm tra bối cảnh trước khi chốt |
| 336s | — | Mở menu **"Khung thời gian"** (1 phút → 1 tuần) — dạy thao tác đổi khung |
| 342s | **30 m** | Đặt **LMT 4396.197**, SL −1,027.20 USD → mức vào lấy từ khung lớn hơn |
| 360–432s | 15 m | Hộp đỏ quanh **đỉnh nến**, vạch dọc mốc thời gian; LMT dời 4395.09 → 4394.74 → 4395.09 (bám giá) |
| 438–450s | 1 h → 30 m → 15 m | Kết bài: nhắc lại thang khung trước khi chốt |
| 456s | — | Outro TikTok (kênh, link mở tk) |

**Đọc ra từ video 2:** khung làm việc là **M15**, nhưng **H1 và M30 được kiểm tra trước và sau** khi đặt lệnh; mức
vào lấy từ khung lớn (LMT 4396.2 trên M30), còn **một cây nến trên M15 chỉ dùng để đo Entry/SL/TP**. Hai kèo được vẽ
tay đầy đủ: một SELL có TP gần hơn SL (RR ~1–1.5) và một BUY có TP xa gấp ~3 lần SL.

> **Lưu ý trung thực:** cả hai video **không nói** tiêu chí chọn đúng cây nến nào (nến nhỏ? inside bar? nến từ chối?).
> Ở 66s nến được khoanh là **nến thân nhỏ nằm trong cụm nến** — khớp với "nến mồi/inside bar". Phần định lượng dưới
> đây là **chuẩn hóa của mình** (suy luận có cơ sở), không phải câu chữ của tác giả video.

---

## 3. Phương pháp chuẩn hóa

### 3.1 Thang khung thời gian (bắt buộc đi từ lớn xuống nhỏ)

| Tầng | Khung | Câu hỏi duy nhất phải trả lời | Được phép vẽ gì |
|:---:|---|---|---|
| **T1 — Bối cảnh** | D1 | Xu hướng lớn là gì (HH/HL, LH/LL, range)? Vùng lớn nào đang chặn? | Không vẽ (video 1 để chart sạch) **[QS]** |
| **T2 — Vùng** | H4 | Vùng cung/cầu **hiện hành** nằm ở đâu (cụm nến gần nhất)? | Khoanh tròn cụm nến **[QS]** |
| **T3 — Cấu trúc** | H1 (và M30 để lấy mức) | Trong vùng đó cấu trúc nghiêng bên nào? Mức vào chính xác? | Đường ngang mức + lệnh LMT **[QS]** |
| **T4 — Kích hoạt** | M15 / M10 | Chọn **1 cây nến** tại biên vùng → đo high/low | Khoanh/hộp quanh 1 nến, vẽ Entry/SL/TP **[QS]** |
| **T5 — Quản lý** | M5 | Nhồi thêm hay dời SL? | Đường dời lệnh, SL = entry **[QS]** |

Quy tắc cứng: **tầng dưới không được phủ định tầng trên.** Nếu D1 tăng mà M15 có tín hiệu bán → bỏ, không trade
ngược (đúng nguyên tắc "không bao giờ chống trend" đã ghi trong [phương pháp gốc](../xau/xau-price-action-method.md)).
Hai video đều chỉ trade **cùng chiều** với cấu trúc khung lớn.

### 3.2 Định nghĩa "một cây nến" (nến mồi)

Nến mồi = nến **tại biên vùng** (T2/T3) thoả **ít nhất 2 trong 4** điều kiện sau:

| # | Điều kiện | Công thức |
|---|---|---|
| 1 | Thân nhỏ (nén lực) | $\\text{body} \\le 0.35 \\times \\text{range}$ |
| 2 | Nằm trong nến trước (inside bar) | $\\text{high} \\le \\text{high}[1]$ và $\\text{low} \\ge \\text{low}[1]$ |
| 3 | Râu từ chối về phía vùng | $\\dfrac{\\text{râu đối diện}}{\\text{range}} \\ge 0.5$ |
| 4 | Biên độ hẹp so với ATR | $\\text{range} \\le 0.6 \\times \\text{ATR}(14)$ |

Nến mồi **không** quyết định chiều. Chiều lấy từ T1–T3; nến mồi chỉ cấp **3 con số**: `refHigh`, `refLow`, `refClose`.

### 3.3 Entry / SL / TP (đo từ đúng một cây nến)

Gọi $r = \\text{refHigh} - \\text{refLow}$ (biên độ nến mồi), $\\text{buf} = k_{buf} \\times \\text{ATR}$:

| Thành phần | BUY | SELL |
|---|---|---|
| Entry | phá lên: $\\text{close} > \\text{refHigh}$ | phá xuống: $\\text{close} < \\text{refLow}$ |
| Stop | $\\text{refLow} - \\text{buf}$ | $\\text{refHigh} + \\text{buf}$ |
| Risk ($R$) | $\\text{entry} - \\text{stop}$ | $\\text{stop} - \\text{entry}$ |
| TP1 | vùng đối diện gần nhất (đỉnh/đáy trước, PDH/PDL) | như BUY đảo chiều |
| TP2 (tuỳ chọn) | $\\text{entry} + 2R$ hoặc measured move $= r \\times m$ | đối xứng |

Bộ lọc tối thiểu: **$RR = \\dfrac{TP1 - entry}{R} \\ge 1.5$**, ngược lại **không vào**. Cơ sở: trong hai kèo vẽ tay ở
video 2, kèo SELL có TP **gần hơn** SL (RR ~1–1.5) — sau spread/phí XAU gần như hoà vốn; kèo BUY có TP xa gấp ~3 lần SL
→ chỉ kiểu kèo thứ hai mới đáng đưa vào chỉ báo.

SL đặt **sau chính nến mồi**, không sau "đỉnh gần nhất" — đây là điểm khác biệt lớn nhất so với PA MTF (SL sau cấu
trúc). Nhờ vậy $R$ luôn nhỏ, cố định và đo được ngay khi nến đóng.

### 3.4 Nhồi lệnh (nửa B, từ video 1)

Video 1 nhồi **theo bậc khi giá đi đúng hướng**, khối lượng tăng dần: 0.01 → 0.11 → 0.34 → 0.73 lô **[QS]**
(tỷ lệ mỗi bậc ≈ ×3.3–3.6). Chuẩn hóa:

| Bậc | Điều kiện kích hoạt | Khối lượng | SL |
|:---:|---|---|---|
| L0 (mồi) | entry hợp lệ (§3.3) | 1 đơn vị | sau nến mồi |
| L1 | giá đạt $+0.5R$ và đóng nến cùng chiều | ×2 | dời về entry (hoà vốn) |
| L2 | giá đạt $+1.0R$ và có nến xác nhận trên M5 | ×3 | dời về $+0.5R$ |
| L3 | giá đạt $+1.5R$, còn cách TP1 $\\ge 0.5R$ | ×4 | dời về $+1.0R$ |

Điều kiện dừng nhồi: chạm TP1, hoặc xuất hiện nến ngược chiều mạnh (engulfing ngược / pin từ chối) trên M5, hoặc
khoảng cách tới TP1 $< 0.5R$. Video 1 dời SL về đúng entry (SL = 0 lãi/lỗ) trước khi TP **[QS]** — đây là hành vi
bắt buộc, không phải tuỳ chọn.

---

## 4. Checklist 8 bước (dùng khi build + khi trade tay)

1. [ ] **D1:** xác định xu hướng (HH/HL, LH/LL, range) — ghi 1 dòng, không vẽ.
2. [ ] **H4:** khoanh **cụm nến gần nhất** = vùng hiện hành (cung nếu ở đỉnh, cầu nếu ở đáy).
3. [ ] **H1:** cấu trúc trong vùng nghiêng bên nào → chốt **chiều được phép trade**.
4. [ ] **M30:** lấy **mức vào** (biên vùng / LMT) + mức huỷ.
5. [ ] **M15/M10:** chờ giá vào vùng, tìm **đúng 1 nến mồi** (§3.2).
6. [ ] Đo `refHigh/refLow` → Entry, SL, TP1; **bỏ nếu RR < 1.5**.
7. [ ] Vào L0; đạt $+0.5R$ → dời SL về entry; nhồi L1–L3 theo §3.4.
8. [ ] Chạm TP1 hoặc nến ngược mạnh trên M5 → đóng toàn bộ; ghi log (RR thực, lý do thoát).

---

## 5. Điểm mạnh / điểm yếu (đánh giá thẳng)

### 5.1 Điểm mạnh

- **Thang khung tuyến tính, không nhảy cóc.** D1→H4→H1→M30→M15→M5 là quy trình cố định, dễ mã hoá thành state
  machine và dễ audit (mỗi tầng một output rõ ràng).
- **Rủi ro đo được ngay.** Vì SL nằm sau nến mồi, $R$ biết trước khi vào lệnh — khác với "SL sau cấu trúc" phải chờ
  xác nhận đỉnh/đáy.
- **Không cần mẫu hình phức tạp.** Một nến là đủ → tín hiệu dày, backtest được trên mọi khung, không phụ thuộc neckline
  (thứ hay bị vẽ lại).
- **Có lớp quản lý thật.** Nhồi theo bậc + dời SL về entry là phần duy nhất trong các video của kênh này mô tả **quản
  lý vị thế** thay vì chỉ điểm vào.

### 5.2 Điểm yếu / rủi ro (phải bù khi hệ thống hoá)

| # | Vấn đề | Hệ quả | Cách bù trong chỉ báo |
|:---:|---|---|---|
| 1 | **Không có tiêu chí chọn nến** trong video (chỉ khoanh tay) | Cùng một chart, hai người khoanh hai nến khác nhau → kết quả khác nhau | Định lượng §3.2 (4 điều kiện, cần ≥2) + hiển thị lý do đạt/không |
| 2 | **Không có volume** | Nến mồi ở vùng "trống" dễ bị quét | Dùng VSA bucket có sẵn (`f_vsaColor` trong `pine/shared/common.pine`): veto nếu nến phá có volume yếu |
| 3 | **Nhồi lệnh tăng khối lượng** (0.01→0.73 = ×73) | Đây là martingale một chiều; chỉ cần 1 lần sai cấu trúc là mất phần lớn tài khoản | Giới hạn cứng: tổng khối lượng ≤ 4×L0, và **cấm nhồi khi giá đã đi ngược > 0.5R**; mô phỏng drawdown trước khi bật |
| 4 | **Video chỉ khoe ngày thắng** ("50TR/NGÀY") | Survivorship nặng, không suy ra được winrate | Bắt buộc backtest + baseline ngẫu nhiên (quy trình `docs/indicator/tm-indicator-2/ablation-walkforward-protocol.md`) |
| 5 | **Một trong hai kèo mẫu có TP gần hơn SL** (RR ~1–1.5) | Sau spread/phí XAU (0.15–0.35) là âm | Bộ lọc $RR \\ge 1.5$ ở §3.3, hiển thị $RR$ lên dashboard, chặn alert nếu dưới ngưỡng |
| 6 | **Video đổi khung liên tục không nói lý do** | Người xem dễ nhầm "đổi khung để tìm tín hiệu đẹp hơn" | Chỉ báo khoá thang khung bằng input, mỗi tầng 1 hàng dashboard, không cho đổi giữa chừng |
| 7 | **Không lọc phiên/news** | Vào lệnh giờ chết → spread + slippage | Bật session filter + tránh NFP/CPI ±15 phút (hạ tầng `services/news` đã có) |
| 8 | **TP lấy "vùng đối diện" bằng mắt** | TP mỗi lệnh một kiểu, không so sánh được | Chuẩn hoá TP1 = pivot đối diện gần nhất (ATR band), TP2 = $2R$; có toggle |

### 5.3 So với các bộ đã có trong repo

| Tiêu chí | PA MTF (`price-action-mtf`) | **MTF One-Candle (bộ này)** |
|---|---|---|
| Cấu trúc tín hiệu | Mẫu hình giá (DT/DB/H&S) phá neckline | **1 nến mồi** tại biên vùng |
| Số khung dùng | Context + Setup | **5 tầng** D1→H4→H1→M30→M15/M5 |
| Điều kiện vào | Hội tụ 3/3 (trend + level + xác nhận) | **1 nến + RR ≥ 1.5** (lỏng hơn nhiều) |
| SL | sau cấu trúc/mẫu hình | **sau chính nến mồi** (R nhỏ, cố định) |
| Quản lý | BE tại TP1, trailing TP2 | **nhồi theo bậc L0–L3 + dời SL** |
| Rủi ro chính | Ít tín hiệu, phụ thuộc neckline | **Nhiều tín hiệu nhiễu + martingale khi nhồi** |

→ Hai bộ **bổ sung**: PA MTF dùng làm bộ lọc chất lượng (chỉ trade khi PA MTF ≥ 2/3), One-Candle dùng làm trigger +
quản lý vị thế. Không nên chạy One-Candle một mình trên tài khoản thật trước khi có backtest.

---

## 6. Câu hỏi mở (cần chủ dự án xác nhận trước khi build)

1. **Tiêu chí nến mồi**: dùng đúng 4 điều kiện §3.2 (≥2) hay chỉ inside bar + thân nhỏ? Video không nói.
2. **Nhồi lệnh**: có bật mặc định không? Nếu bật, dừng ở L2 hay cho tới L3 (×4)?
3. **TP**: ưu tiên "vùng đối diện" (pivot) hay $2R$ cố định? Bộ PA MTF đã chọn R cố định vì lý do đo lường.
4. **Cặp mục tiêu**: XAU + USOIL như video, hay mở cho BTC/Futures?
5. **Có gộp vào `Price Action MTF` như một entry mode** thay vì bộ mới không? (Nếu gộp: thêm 1 module `76_one_candle` và
   1 entry mode, không cần bộ dist mới.)

---

## 7. Việc cần làm tiếp

1. Chốt 5 câu hỏi §6.
2. Theo [BUILD.md](./BUILD.md) dựng module, build, smoke test.
3. Backtest A/B: `MTF One-Candle` vs `Price Action MTF` trên cùng XAU M15 (2023–2026), có phí + slippage.
4. Chỉ khi vượt baseline ngẫu nhiên mới bật lên dashboard production.
