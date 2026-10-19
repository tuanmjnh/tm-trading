# Ablation Study & Walk-Forward Validation Protocol — TM Indicator 2 (v2.0)

> **Document Type:** Scientific Validation & Ablation Testing Protocol  
> **Target Script:** `TM Indicator 2.pine` & `TM Indicator Strategy Lab 2.pine`  
> **Status:** APPROVED — Phase 6 Standard

---

## 1. Phương pháp luận Kiểm thử Độc lập (Ablation Study)

Để chứng minh tính hiệu quả khoa học của từng trụ cột nâng cấp mà không bị thiên lệch tối ưu quá đà (Overfitting), giao diện cài đặt (Inputs) của `TM Indicator 2` và `TM Indicator Strategy Lab 2` cung cấp các công tắc bật/tắt độc lập cho từng tính năng.

Quy trình thẩm định bao gồm **5 cấu hình kiểm thử tích lũy (Cumulative Configs)**:

### 1.1 Danh mục 5 Cấu hình Kiểm định

| Cấu hình | Tên gọi | Các tính năng được kích hoạt | Mục tiêu kiểm chứng |
| :--- | :--- | :--- | :--- |
| **Config A** | **Baseline v1** | Tắt toàn bộ Gates, tắt Auto-BE, tắt Pullback Limit, tắt Trailing, tắt BTC Leader. | Đo lường hiệu năng gốc ban đầu của phiên bản v1 làm mốc đối chứng (Benchmark). |
| **Config B** | **P0 Fixes & Tuple MTF** | Sửa logic `rrOk`, đóng gói Tuple MTF non-repaint, phân định rõ vai trò TP1/TP2/TP3. | Kiểm chứng việc khôi phục các tín hiệu bị chặn sai và tính toàn vẹn của dữ liệu đa khung. |
| **Config C** | **Smart Gates** | Bật thêm `Gate 1 (Regime)`, `Gate 3 (Obstacle / Room-to-Left)`, `Gate 4 (Anti-Overextension)`. | Kiểm chứng khả năng giảm chuỗi thua lỗ liên tiếp (Drawdown reduction) bằng cách loại bỏ bẫy mua đỉnh/bán đáy. |
| **Config D** | **Smart Execution & Dynamic Mgmt** | Bật thêm `Auto Break-Even tại TP1`, `Trailing Stop sau TP2`, `Pullback Limit Entry`, `Time-Decay Exit`. | Kiểm chứng đòn bẩy tăng Winrate thực tế (Realized Winrate) và bảo toàn lợi nhuận khi giá đảo chiều. |
| **Config E** | **Full System (v2.0)** | Bật đầy đủ Profile tài sản, `BTC Leader Filter` cho ETH/Altcoin, và `Weekend Low-Liquidity Filter`. | Đạt đỉnh cao hiệu năng: Winrate và Expectancy tối ưu trên đa tài sản. |

---

## 2. Quy trình Thẩm định Walk-Forward (WFO Protocol)

Để đánh giá tính bền vững trong tương lai, quy trình Walk-Forward Optimization (WFO) phải tuân thủ nghiêm ngặt:

1. **Phân chia Dữ liệu Nến (Data Slicing):**
   - **In-Sample (IS - 70% dữ liệu lịch sử đầu):** Dùng để hiệu chỉnh các ngưỡng cơ bản.
   - **Out-of-Sample (OOS - 30% dữ liệu gần nhất):** Chạy kiểm định mù (Blind forward test) để xác nhận không bị Overfitting.

2. **Bộ Chỉ số Bắt buộc Thu thập (Performance Scorecard):**
   - **TP1 Hit Rate (%):** Tỷ lệ lệnh chạm ít nhất TP1.
   - **Net Trade Winrate (%):** Tỷ lệ lệnh đóng lại với Realized R > 0.
   - **Profit Factor (PF):** Tổng Gross Profit / Gross Loss.
   - **Max Drawdown (% & R):** Mức sụt giảm tài khoản sâu nhất.
   - **Expectancy (Trung bình R mỗi lệnh):** $\text{Avg Realized R}$.
   - **Break-Even Saved Count:** Số lệnh được Auto-BE cứu khỏi việc chạm Full Stop Loss.

---

## 3. Hướng dẫn Thực hiện trên TradingView

1. Chạy lệnh copy mã nguồn đã bundle vào clipboard:
   ```bash
   npm run pine:copy:tm2-strat
   ```
2. Mở TradingView, mở Pine Editor, dán toàn bộ mã nguồn và chọn **"Add to chart"**.
3. Mở tab **Strategy Tester**.
4. Chọn Symbol (ví dụ: `BINANCE:BTCUSDT.P` hoặc `OANDA:XAUUSD`), khung thời gian M15.
5. Lần lượt điều chỉnh các công tắc trong hộp thoại cài đặt để đối chiếu từ Config A đến Config E.
6. Ghi nhận kết quả vào bảng theo dõi kiểm thử thực tế. Tuyệt đối không tự bịa số liệu.
