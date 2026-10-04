# TM Trading

**Ứng dụng trade desk tự động**: engine tín hiệu + backtest chạy local, store MongoDB,
dashboard Nuxt, **risk gate** và execution (paper → MT5/exchange).

Bộ chỉ báo TradingView (Pine Script **v6**) là **công cụ hỗ trợ** — nguồn tín hiệu và
đối chiếu tay — **không phải sản phẩm chính**. Định hướng đầy đủ: `docs/roadmap.md`.

```
tm-trading/
├─ docs/
│  ├─ roadmap.md           kế hoạch tổng thể 13 phase + quyết định nền tảng (D1–D14)
│  ├─ data-model.md        schema/index/version của mọi collection  (Phase 3)
│  ├─ app-inheritance.md   kế thừa app/ từ tm-hub: giữ/cắt gì + bẫy môi trường
│  ├─ architecture.md      kiến trúc, luồng dữ liệu, quy ước mở rộng
│  ├─ vsa-wyckoff-method.md  spec phương pháp VSA/Wyckoff (spec của engine)
│  ├─ time-rules.md        hợp đồng thời gian D2 (UTC ms, ngày UTC, tz tường minh)
│  ├─ mt5-ipc.md           hợp đồng IPC bridge MT5 (Phase 12, chốt sớm)
│  └─ alert-schema.md      đặc tả payload JSON + luật bump `v`
├─ pine/                   ← CÔNG CỤ HỖ TRỢ (không phải sản phẩm)
│  ├─ parts/*.pine         ← SỬA Ở ĐÂY (nguồn duy nhất — TM Signals/Backtest)
│  ├─ parts-vsa/*.pine     ← nguồn bộ TM VSA Wyckoff + TM VSA Backtest
│  ├─ shared/*.pine        ← hàm dùng chung mọi target (f_sessionOk, f_vsaColor, ...)
│  └─ dist/*.pine          ← output, dán vào TradingView
├─ server/
│  └─ webhook.mjs          webhook receiver (Telegram / Discord)
├─ engine/                 ← BACKBONE: tín hiệu + backtest (Phase 2–5)
├─ exec/                   ← risk gate + paper/real execution (Phase 6+)
├─ services/               ← market intelligence + heartbeat (Phase 8+)
├─ app/                    ← UI Nuxt dashboard (Phase 7+)
├─ ai/                     ← AI copilot (Phase 11+)
├─ data/                   ← cache dữ liệu (không commit)
├─ reports/                ← báo cáo xuất ra (không commit)
├─ tools/
│  ├─ build.mjs            ghép parts + shared → dist + lint
│  ├─ copy.mjs             copy dist vào clipboard
│  └─ smoke.mjs            test không cần framework
└─ package.json
```

## 1. Cài đặt & chạy

Cần **Node.js ≥ 18**. Repo có dependency (Mongoose + bộ Nuxt kế thừa từ `tm-hub`) nên phải
`npm install` trước. **Pine tooling và engine core vẫn zero-dep** — `npm run build`,
`npm run test:pines`, `npm run test:engine` chạy được kể cả khi chưa cài đủ gói UI.

```bash
npm install            # Mongoose + Nuxt UI (cache trong workspace qua .npmrc)
npm run build          # ghép pine/parts* + pine/shared -> pine/dist
npm test               # smoke (173) + engine (176) + db (49, tự SKIP nếu không có Mongo)
npm run verify         # build + test
npm run dev            # dashboard Nuxt -> http://localhost:4001/
```

> **Lưu ý chạy `npm run dev`:** Nitro cần spawn tiến trình con cho dev worker. Trong môi trường bị
> sandbox chặn spawn, phải chạy với quyền rộng hơn, nếu không sẽ gặp `[nitro] ERROR Error: spawn EPERM`.
> Dev server bind IPv6 → dùng `http://localhost:4001/`, **không** dùng `127.0.0.1`.

| Script | Việc |
|---|---|
| `npm run build` | Build cả **4** bản (indicator + strategy + VSA + VSA backtest) |
| `npm run watch` | Tự build lại mỗi khi `pine/parts*/` hoặc `pine/shared/` đổi |
| `npm run signal` | Chỉ build bản indicator |
| `npm run backtest` | Chỉ build bản strategy |
| `npm run vsa` | Chỉ build bản TM VSA Wyckoff |
| `npm run vsa:backtest` | Chỉ build bản TM VSA Backtest |
| `npm run copy` | Build rồi copy `TM Signals BTC.pine` vào clipboard |
| `npm run copy:backtest` | Copy `TM Backtest BTC.pine` vào clipboard |
| `npm run copy:vsa` | Copy `TM VSA Wyckoff.pine` vào clipboard |
| `npm run copy:vsa:backtest` | Copy `TM VSA Backtest.pine` vào clipboard |
| `npm run notify` | Chạy webhook receiver |
| `npm test` | `test:pines` + `test:engine` + `test:db` |
| `npm run test:pines` | Smoke test Pine + webhook (173 assertion) |
| `npm run test:engine` | Golden fixtures + hợp đồng plugin + backtest + report + data + CLI (360 assertion) |
| `npm run test:db` | Schema/index/dedupe trên MongoDB thật (49 assertion) |
| `npm run engine:run` | CLI backtest → CSV + bảng symbol × TF (`--help` để xem lựa chọn) |
| `npm run errors` | Dịch lỗi TradingView về đúng dòng trong `pine/parts*/` |
| `npm run verify` | `build` + `test` |
| `npm run clean` | Xoá `pine/dist/` và `logs/` |

> `npm run build` trả exit code **2** nếu có cảnh báo lint — dùng được trong CI.

Pine không có `#include`, nên logic được viết tách file ở `pine/parts/` (bản TM),
`pine/parts-vsa/` (bản TM VSA Wyckoff + TM VSA Backtest — **chung một nguồn**) và hàm chung ở
`pine/shared/`; `build.mjs` ghép lại thành một script duy nhất. **Đừng sửa trực tiếp trong `pine/dist/`.**

> Bản `TM VSA Backtest` là **strategy twin** của `TM VSA Wyckoff`: cùng `parts-vsa`, chỉ khác
> khai báo `strategy(...)`; phần vẽ bị cắt bằng marker `@part skip:vsa-strategy`, cầu nối lệnh ở
> `pine/parts-vsa/50_strategy.pine`. Vì dùng chung `20_volume/30_levels/40_events`, **logic sự kiện
> không thể lệch** — smoke test so sánh trực tiếp hai file dist để bắt lệch.

## 2. Cài lên TradingView

Cách nhanh nhất:

```bash
npm run copy        # build + copy san vao clipboard
```

Rồi mở Pine Editor → `Ctrl+V` → **Add to chart**.

Cách thủ công: dán toàn bộ nội dung `pine/dist/TM Signals BTC.pine`.
`pine/dist/TM Backtest BTC.pine` dán tương tự, mở tab **Strategy Tester** để xem winrate/RR.

Tạo alert: chọn đúng indicator → **Create Alert** → Webhook URL
`https://<domain-cua-ban>/tm-alert`, header `User-Agent: TradingView`.

### Lỗi compile hay gặp

| Mã | Nguyên nhân |
|---|---|
| `CE10271 Could not find function` | Gọi hàm Pine không tồn tại. Gặp hai lần: **`input.timezone()` không có trong Pine** — dùng `input.string()` với danh sách múi giờ (`pine/parts/10_config.pine`); và **`table.cell_clear()` không có** — tên đúng là **`table.clear(table_id, start_col, start_row, end_col, end_row)`** (`pine/parts/60_viz.pine`) |
| `CE10156 Syntax error at "]"` | Biểu thức `input.*` bị **tách nhiều dòng**. Pine cần `options` là `const string[]`; tách dòng làm parser hỏng. Giữ mỗi lệnh `input.*` trên một dòng |
| `CE10123` `expected a "simple int"` | Truyền biến **float** vào tham số *độ dài* của hàm `ta.*`. Ví dụ `ta.supertrend(factor, atrPeriod)` — `atrPeriod` phải là số nguyên, không phải `ta.atr(...)`. Tách `tm_atr` (float, cho SL) và `tm_atrST` (int, cho supertrend) |
| `CE10120` `does not have an argument with the name` | Sai **tên** tham số. Thường gặp: `table.new()` **không có** tham số `size` — cỡ bảng nằm ở `text_size` của từng `table.cell()` |
| `CE10123` `"literal string" ... but a "series int" is expected` | Sai **thứ tự** tham số. Đúng là **`str.format_time(time, format, timezone)`** — `time` (UNIX timestamp, `series int`) đứng đầu, `format` đứng sau. Viết `str.format_time("yyyy-MM-dd", time, "UTC")` là lỗi. (Nguồn: [Concepts / Time](https://www.tradingview.com/pine-script-docs/concepts/time/)) |
| `CE10271` ở `plotshape`/`plot` | Truyền tham số theo thứ tự làm giá trị rơi vào `offset` (vị trí 6). Luôn truyền bằng **tên tham số** |

`build.mjs` đã có lint tự bắt cả sáu loại lỗi này — chạy `npm run build` sẽ báo trước khi bạn dán lên TradingView.

**Khi TradingView vẫn báo lỗi**, nó chỉ ghi `line N` trên *file dist* — không biết lỗi ở part nào. Dán nguyên văn thông báo vào một file rồi:

```bash
node tools/errors.mjs loi.txt              # line N (dist) → pine/parts/<file>:<dong> + đoạn mã
node tools/errors.mjs loi.txt --apply      # ghi đoạn mã vào tools/bad-snippets.json
node tools/errors.mjs loi.txt --target strategy
```

`--apply` ghi nhận **lỗi thật đã gặp**; `npm test` sẽ kiểm tra mọi mục trong
`tools/bad-snippets.json` không quay lại — đó là vòng kiểm tra hai chiều còn thiếu
của lint (trước đây test chỉ khẳng định rule *tự viết* là đúng).

> **Nguồn chân lý của lint: `tools/pine-ref.json` (sinh bằng `npm run ref`).**
> `BUILTINS`, danh sách từ khóa, tên/thứ tự tham số, tham số cần `int` và tham số
> đầu phải là UNIX time **đều được derive** từ file đó — không còn danh sách tay
> trong `build.mjs`. Nguồn là [folknor/pine-tools](https://github.com/folknor/pine-tools)
> (dữ liệu lấy từ tài liệu chính thức TradingView), đã đối chiếu với
> [codenamedevan/pinescriptv6](https://github.com/codenamedevan/pinescriptv6).
>
> - **Muốn thêm/sửa tham chiếu?** `npm run ref` rồi `npm run verify`. Không sửa tay
>   `build.mjs` — đó chính là lý do trước đây lint bị viết ngược 4 lần
>   (`table.cell_clear`, `str.format_time`, `POSITIONAL_RISK`, `FAKE_NAMES`).
> - **Tên sai** (không có trong Pine v6) nằm trong `FAKE_NAMES` của
>   `tools/smoke.mjs`; test khẳng định mọi tên trong đó **không** có trong ref nên
>   không thể "ngủ quên" quay lại danh sách hợp lệ.
> - **Luật `int` chỉ bắt float chắc chắn** (số thập phân, biến gán từ hàm trả
>   `float`) — không bắt "chưa chứng minh được là int", để tránh false positive do
>   thứ tự tham số của các hàm nhiều overload (`box.new`, `line.new`).

### Chế độ repaint

| Input | Hành vi |
|---|---|
| `Chỉ tín hiệu trên nến đã đóng` = **BẬT** (mặc định) | Chỉ phát khi nến đóng. Không repait, dùng cho live |
| = **TẮT** | Phát ngay trên nến đang chạy, marker nhạt màu. Chỉ để quan sát/scan |

Khi đang ở chế độ nến đóng, nhớ chọn tần suất alert là **Once Per Bar Close**.

## 3. Tín hiệu

5 module, mỗi module trả điểm `[-1, +1]`, tổng hợp có trọng số rồi so với ngưỡng confidence:

| Module | Nguyên lý |
|---|---|
| M1 Trend flip | Supertrend lật hướng |
| M2 RSI divergence | Phân kỳ RSI tại hai pivot gần nhất |
| M3 Bollinger reversion | Chạm band ngoài rồi đóng ngược lại |
| M4 Price action | Engulfing + pin bar |
| M5 EMA cross | EMA nhanh cắt EMA chậm |

Bộ lọc: xu hướng timeframe cao, phiên giao dịch, biến động tối thiểu, số lệnh/ngày,
khoảng cách nến giữa hai lệnh, RR tối thiểu.

## 4. TP / SL

SL = trộn giữa **swing structure** và **ATR**, sau đó kẹp trong khoảng `[minATR, maxATR]`.
TP chia thang R (`TP1 / TP2 / TP3`), kèm **breakeven** và **trailing stop**.
Chuyển `Cách tinh TP` sang `Simple` nếu chỉ cần 1 mục tiêu.

Ghi chú: khi một nến chạm cả TP lẫn SL, engine giả định **SL xảy ra trước** — thi lanh,
vì OHLC không cho biết thứ tự high/low.

## 5. Webhook

```bash
cp .env.example .env      # điền TM_TOKEN / TELEGRAM_TOKEN / TELEGRAM_CHAT_ID / DISCORD_WEBHOOK
npm run notify
```

**Bắt buộc: token trong URL.** TradingView chỉ gửi được URL + JSON body, không gửi
được header tùy ý, nên `TM_TOKEN` phải nằm trong URL khi tạo alert:

```
http://<địa-chi-của-bạn>:8787/tm-alert/<TM_TOKEN>
```

Server in sẵn URL này khi khởi động. Không cài `TM_TOKEN` thì `/tm-alert` trả
**401 cho mọi request** (fail-closed) — không có chuyện bỏ qua xác thực.

Ngoài ra còn nhận token qua `?token=`, `Authorization: Bearer` hoặc `X-TM-Token`
(dành cho test/script). `User-Agent: TradingView` **không** được dùng làm xác thực
— nó giả mạo được.

Server lưu mọi alert vào `logs/alerts.ndjson`, chống gửi trùng **bằng unique index trên
`alerts.alertKey`** (bền vững qua restart — không còn bộ đếm trong RAM) và
từ chối payload sai logic (SL sai phía so với giá vào lệnh).
`/health` báo `dedupe: "mongo"` (hoặc `"ram"` khi Mongo không kết nối được).
Chi tiết payload: [`docs/alert-schema.md`](docs/alert-schema.md).

## 6. Thêm module tín hiệu mới

1. Thêm 3 input trong `pine/parts/10_config.pine`.
2. Thêm khối tính điểm trong `pine/parts/30_signal.pine` và 1 dòng vào tổng `tm_wTotal` / `tm_wSum`.
3. `npm run verify`.

Không cần sửa `40_risk`, `50_state`, `60_viz`, `70_alerts`.

## 7. Cảnh báo

- Mặc định là bộ công cụ **sinh tín hiệu**, không phải lời khuyên đầu tư.
- Dùng **strategy** để kiểm chứng winrate trước khi để tiền thật.
- Backtest không tính spread/slippage/thuế — kết quả thực tế luôn kém hơn.
