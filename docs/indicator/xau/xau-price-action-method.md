# Phương pháp Price Action + Hội tụ Đa khung — "Nh Kiến Thức Trading"

> **Nguồn:** 17 video trong `D:\Trading\nhkienthuctrading` (series "7 ngày học trade cho người
> mới" + series live "Hành trình 10→1000"). Trích âm thanh bằng ffmpeg → Whisper (faster-whisper
> small, `logs/nkt/transcripts/`). **9/17 video chỉ có nhạc/outro** (n01, n02, n09, n11, n13–n17) —
> nội dung thực nằm ở **8 video có thuyết minh** (n03–n08, n10, n12).
> **Mục đích:** chuẩn hóa thành spec cho **bộ chỉ báo XAU thế hệ mới** — dùng song song với
> `TM VSA Wyckoff` (`pine/parts-vsa/`) vì hai trường phái bổ sung cho nhau: PA cho *cấu trúc +
> thời điểm*, VSA cho *lực*.

---

## 1. Kết luận ngắn

Đây là phương pháp **Price Action cổ điển + hội tụ đa khung (MTF confluence)**, không có volume,
không có indicator phức tạp. Bộ khung 3 lớp:

```
Xu hướng (khung lớn)  →  Vùng giá (S/R, mẫu hình)  →  Cấu hiệu nến xác nhận (khung nhỏ)
```

Trong 8 video thực, trader chủ yếu giao dịch **XAUUSD** khung **H4 (bối cảnh) → M15 (setup) →
M10/M5 (vào lệnh)**, dùng pin bar / engulfing / vai đầu vai, SL sau cấu trúc, TP = vùng đối diện,
kéo về hòa vốn sớm. Đây là **bổ sung đúng chỗ** cho VSA: method VSA của repo bắt buộc "level trước,
volume sau" nhưng không có mẫu hình nến — video này thì ngược lại (nến trước, level kèm theo,
volume bỏ trống).

---

## 2. Nội dung từng video có thuyết minh

| # | Video | Nội dung chính |
|---|---|---|
| n03 | Ngày 4 p1 — Nến Nhật | Bản chất nến: kết quả của lực mua/bán trong 1 khung thời gian. Thân = hướng áp lực; râu = phản kháng (lực đẩy ngược). 15 nến 1m gộp = 1 nến 15m (nến con sinh nến cha) |
| n04 | Ngày 4 p2 — Mẫu hình nến | **Pin bar** (râu dài, thân ngắn — râu ở đâu, lực đẩy ngược ở đó → đảo chiều), **Engulfing/Anh Quốc** (nến to bao trùm nến trước — đảo chiều mạnh nhất), **Inside bar** (lưỡng lực, vào theo hướng thoát ra), **Doji** (lưỡng lực), **Three White Soldiers / Black Crows** (= 1 engulfing trên khung lớn) |
| n05 | Ngày 4 p3 — Mô hình giá | 2/3 đỉnh–đáy (đảo chiều — đỉnh đáy cũ flip thành S/R), Vai đầu vai + ngược, mô hình tích lũy (tam giác, cờ, cốc-tay-cầm) — break ra thì chạy **độ cao mô hình**, điểm break = điểm vào. Quy tắc: **chờ xác nhận phá vai** |
| n06 | Ngày 5 p1 — Xu hướng | 3 xu hướng; HH/HL (tăng), LH/LL (giảm), range = biên trên/dưới. Khung lớn giá trị hơn khung nhỏ; **không bao giờ chống trend** |
| n07 | Ngày 5 p2 — S/R & cấu trúc | Đỉnh/đáy = vùng lệnh lớn của cá mập ("mập") chưa khớp hết — giá quay lại khớp và đẩy. Range trade chạm biên là đảo. **Phá vỡ giả / quét thanh khoản**: giá chạm S/R mà nến chậm, có delay → false break xác suất cao; khi đã quét thì chạy rất mạnh |
| n08 | Ngày 6 — Hội tụ điểm vào | **3 yếu tố bắt buộc hội tụ:** (1) đi cùng xu hướng khung lớn, (2) giá ở vùng S/R đẹp, (3) cấu hiệu nến/mẫu hình (1 trong 2, càng nhiều càng tốt). SL dưới hỗ trợ, TP theo R. Thiếu hội tụ → kiên nhẫn chờ. Tuân thủ kế hoạch = kỷ luật |
| n10 | Hành trình 10→1000 ngày 1 (live XAU) | H4/M15 cho tín hiệu giảm, giá chạm hỗ trợ → chờ; M15 hình thành vai đầu vai; M10 nến engulfing → **buy**, SL ~2$, TP vùng supply; kéo về hòa vốn; thêm 1 lệnh engulfing thứ 2 ("xuất hiện 2 cây engulfing liên tiếp → winrate rất cao"); RR ~1:1; chốt tại vùng kháng cự. Kết thúc +28$ |
| n12 | Hành trình 10→1000 ngày 3 (live XAU) | H4 engulfing → kỳ vọng 3 đáy; M15 engulfing → buy, SL dưới nến pin bar → **bị quét SL** (tự nhận lỗi: "buy khi chưa có tín hiệu rút chân"); sau đó range, sell tại đỉnh trước ăn phản ứng giá, buy break khi tích lũy có khuynh hướng; đóng lệnh sớm khi chạm vùng cung. Kết thúc +15.4$ |

*(n01, n02, n09, n11, n13–n17: không trích được nội dung — audio chỉ có nhạc và dòng outro.)*

---

## 3. Phương pháp chuẩn hóa (rút từ 8 video)

### Nguyên tắc cốt lõi (4 nguyên tắc)

1. **MTF trước, lệnh sau.** Khung lớn quyết định *hướng* (chỉ buy trong uptrend, chỉ sell trong
   downtrend, né khi chưa rõ). Khung nhỏ quyết định *điểm vào*. Không bao giờ chống trend.
2. **Level là nơi ra quyết định.** Đỉnh/đáy cũ = vùng lệnh lớn chưa khớp — S/R là "mục tiêu" và là
   "bệ đỡ". Không level → không lệnh, dù nến đẹp đến đâu (giống hệt nguyên tắc #1 của VSA repo:
   "level trước, signal sau").
3. **Nến là xác nhận, không phải khởi đầu.** Vào lệnh chỉ khi nến xác nhận (pin bar / engulfing /
   inside bar thoát ra / phá vai mẫu hình). Tự nhận lỗi trong n12 chính là xác nhận tối quan trọng:
   *buy khi chưa có tín hiệu rút chân = bị quét*.
4. **SL sau cấu trúc, TP tại vùng đối diện, breakeven sớm.** SL luôn đặt sau đỉnh/đáy + buffer;
   TP = vùng S/R / supply / mục tiêu mô hình; RR tối thiểu 1:1; khi lời ~1R kéo về hòa vốn.

### Thư viện cấu hiệu định lượng (đề xuất — video không định lượng, mình chuẩn hóa theo chuẩn PA)

| Cấu hiệu | Điều kiện định lượng (đề xuất cho Pine) | Hướng |
|---|---|---|
| **Pin bar** | 1 râu ≥ 2× thân, râu ≥ 50% range nến, thân nằm ở 1/3 đối diện | Đảo chiều theo hướng râu bị đẩy về |
| **Engulfing** | thân nến n bao trùm thân nến n−1 (close > open[n−1] với nến xanh, chiều ngược với đỏ), thân ≥ 50% range | Đảo chiều; **2 engulfing liên tiếp = tín hiệu mạnh** (n10) |
| **Inside bar** | cao[n] < cao[n−1] và thấp[n] > thấp[n−1] | Vào theo hướng break khỏi range IB |
| **Doji** | thân ≤ 10% range | Lưỡng lực — không tự vào, chỉ cảnh báo |
| **3 Soldiers/Crows** | 3 nến cùng chiều liên tiếp, thân ≥ 50% range, close lần lượt xa hơn | Tiếp diễn mạnh |
| **Double/Triple top-bottom** | 2–3 pivot trong band ±0.5×ATR, sau pha đẩy đủ mạnh | Đảo chiều — **chờ phá neckline** |
| **Vai đầu vai** | 3 pivot: đầu cao hơn 2 vai ±0.5×ATR, 2 vai trong band | Đảo chiều — **chờ phá neckline** |
| **False break / sweep** | bar xuyên level bằng râu nhưng **đóng cửa quay lại** trong range ±0.3×ATR | Đảo chiều mạnh (giống spring/fakeout VSA) |
| **Measured move** | Sau break mô hình tích lũy → TP = độ cao mô hình (hoặc đoạn đẩy trước đó) | Mục tiêu TP |

### Checklist giao dịch (6 bước — hợp nhất từ n08 + thực hành n10/n12)

1. [ ] Xác định xu hướng khung lớn (H4/H1): HH+HL hay LH+LL hay range.
2. [ ] Xác định level đang hiệu lực (S/R cũ, range biên, supply/demand, mục tiêu mô hình).
3. [ ] Chờ giá **đến** level đó (không đuổi giá).
4. [ ] Chờ cấu hiệu nến xác nhận trên khung nhỏ (M15/M10/M5): pin bar / engulfing / break mẫu hình.
5. [ ] Vào lệnh: SL sau cấu trúc + buffer ATR; TP = vùng đối diện (≥ 1R).
6. [ ] Quản lý: lời ~1R → kéo về hòa vốn; chạm vùng cung/TP → chốt; volume/nến ngược chiều mạnh → thoát.

---

## 4. Nhận xét & phương án tối ưu (trung thực)

### 4.1 Điểm mạnh của phương pháp

- **Đúng bản chất**: S/R = vùng liquidity (stop + limit order xếp hàng) — giải thích "lệnh mập"
  trong video khớp hoàn toàn với liquidity-sweep của repo (`docs/indicator/liquidity/liquidity-sweep.md`).
- **Kỷ luật entry**: 3 yếu tố hội tụ + chờ nến xác nhận = lọc được đa số lệnh xấu. Trader trong
  video tự nhận lỗi đúng chỗ (n12: buy sớm không có tín hiệu rút chân → SL; đây là minh chứng
  phương pháp có thể sai và người dùng tự kiểm được).
- **Quản trị vốn hợp lý** ở mức cảm tính: SL sau cấu trúc, breakeven sớm, RR ≥ 1:1, chốt tại cung.
- **MTF nhất quán**: bối cảnh H4 → setup M15 → trigger M10 — đúng chuẩn hành động giá.

### 4.2 Điểm yếu cần bù khi hệ thống hóa

| # | Điểm yếu trong video | Hệ quả | phương án tối ưu (cho chỉ báo) |
|---|---|---|---|
| 1 | **Không có volume** — mọi xác nhận chỉ bằng giá + nến | Pin bar/engulfing "sống" ở level có absorption thì mạnh; ở level trống thì yếu. Video toàn case thắng (survivorship) | **Ghép VSA**: chỉ tin pin/engulfing khi bar đó có volume bucket High+ (ratio ≥ 1.2) hoặc retest sau cluster tím. Dùng lại `f_vsaColor`/`f_vsaName` từ `pine/shared/common.pine` |
| 2 | **"2 engulfing liên tiếp = winrate cao"** (n10) — cảm tính, không có mẫu số | Dễ thành confirmation bias | Định lượng: đếm tần suất 2-engulfing vs 1-engulfing trên lịch sử (engine `npm run engine:run --method price-action` có sẵn) trước khi tin |
| 3 | **TP cảm tính** ("để tầm dưới này", "kéo tầm R1") | R mỗi lệnh rất khác nhau → không so sánh được, y hệt vấn đề TP-pivot đã đo ở VSA (§5c) | Mặc định **TP theo R cố định** (2R), pivot/measured-move thành tùy chọn — đúng bài học đã đo được |
| 4 | **Không tính phí/slippage** — RR 1:1 với SL ~2$ trên XAU 0.1 lot | Phí + spread giờ Á ăn 0.2–0.5R | Giữ nguyên module `fee_R` + cảnh báo `Phi/R` của `parts-vsa` — XAU spread 0.15–0.35 → cần SL ≥ 1.2 ATR (đã đo ở `vsa-optimization.md` §2.1) |
| 5 | **Không lọc phiên/news** — n12 bị quét lúc "sáng mưa" (tức tin + low liquidity); series có lệnh quanh tin CPI | Vào lệnh giờ chết = spread + slippage | Bật session filter (đã có `f_sessionOk` trong shared) + tránh NFP/CPI ±15 phút (news service repo đã có `services/news`) |
| 6 | **H4 engulfing → "kỳ vọng 3 đáy"** — tiên lượng, không phải phản ứng | Dự đoán cấu trúc thay vì đợi xác nhận | Chỉ vẽ "kỳ vọng" (dotted), tín hiệu phải chờ break/confirm như quy tắc #3 |
| 7 | **Range-bound không có bộ lọc** — video trade luôn cả trong range lẫn trend, SL quét 2 lần trong 1 ngày (n12) | Winrate không ổn định | Thêm regime gate: trend = vào lệnh tiếp diễn theo HH/HL; range = chỉ trade biên, tránh giữa range. Có sẵn module regime ở `parts-tm2/03` để học hỏi |

### 4.3 Thứ tự ưu tiên hệ thống hóa (theo giá trị)

1. **Cấu hình hiệu nến định lượng** (§3 bảng) — nền tảng, không có gì khác chạy được.
2. **Level engine** (pivot ± ATR band, supply/demand, range detection) + **sweep/false-break detector** — chắt lọc phần hay nhất của video (n07) và trùng khớp liquidity-sweep đã có.
3. **MTF trend gate** (H4 HH/HL vs LH/LL) — lọc 50% lệnh sai ngay từ đầu.
4. **Ghép VSA (volume xác nhận)** — điểm yếu lớn nhất của PA thuần, repo đã có sẵn.
5. **SL/TP/breakeven state machine** — học từ `parts-tm2/09`, TP mặc định theo R.
6. **Session + news gate** — chỉ XAU/XAG.
7. **Confluence score** (dashboard 0–3 điểm theo 3 yếu tố n08) — trực quan hóa hội tụ.
8. **Backtest + walk-forward + baseline ngẫu nhiên** — theo đúng D12; **không tối ưu tham số trước khi chứng minh được lợi thế**.

---

## 5. Đặc tả chỉ báo XAU (đề xuất — `parts-xau3/`)

Tên đề xuất: **`TM XAU Price Action`** (target `xau3` + `xau3-strategy` twin, đúng mẫu
`vsa` / `vsa-strategy`).

- **Input nhóm**: MTF (TF bối cảnh/setup/trigger, mặc định H4/M15/M5), cấu hiệu (bật/tắt từng mẫu,
  ngưỡng định lượng §3), level (pivLen, band ATR, lvFresh), SL/TP (slBuf ATR, rr, breakeven tại R),
  phí/session/news (tái dùng input nhóm `TM · Phi & Rui ro` + session shared).
- **Output**: nhãn nến (pin/engulf/IB/3S/3C), nhãn mẫu hình (HH/HL/LH/LL, H&S, DT/DB + neckline
  dashed), vùng S/R (box, auto refresh), vùng sweep (viền), đường Entry/SL/TP + tự đóng (học
  `parts-vsa/40_events`), dashboard: xu hướng H4, level gần nhất + khoảng cách, cấu hiệu gần nhất,
  confluence score 0–3, Phi/R, phiên.
- **Alerts**: `xau.pa.pin`, `xau.pa.engulf`, `xau.pa.pattern` (H&S/DT/DB break), `xau.pa.sweep`,
  `xau.pa.setup` (full hội tụ 3/3 — đây là alert tradeable duy nhất).
- **Strategy twin**: bridge đọc thẳng level do layer tính (mô hình `50_strategy.pine`), vào lệnh
  tại close bar xác nhận, exit = SL/TP setup,-breakeven auto.
- **Không vẽ khi**: ngoài session (nếu bật), `feeOk = false` (dashboard đỏ), bar chưa đóng
  (`tm_confirmOnly` pattern).

> ⚠️ **Chưa có chứng cứ lợi thế** — như `vsa-optimization.md` đã đo: PA/price-based signals ở
> 5m/15m không vượt baseline ngẫu nhiên sau phí. Spec trên là **giả thuyết có cấu trúc** để build
> + backtest, không phải hệ thống đã chứng minh. Bước 8 (§4.3) là cửa ải thật.

---

## 6. Rủi ro & câu hỏi mở

1. **Survivorship nặng** — 2 video live chỉ khoe ngày thắng (+28$, +15.4$); ngày thua không có
   video. Không suy ra được winrate.
2. **Cảm tính trong ngưỡng** — mọi ngưỡng §3 (2× thân, 0.5×ATR…) là chuẩn PA quốc tế, chưa tune
   trên dữ liệu XAU. Phải để mặc định + walk-forward.
3. **"Mập" = narrative** — giải thích đẹp nhưng không kiểm chứng được; giữ ở mức *giả thuyết*
   liquidity (đã có repo `liquidity-sweep.md` để kiểm định).
4. **Whisper lỗi ASR** — thuật ngữ bị sai (engulfing→"anh quốc phiên", SL→"x lờ", TP→"tầm bê",
   pin bar→"náy pin bar", supply→"supp ly", breakout→"phá vỡ"). Transcript gốc giữ nguyên tại
   `logs/nkt/transcripts/`.
5. **9 video mất nội dung** (chỉ nhạc) — nếu bạn có bản gốc có lời, thêm vào sẽ đủ series
   (đặc biệt ngày 1, 2, 7 của "7 ngày" — ngày 2/7 thường là risk/psychology).
6. **Ghép PA + VSA cần tiêu chí rõ** — khi PA nói mua mà VSA nói distribution thì lấy ai?
   Đề xuất: VSA có quyền phủ quyết (force filter), PA chỉ đề xuất. Cần bạn quyết.
