# Bộ lọc OI (Open Interest) — quy trình tìm "hidden gem"

> **Nguồn:** file `BỘ LỌC OI.mkv` (112.6s, 1920×1080, 30fps) trong `D:\Trading\cainghientrading`
> — bản ghi livestream thao tác trên **CoinGlass** (coinglass.com), có webcam góc dưới trái.
>
> **Cách trích xuất:** video **không có track phụ đề**; có một track audio (opus, stereo) là tiếng nói của người
> dẫn livestream, nhưng router AI của project **không có model STT tiếng Việt** nên phần lời **không được phiên
> âm** — toàn bộ nội dung dưới đây được đọc **trực tiếp từ hình** (ffmpeg cắt khung 0/5/12/…/108s, đọc bằng mắt).
> Vì vậy: **mọi thứ trong §2 là đọc được trên màn hình**; **§3–§6 là chuẩn hóa của tôi** để biến thao tác tay
> thành quy trình máy chạy được. Không có câu nào ở đây được gán cho lời nói của tác giả video.
>
> **Mục đích:** chuẩn hóa "bộ lọc OI" thành spec để web-app tự quét và trả về danh sách hidden gem có
> giải thích, thay vì người dùng tự bấm 12 ô filter trên CoinGlass mỗi ngày.

---

## 1. OI là gì và vì sao nó đáng lọc

**Open Interest (hợp đồng mở)** = tổng khối lượng hợp đồng phái sinh **đang còn mở** (chưa đóng, chưa thanh lý),
tính bằng số hợp đồng hoặc quy ra USD. OI **không** phải khối lượng giao dịch: một lệnh khớp làm KL tăng 1,
nhưng OI chỉ tăng khi có **người mở vị thế mới**; đóng vị thế thì OI giảm.

Vì thế OI là **thứ duy nhất đo được "tiền mới vào hay tiền cũ thoát ra"**, còn giá chỉ đo kết quả:

| Giá | OI | Cách đọc chuẩn | Ý nghĩa thực chiến |
|---|---|---|---|
| ↑ | ↑ | Long mới mở | Xu hướng được xác nhận bằng tiền mới, nhưng đang đông dần |
| ↓ | ↑ | Short mới mở | Đà giảm được xác nhận, dễ có short squeeze nếu có xúc tác |
| ↑ | ↓ | Short đóng (short covering) | Rally **thiếu nền**, dễ tắt khi hết lực cover |
| ↓ | ↓ | Long bị thanh lý / chốt | Xả hàng; thường là cuối sóng giảm, không phải chỗ mua |

Góc thứ hai là **OI so với quy mô thật của tài sản**:

- **OI/Vốn hóa (OI/MCap)** — đo đòn bẩy của thị trường phái sinh so với spot. `> 1` nghĩa là khối lượng hợp
  đồng đang mở **lớn hơn cả vốn hóa spot** → biến động rất dữ, squeeze được **cả hai chiều**.
- **OI/Khối lượng 24h** — đo mức "quay vòng" vị thế; thấp = vị thế nằm lì, cao = scalp liên tục.
- **Tỷ lệ Long/Short (tài khoản)** và **Trader hàng đầu L/S** — retail so với tay to. Lệch nhau là thông tin,
  không phải tín hiệu mua bán.

Điểm cốt lõi của cả tài liệu này: **hidden gem không phải coin đang tăng mạnh, mà là coin có OI phình ra
trong khi giá còn nén** — tiền mới đã vào, giá chưa trả lời. Khi giá trả lời thì biên độ thường rất lớn vì
hai bên đang chồng vị thế.

---

## 2. Những gì video thực sự hiển thị

### 2.1 Thanh "Bộ lọc" của CoinGlass — toàn bộ nhóm trường

Mở từ nút `Bộ lọc` cạnh `Tùy chỉnh` ở bảng "Phân tích dữ liệu tài sản toàn cầu". Modal có 5 nhóm, mỗi trường
có nút `+` để chọn toán tử và ngưỡng, cuối modal là `Tạo` / `Xóa bộ lọc` / `Đóng` / `Áp dụng bộ lọc`.

| Nhóm | Trường | Đơn vị / kỳ hạn | Trả lời câu hỏi gì |
|---|---|---|---|
| Giá | Giá, **Giá (24h%)** | USD, % | Đã chạy rồi hay chưa |
| Vốn hóa | Vốn hóa thị trường, **OI/Vốn hóa thị trường** | USD, tỉ lệ | Còn nhỏ không; đòn bẩy phái sinh cao không |
| RSI | RSI (15 phút, 1h, 4h, 12h, 1 ngày, 1 tuần) | 0–100 | Quá mua/quá bán đa khung |
| **Hợp đồng mở** | Tỷ lệ funding | %/8h | Đang trả phí cho bên nào |
| | **OI** | USD | Quy mô tuyệt đối của thị trường phái sinh |
| | **Thay đổi OI (5p, 15p, 30p, 1h, 4h, 24h, 3 ngày, 7 ngày, 30 ngày)** | % | Tốc độ tiền mới vào |
| | **OI Chg (3 ngày,$), (7 ngày,$), (30 ngày,$)** | USD | Tiền mới vào **tuyệt đối** |
| | OI/24h_Vol (1h%), (4h%), (24h%) | tỉ lệ | Vị thế nằm lì hay quay vòng |
| | **Mức độ tập trung vị thế** | chỉ số | Vị thế dồn một cửa hay rải đều |
| Khối lượng | Khối lượng (5p, 15p, 30p, 1h, 4h, 12h, 24h), (1h%), (12h%), (24h%) | USD, % | Có dòng tiền giao dịch đi kèm không |
| Thay đổi giá | Thay đổi giá (5p, 15p, 30p, 1h, 4h, 24h, 3 ngày, 7 ngày, 30 ngày) | % | Xác nhận / lọc nhiễu |
| Khối lượng giao dịch (phụ) | Thanh lý, **Chỉ số mùa Altcoin**, Binance Tỉ lệ Long/Short (Tài khoản), Tỷ lệ Long/Short của Trader hàng đầu Binance (Tài khoản), OI Chg (24h,$) | — | Bối cảnh thị trường & vị thế hai phe |

Hai **preset** nhìn thấy rõ trong modal (chọn nhanh thay vì gõ số):

- `OI`: **"$5M - Giá trị lớn nhất"** — sàn OI tối thiểu $5M, sắp xếp giảm dần. Đây là **bộ lọc thanh khoản**:
  loại coin có OI quá nhỏ (vào lệnh là trượt giá).
- `OI/Vốn hóa thị trường`: **"0.6 - Giá trị lớn nhất"** — chỉ lấy coin có OI/MCap ≥ 0.6, xếp giảm dần.
  Đây chính là **bộ lọc "đòn bẩy phái sinh cao"** — mầm của squeeze.

### 2.2 Bảng kết quả (13 cột) và ảnh chụp màn hình

Cột của bảng sau khi áp filter (`Tất cả` / `Crypto` / `TradFi` / `Giao ngay` / `Phân mục` / …):

`Xếp hạng · Tài sản · Giá · Giá(24h%) · Khối lượng (24h) · Khối lượng (24h%) · OI (24h%) · OI/Vốn hóa thị trường ·
Vốn hóa thị trường · OI · L/S (Tài khoản) · Trader hàng đầu L/S (Tài khoản) · OI Chg (24h,$)`

Ảnh chụp tại **giây 108** (đọc từ hình, ticker có thể sai do nén — dùng để hiệu chuẩn *hình dạng số liệu*, không
phải để chép số):

| Tài sản | Giá | Giá 24h% | KL 24h | KL 24h% | OI 24h% | OI/MCap | MCap | OI | L/S | Top L/S |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FARTCOIN | 0.1667 | −13.05% | 150.36M | +79.18% | **−8.37%** | 0.7076 | 166.53M | 117.84M | 1.361 | 1.822 |
| MUBARAK | 0.06066 | +9.41% | 169.91M | +33.29% | **+9.14%** | 0.7863 | 60.50M | 47.57M | 1.137 | 1.374 |
| US | 0.027313 | −6.94% | 61.57M | −66.25% | −13.68% | 0.6288 | 58.89M | 37.03M | 1.402 | 1.446 |
| NIL | 0.08542 | −17.69% | 63.15M | −44.39% | −28.67% | 0.7510 | 43.32M | 32.54M | **0.566** | 0.833 |
| ONE | 0.0024223 | +12.47% | 263.57M | +204.70% | +10.15% | 0.8220 | 37.45M | 30.78M | 1.140 | 1.264 |
| SAGA | 0.02673 | +3.05% | 118.28M | −24.22% | −3.12% | **1.9030** | 11.84M | 22.53M | 1.377 | 1.846 |

Ba điều đáng chú ý ngay từ ảnh chụp:

1. **SAGA**: OI $22.53M **lớn hơn** vốn hóa $11.84M (OI/MCap 1.90) — phái sinh đang gấp đôi spot. Đây là
   dạng *hidden gem có điều kiện*: chỉ cần một xúc tác là chạy rất mạnh, nhưng chạy được **cả hai chiều**.
2. **ONE**: KL 24h +204%, giá +12%, OI chỉ +10% → dòng tiền là **spot/đầu cơ ngắn**, không phải tiền mới vào
   phái sinh. Không phải coil.
3. **NIL**: L/S tài khoản 0.566 (retail nghiêng short) trong khi top trader 0.833 — cả hai phe đều nghiêng
   short; giá −17%, OI −28% = đang xả, không phải tích lũy.

### 2.3 Bối cảnh toàn thị trường (giây 0 — dùng làm cổng lọc vĩ mô)

`Khối lượng 24h $210.95B` · `Hợp đồng mở $150.20B (−1.88%)` · `Thanh lý 24h $481.74M` · `Long/Short 24h 47.57% / 52.43%` ·
`RSI trung bình 40.06` · `Chỉ số mùa Altcoin 70 (Trung lập)`.

Quy tắc rút ra: **khi OI toàn thị trường đang giảm** thì một coin có ΔOI dương là **dòng tiền đang chuyển vào
chỗ đó**, đáng chú ý hơn nhiều so với khi cả thị trường cùng bơm.

---

## 3. Ba hồ sơ cần lọc (chuẩn hóa)

### 3.1 Hồ sơ A — `COIL` (hidden gem thật): OI phình, giá nén

Điều kiện **đồng thời**, xét trên khung 24h và 4h:

| # | Điều kiện | Ngưỡng đề xuất | Lý do |
|---|---|---:|---|
| A1 | OI tối thiểu (thanh khoản) | `OI ≥ $5M` | preset `$5M` của video; dưới mức này trượt giá giết lợi thế |
| A2 | OI tăng | `ΔOI 24h ≥ +15%` và `ΔOI 4h ≥ +3%` | tiền mới vào **và** còn đang vào, không phải đã xong |
| A3 | Giá nén | `|Δgiá 24h| ≤ 5%` | chưa trả lời → còn cửa vào |
| A4 | Khối lượng xác nhận | `ΔKL 24h ≥ +20%` | có giao dịch thật, không phải OI ảo |
| A5 | Vốn hóa còn nhỏ | `MCap ≤ $300M` | "gem" nằm ở đây; trên nữa là mid-cap |
| A6 | Đòn bẩy phái sinh | `0.3 ≤ OI/MCap ≤ 1.0` | đủ mỏng để dễ chạy, chưa đến mức chỉ còn squeeze |
| A7 | Funding không cực đoan | `|funding| ≤ 0.05%` | tránh mua đúng đỉnh đám đông đang trả phí |

### 3.2 Hồ sơ B — `SQUEEZE`: đòn bẩy cao, hai phe lệch

| # | Điều kiện | Ngưỡng |
|---|---|---:|
| B1 | OI/MCap | `≥ 1.0` (preset `0.6` là sàn, `1.0` là vùng báo động) |
| B2 | Lệch phe | `L/S tài khoản ≥ 1.5` **hoặc** `≤ 0.7`, và `top L/S` lệch **ngược** chiều retail |
| B3 | Funding cực đoan | `|funding| ≥ 0.08%` |
| B4 | OI tăng nhanh | `ΔOI 4h ≥ +8%` |

Hồ sơ B **không phải điểm mua**. Nó là danh sách "sắp có biến" — dùng để đặt cảnh báo giá/thanh lý, không
dùng để vào lệnh theo hướng đám đông (đúng nguyên tắc "không mua/bán token đang được nhắc trong phiên live"
mà chính tác giả ghim trên màn hình).

### 3.3 Hồ sơ C — `DISTRIBUTION`: loại khỏi kết quả

Bất kỳ điều kiện nào sau đây → **loại**, không cần chấm điểm:

- `ΔOI 24h ≤ −15%` và `Δgiá 24h ≤ −5%` → xả hàng / long bị thanh lý.
- `ΔKL 24h ≤ −30%` → hết dòng tiền, OI tăng chỉ là vị thế cũ treo.
- Token niêm yết < 30 ngày **và** `MCap < $20M` → OI nhiễu do market maker mới lập sổ.
- `OI/MCap ≥ 2.5` **và** `funding ≥ 0.15%` → đã quá đà, rủi ro squeeze ngược.

---

## 4. Chấm điểm 0–100 (bắt buộc để AI trả lời nhất quán)

Điểm chỉ dùng cho hồ sơ A; B dùng danh sách riêng; C bị loại trước khi chấm.

| Thành phần | Điểm tối đa | Công thức |
|---|---:|---|
| OI expansion 24h | 25 | 25 nếu `+25%…+60%`; 18 nếu `+15…25%`; 10 nếu `> 60%` (đã quá nóng); 0 nếu `< +15%` |
| OI expansion 4h | 15 | 15 nếu `+3…+15%`; 8 nếu `> 15%`; 0 nếu `< +3%` |
| Giá nén | 20 | 20 nếu `|Δgiá 24h| ≤ 3%`; 12 nếu `≤ 5%`; 0 nếu `> 5%` |
| KL xác nhận | 15 | 15 nếu `ΔKL ≥ +50%`; 10 nếu `+20…50%`; 0 nếu `< +20%` |
| OI/MCap hợp lý | 10 | 10 nếu `0.4–0.8`; 6 nếu `0.3–0.4` hoặc `0.8–1.0`; 0 ngoài khoảng |
| Vốn hóa nhỏ | 8 | 8 nếu `≤ $50M`; 6 nếu `≤ $150M`; 3 nếu `≤ $300M` |
| Funding trung tính | 7 | 7 nếu `|funding| ≤ 0.02%`; 4 nếu `≤ 0.05%`; 0 nếu hơn |

**Phạt (trừ thẳng vào điểm):** OI tăng nhưng giá giảm > 8% → −15; KL 24h < $10M → −20; `OI/MCap > 1.5` → −10;
vị thế tập trung cao (Mức độ tập trung vị thế ở mức cao nhất) → −5.

**Phân hạng:** `≥ 70` = ứng viên hidden gem (đưa vào báo cáo); `50–69` = watchlist (chỉ ghi nhận, không báo
động); `< 50` = bỏ. Không bao giờ trả về quá **5** ứng viên một lần quét — nếu nhiều hơn thì chứng tỏ ngưỡng
đang quá lỏng, siết lại chứ không xả danh sách dài.

---

## 5. Luồng tự quét

### 5.1 Nguồn dữ liệu

**Ưu tiên 1 — CoinGlass API v4** (đúng nguồn của video, tổng hợp đa sàn). Base URL và các endpoint cần dùng
(đã đối chiếu trang Endpoint Overview chính thức):

| Bước | Endpoint | Dùng để lấy |
|---|---|---|
| Universe | `GET /api/futures/coins-markets` | Giá, KL 24h, OI, OI 24h%, OI/MCap, MCap, L/S — **một call cho toàn bộ coin** |
| Biến động ngắn | `GET /api/futures/coins-price-change` | Bảng "Top tăng giá 5p/30p/4h" |
| Chuỗi OI | `GET /api/futures/open-interest/aggregated-history` | ΔOI theo giờ (tính ΔOI 4h/24h/3 ngày) |
| Chuỗi OI theo sàn | `GET /api/futures/open-interest/exchange-history-chart` | OI đang dồn ở sàn nào |
| Funding | `GET /api/futures/funding-rate/exchange-list`, `/api/futures/funding-rate/history` | Funding hiện tại + lịch sử |
| Long/Short | `GET /api/futures/global-long-short-account-ratio/history`, `/api/futures/top-long-short-account-ratio/history`, `/api/futures/top-long-short-position-ratio/history` | Retail vs tay to |
| Thanh lý | `GET /api/futures/liquidation/coin-list`, `/api/futures/liquidation/aggregated-history` | Xác nhận squeeze / xả |
| Dòng tiền | `GET /api/futures/netflow-list` | Tiền vào/ra ròng (kiểm tra chéo OI) |

Lưu ý vận hành: gói API có giới hạn request/phút — **luôn** lấy `coins-markets` một lần rồi mới gọi per-coin
cho top N (N ≤ 30), cache 60s, và một hàng đợi tuần tự thay vì `Promise.all` ào ạt.

**Ưu tiên 2 — Binance Futures (miễn phí, dự phòng).** Repo đã có sẵn primitive trong `services/binance.mjs`:
`ticker24h()` (`/fapi/v1/ticker/24hr`), `openInterest(symbol)` (`/fapi/v1/openInterest`), `premiumIndex()`
(`/fapi/v1/premiumIndex`), `klinesRaw()`, và `services/liquidation.mjs` đã dùng
`/futures/data/globalLongShortAccountRatio`.

Giới hạn phải nhớ: **endpoint lịch sử OI của Binance đã bị gỡ** (ghi chú sẵn trong `services/liquidation.mjs`:
`openInterestHist` trả 404). Nghĩa là với Binance, ΔOI **không lấy được từ API** mà phải **tự dựng chuỗi**:
poll `openInterest()` cho toàn universe mỗi 5 phút và ghi vào store. Sau 4h có ΔOI 4h, sau 24h có ΔOI 24h —
tức hệ thống cần **chạy liên tục 1 ngày trước khi có kết quả đầu tiên**. Đây là lý do CoinGlass vẫn là ưu tiên 1.

### 5.2 Pipeline 6 bước

```
B1  UNIVERSE   coins-markets (1 call)  → lọc cứng: OI ≥ $5M, KL24h ≥ $10M, MCap ≤ $300M
B2  PRE-SCORE  tính ΔOI 24h/4h từ chuỗi OI → giữ top 30 theo (ΔOI 24h × log(KL))
B3  CONTEXT    funding + L/S retail + L/S top + thanh lý 24h + netflow (song song, có cache)
B4  PRICE      price/history 1h → |Δgiá 24h|, ATR nén, khoảng cách tới đỉnh 7 ngày
B5  SCORE      áp §4 (kể cả phạt) → lọc DISTRIBUTION (§3.3) → tier
B6  PUBLISH    store + dedupe + alert; giao diện đọc từ store, AI chỉ đọc output đã chấm
```

Nguyên tắc: **AI không tự bịa số** — mọi con số trong câu trả lời phải đến từ object ở §6, và object đó chỉ
chứa số lấy từ B1–B5. Nếu một trường thiếu (ví dụ funding không có cho coin đó) thì trường đó là `null` và
câu trả lời phải nói "thiếu dữ liệu", không được suy ra.

**Nhịp chạy:** B1 mỗi 5 phút; B2–B4 mỗi 15 phút; B5–B6 mỗi 15 phút; tổng hợp ngày 1 lần 08:00. Không quét
lại toàn bộ universe mỗi phút — không cần, và sẽ đốt rate limit.

---

## 6. Hợp đồng output cho AI

Mỗi ứng viên là **một object JSON** (đây là thứ duy nhất AI được đọc để trả lời):

```json
{
  "asOf": "2026-10-31T09:30:00Z",
  "profile": "COIL",
  "symbol": "MUBARAK",
  "score": 78,
  "tier": "CANDIDATE",
  "metrics": {
    "price": 0.06066, "chg24hPct": 9.41,
    "oiUsd": 47570000, "oiChg24hPct": 9.14, "oiChg4hPct": 4.2,
    "vol24hUsd": 169910000, "volChg24hPct": 33.29,
    "mcapUsd": 60500000, "oiOverMcap": 0.786,
    "fundingPct": 0.012, "lsAccount": 1.137, "lsTopTrader": 1.374,
    "liq24hUsd": null
  },
  "signals": ["oi_up_price_flat", "volume_confirm", "small_cap", "funding_neutral"],
  "antiSignals": ["ls_retail_and_top_aligned_long"],
  "why": "OI +9.1% trong 24h và +4.2% trong 4h, giá chỉ +9.4% với KL +33%; OI/MCap 0.79 — tiền mới vào phái sinh nhưng chưa có cú bung.",
  "risks": ["Thanh khoản tập trung ở một sàn", "Điểm dữ liệu 15 phút, có thể trễ so với giá spot"],
  "sources": ["coinglass:/api/futures/coins-markets", "coinglass:/api/futures/open-interest/aggregated-history"]
}
```

Quy tắc trình bày cho AI (dán vào system prompt của agent quét):

1. Chỉ nói về coin có `tier = CANDIDATE`; `WATCHLIST` chỉ liệt kê tối đa 5 cái, không giải thích dài.
2. Mỗi coin **bắt buộc** nêu: `oiChg24hPct`, `oiOverMcap`, `chg24hPct`, `fundingPct`, `score`. Thiếu trường → nói thiếu.
3. Luôn nêu `asOf` và cảnh báo nếu dữ liệu cũ hơn 20 phút.
4. Không dùng từ "chắc chắn", "sắp x2", "all in"; không đưa mức entry/SL/TP trừ khi người dùng yêu cầu riêng.
5. Kết thúc mọi báo cáo bằng một dòng: *"Dữ liệu phái sinh, không phải lời khuyên đầu tư."*
6. Nếu người dùng hỏi "nên mua không" → trả lời bằng ba kịch bản (coil bung lên / xả xuống / đi ngang) kèm
   mức giá vô hiệu hóa kịch bản, không trả lời có/không.

---

## 7. Bẫy và giới hạn (đọc trước khi tin kết quả)

| # | Bẫy | Cách chặn |
|:--:|---|---|
| 1 | **OI tăng do wash trading / market maker dựng sổ** trên coin mới | Loại token < 30 ngày hoặc MCap < $20M; kiểm tra chéo netflow |
| 2 | **OI tăng nhưng giá đã chạy 30–50%** | Điều kiện A3 `|Δgiá| ≤ 5%` — nếu đã chạy thì đã hết cửa |
| 3 | **OI/MCap > 2** — không còn là gem mà là bãi mìn hai chiều | Phạt −10 và chuyển sang hồ sơ B |
| 4 | **Dữ liệu lệch giữa các sàn** (CoinGlass tổng hợp; Binance riêng) | Ghi rõ nguồn trong `sources`; không trộn hai nguồn trong một câu |
| 5 | **Độ trễ**: OI 24h là số đã đóng, không phải realtime | `asOf` bắt buộc; cảnh báo khi > 20 phút |
| 6 | **Survivorship**: chỉ thấy coin còn sống trên sàn | Không suy ra hit-rate từ danh sách này; muốn có hit-rate phải log lại mỗi lần quét rồi đối chiếu giá 7 ngày sau |
| 7 | **Funding đổi liên tục** (mỗi 8h) | Snapshot funding theo giờ, so sánh với funding trung bình 3 ngày |
| 8 | **Thanh khoản sổ lệnh ≠ OI** | OI $50M không có nghĩa trượt giá thấp; cần kiểm tra độ sâu sổ lệnh trước khi nói "vào được" |

---

## 8. Ánh xạ vào repo

| Hạng mục | Đề xuất |
|---|---|
| Service quét | services/oiScan.mjs (mới), cùng khuôn `runScanner` của `services/scanner.mjs` (fail-soft, trả object, không tự gửi Telegram) |
| Nguồn dữ liệu | Chuẩn hóa qua `services/binance.mjs` cho Binance; thêm adapter CoinGlass dùng chung interface `{ universe(), oiHistory(), funding(), longShort() }` |
| Lưu trữ | `services/store.mjs` — một snapshot/15 phút, giữ 30 ngày để tính hit-rate 7 ngày ở bẫy #6 |
| Chấm điểm | Hàm thuần `scoreCoil(metrics)` → `{ score, signals, antiSignals, why }`; **thuần**, không I/O, để test được |
| API | Route đọc snapshot trong server hiện có; không gọi CoinGlass từ trình duyệt (giấu API key) |
| UI | Trang "Screener OI" trong dashboard: bảng 8 cột + badge tier; theo `docs/web-app/ui-design-system.md` |
| Alert | Chỉ bắn khi `tier = CANDIDATE` **và** coin chưa có trong 24h gần nhất (dedupe) |
| Test | Thêm case vào `npm run test:services`: OI/MCap biên (0.29/0.30/1.0/1.01), ΔOI âm, thiếu funding (null), coin mới < 30 ngày |

Điều kiện tiên quyết: **chốt nguồn dữ liệu** (CoinGlass gói trả phí hay Binance tự dựng chuỗi) — quyết định này
đổi toàn bộ §5.2 và thời gian có kết quả đầu tiên (tức thì vs 24h).

---

## 9. Nghiệm thu

```bash
npm run test:services     # case biên của scoreCoil + adapter
npm run docs:check        # tài liệu ↔ đường dẫn/script thật
npm run verify            # gate toàn diện
```

Kiểm tra thủ công:

1. Áp lại đúng bộ lọc của video trên CoinGlass (`OI ≥ $5M` + `OI/MCap ≥ 0.6`) → đối chiếu số của tool với
   web: lệch > 2% ở `OI` hoặc `ΔOI 24h` là sai đơn vị/độ trễ.
2. Chạy 1 lần quét → phải ra **≤ 5** ứng viên; nếu 0 ứng viên thì ghi log lý do loại từng coin (để biết ngưỡng
   có quá chặt không).
3. Cho ăn một object có `fundingPct = null` → AI phải nói "thiếu dữ liệu", không được bịa số.
4. Cho ăn object có `asOf` cũ 2 giờ → AI phải cảnh báo dữ liệu cũ.
5. Đối chiếu 7 ngày sau: log lại danh sách hôm nay, đo `Δgiá 7 ngày` của từng ứng viên → có hit-rate thật
   thay vì tin vào cảm giác.
