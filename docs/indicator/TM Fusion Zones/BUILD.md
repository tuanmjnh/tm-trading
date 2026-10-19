# Quy trình Build & Kiểm thử — TM Fusion Zones

> Tài liệu hướng dẫn chi tiết quy trình lắp ráp (assembly), kiểm tra tĩnh (lint),
> kiểm thử hồi quy (smoke tests) và triển khai chỉ báo **TM Fusion Zones**.

---

## 1. Kiến trúc Trình Biên Dịch (Assembler Pipeline)

Pine Script không hỗ trợ cú pháp `#include` nội bộ. Vì vậy, hệ thống sử dụng công cụ `tools/build.mjs` đóng vai trò preprocessor:

1. **Đọc các tệp thành phần (parts)** theo thứ tự từ điển trong `pine/parts-fusion-zones/`:
   - `00_header.pine` — Khai báo `@version=6`, vị trí đặt marker `{{DECL}}` và `{{SHARED}}`.
   - `10_config.pine` — Định nghĩa toàn bộ inputs, asset profiles, trọng số điểm và thông số rủi ro.
   - `20_core.pine` — Tính ATR, factory MA, phiên giao dịch, nhận diện asset và bộ phân loại regime (ADX + Choppiness).
   - `30_ribbon.pine` — Tính dải băng Trend Ribbon đôi, độ dốc và độ mở rộng dải mây.
   - `40_zones.pine` — Bộ máy phát hiện Supply/Demand Pivot zones, gom cụm và dọn vùng vỡ.
   - `50_structure.pine` — Nhận diện Swings, BOS, CHoCH, Quét thanh khoản (Sweeps), PDH/PDL và mẫu nến.
   - `60_setups.pine` — Hiện thực 3 setup giao dịch độc lập (Pullback, Sweep Reversal, Range Reversion).
   - `70_scoring_risk.pine` — Chấm điểm đối xứng 0–100, cổng rủi ro, SL/TP theo ATR/Swing, cổng cản trở Obstacle Gate.
   - `80_state.pine` — Máy trạng thái quản lý vòng đời lệnh, phát hiện chạm TP1/TP2/TP3/SL, thống kê Win/Loss.
   - `90_strategy_exec.pine` — Cầu nối khớp lệnh tự động cho bản Strategy Lab (`@part skip:fz`).
   - `95_viz.pine` — Vẽ Ribbon Cloud, hộp vùng Supply/Demand, nhãn tín hiệu và bảng điều khiển HUD.
   - `99_alerts.pine` — Bộ khung phát cảnh báo Webhook chuẩn schema `fz.signal.v1.0` và alertconditions.

2. **Chèn mã dùng chung (`{{SHARED}}`)**:
   - Tệp `pine/shared/common.pine` được tự động chèn vào đầu kịch bản, cung cấp các hàm nền tảng như `f_ts()`, `f_sym()`, `f_clamp()`, `f_fmtPx()`, `f_sess*`.

3. **Lọc Marker theo Target (`@part skip:<target>`)**:
   - Khi build bản indicator (`fz`), preprocessor loại bỏ toàn bộ khối lệnh sau `// @part skip:fz` trong `90_strategy_exec.pine`.
   - Khi build bản strategy (`fz-strategy`), toàn bộ logic chiến lược được giữ lại.

---

## 2. Các Lệnh Build & Sử Dụng

### Biên dịch mã nguồn Pine:
```bash
# Build cả hai bản indicator và strategy:
node tools/build.mjs fz
node tools/build.mjs fz-strategy

# Hoặc dùng npm script:
npm run pine:fz
npm run pine:fz:backtest
npm run pine:build
```

### Sao chép mã nguồn vào Clipboard để dán lên TradingView:
```bash
# Copy bản indicator vào Clipboard:
npm run pine:copy:fz

# Copy bản backtest vào Clipboard:
npm run pine:copy:fz:backtest
```

### Chạy kiểm thử tự động:
```bash
# Kiểm tra cú pháp, linting và logic bất biến của Pine:
npm run pine:test

# Kiểm tra tính nhất quán giữa tài liệu và mã nguồn:
npm run docs:check

# Chạy toàn bộ cổng kiểm thử verify của repository:
npm run verify
```

---

## 3. Tuân Thủ Nghiêm Ngặt Pine Script v6

Bộ chỉ báo tuân thủ 100% các tiêu chuẩn của TradingView Pine Script v6:
- **Độ dài shorttitle**: `"TM FZ"` (5 ký tự) và `"TM FZ BT"` (8 ký tự) đều $\le 10$ ký tự.
- **Không sử dụng hàm lỗi thời**: Không gọi `input.timezone()`, thay bằng `input.string("America/New_York", ...)` an toàn.
- **Tránh hàm gọi trong biểu thức điều kiện**: Trích xuất `ta.change()`, `ta.crossunder()`, `ta.crossover()` ra ngoài scope toàn cục của thanh nến.
- **Quản lý giới hạn bộ nhớ hình vẽ**: Khai báo `max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500` và dọn dẹp box vùng bị phá vỡ hoặc vượt quá `fz_zn_max`.
- **Cấu trúc bảng HUD an toàn**: Tuyệt đối không truyền tham số `width` hoặc `height` phần trăm vào `table.cell()`, sử dụng `table.clear()` để làm mới ô dữ liệu.
