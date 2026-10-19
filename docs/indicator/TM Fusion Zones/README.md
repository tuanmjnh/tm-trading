# TM Fusion Zones — Trend Ribbon & Dynamic Zones Trading Engine

> **Nguồn cảm hứng & Kiến trúc:** Thiết kế chuẩn hóa theo roadmap tại
> [`docs/indicator/TM Fusion Zones/TM_Fusion_Zones_Roadmap_v1.0.md`](TM_Fusion_Zones_Roadmap_v1.0.md),
> quy tắc tín hiệu tại [`signal-rules.md`](signal-rules.md),
> và các quyết định thiết kế tại [`design-decisions.md`](design-decisions.md).
>
> **Mục đích:** Bộ chỉ báo chuyên biệt mang tên **`TM Fusion Zones`** (nguồn `pine/parts-fusion-zones/`, Version: 1.0.0)
> tích hợp mô hình hợp lưu Trend Ribbon (Dual-MA Cloud), Vùng Cung Cầu Động (Dynamic Supply/Demand Zones),
> Cấu trúc thị trường & Quét thanh khoản (BOS/CHoCH/Sweep), 3 Setup vào lệnh độc lập (Trend Pullback, Sweep Reversal, Range Reversion),
> Hệ thống chấm điểm đối xứng hai chiều (Direction-Aware Quality Scoring 0–100), Cổng rủi ro & Cản trở (Risk & Obstacle Gate), và Bảng điều khiển HUD trực quan.

---

## 1. Cấu trúc Build (Production Ready)

| Thành phần | Đường dẫn | Ghi chú |
|---|---|---|
| Nguồn parts | `pine/parts-fusion-zones/` | 12 files (00_header đến 99_alerts + 90_strategy_exec) |
| Hàm dùng chung | `pine/shared/common.pine` | Chuẩn hóa hàm hệ thống TM (session, format, clamp) |
| Output indicator | `pine/dist/TM Fusion Zones.pine` | Version: 1.0.0, shorttitle: "TM FZ", overlay = true |
| Output backtest | `pine/dist/TM Fusion Zones Backtest.pine` | Version: 1.0.0, shorttitle: "TM FZ BT", overlay = true |
| Docs bộ này | `docs/indicator/TM Fusion Zones/` | Thư mục tài liệu độc lập & chi tiết |

Target trong `tools/build.mjs`:

```js
// TM Fusion Zones (parts-fusion-zones)
fz: {
  file: 'TM Fusion Zones.pine',
  dir: 'parts-fusion-zones',
  version: '1.0.0',
  shared: ['common.pine'],
  decl: `indicator("TM Fusion Zones", shorttitle = "TM FZ", overlay = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)`,
},
'fz-strategy': {
  file: 'TM Fusion Zones Backtest.pine',
  dir: 'parts-fusion-zones',
  version: '1.0.0',
  shared: ['common.pine'],
  decl: `strategy("TM Fusion Zones Backtest", shorttitle = "TM FZ BT", overlay = true, pyramiding = 0, calc_on_order_fills = true, process_orders_on_close = true, dynamic_requests = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_type = strategy.commission.percent, commission_value = 0.05, slippage = 0)`,
},
```

Script trong `package.json`:

```bash
npm run pine:fz                      # Chỉ build bản indicator
npm run pine:fz:backtest             # Chỉ build bản strategy
npm run pine:copy:fz                 # Build + copy TM Fusion Zones.pine vào clipboard
npm run pine:copy:fz:backtest        # Build + copy TM Fusion Zones Backtest.pine vào clipboard
```

**Marker cắt file** (twin architecture):
- File `90_strategy_exec.pine` chứa marker `// @part skip:fz` -> Bản indicator bỏ qua logic lệnh `strategy.*`, chỉ bản strategy giữ lại.
- Cả hai bản đều đồng bộ 100% logic từ `10_config` đến `80_state`, đảm bảo tín hiệu trên chart trùng khớp tuyệt đối với kết quả kiểm thử.

---

## 2. Các Module Cốt Lõi

1. **Trend Ribbon (`30_ribbon.pine`)**:
   - Dải băng MA đôi hỗ trợ EMA, SMA, HMA tùy biến chu kỳ nhanh (mặc định 20) và chậm (mặc định 50).
   - Tô màu trạng thái Bullish / Bearish và đo lường mức độ mở rộng (Spread expansion so với ATR).
   - Đóng vai trò bộ lọc định hướng xu hướng chính.

2. **Dynamic Zones Engine (`40_zones.pine`)**:
   - Tự động nhận diện các vùng Cung (Supply) và Cầu (Demand) từ các Pivot High/Low đã xác nhận.
   - Cơ chế gộp vùng gần nhau (ATR width tolerance) và cập nhật số lần chạm (`touches`).
   - Quản lý hạn mức hiển thị hộp (box quota management, tối đa 10 vùng) và loại bỏ vùng bị triệt tiêu (broken).

3. **Market Structure & Sweeps (`50_structure.pine`)**:
   - Nhận diện đỉnh đáy sóng (Swings), Phá vỡ cấu trúc tiếp diễn (BOS) và Đổi tính chất (CHoCH).
   - Phát hiện Quét thanh khoản (Liquidity Sweeps) tại Swings và PDH/PDL (Previous Day High/Low).
   - Xác nhận mẫu nến phản ứng: Pin Bar từ chối giá, Engulfing nhấn chìm và nến động lượng.

4. **3 Setup Vào Lệnh Độc Lập (`60_setups.pine`)**:
   - **Setup 1: Trend Pullback**: Giá hồi về Ribbon hoặc Zone thuận xu hướng HTF + nến xác nhận.
   - **Setup 2: Liquidity Sweep Reversal**: Quét thanh khoản đỉnh đáy hoặc PDH/PDL + nến đóng ngược vào trong.
   - **Setup 3: Range Mean-Reversion**: Đánh phản ứng biên Supply/Demand khi Regime thị trường ở trạng thái đi ngang (Chop/Range).

5. **Scoring & Risk Gate (`70_scoring_risk.pine`)**:
   - Chấm điểm chất lượng độc lập 2 chiều LONG / SHORT (0–100) theo 5 trọng số: Trend (25), Zone (25), Structure (20), Candle (15), MTF (15).
   - Cổng 3 lớp quyết định: (1) Phát hiện Setup -> (2) Điểm chất lượng vượt ngưỡng -> (3) Đạt điều kiện rủi ro & RR.
   - **Obstacle Gate**: Tự động chặn tín hiệu nếu có vùng Cung/Cầu đối diện nằm gần hơn mục tiêu TP1.

6. **Interactive Dashboard HUD (`95_viz.pine`)**:
   - Hiển thị trực quan trạng thái thị trường: Regime, Session, Asset Profile, Trend Ribbon, Zone tương tác, Setup gần nhất, Điểm số chất lượng, Tỷ lệ Win/Loss.
   - Hỗ trợ chế độ Compact (Gọn nhẹ) và Advanced (Phân tích chuyên sâu).
