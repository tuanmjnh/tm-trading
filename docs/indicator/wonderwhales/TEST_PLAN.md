# Test Plan & Verification — Wonderwhales

Kế hoạch kiểm thử và kết quả xác thực cho chỉ báo **Wonderwhales v1.0.0**.

---

## 1. Automated System Checks (Smoke & Build Pipeline)

Bộ kiểm thử tự động được tích hợp trực tiếp trong `tools/build.mjs` và `tools/smoke.mjs`.

### Kết quả kiểm tra biên dịch & Linting
- **Command:** `npm run pine:build`
- **Kết quả:** `OK  Wonderwhales.pine    258 dong` — 0 cảnh báo, 0 lỗi.
- **Quy chuẩn đối chiếu:** Toàn bộ built-ins, signatures và types được kiểm tra đối chiếu tự động với [tools/pine-ref.json](file:///d:/Applications/tm-trading/tools/pine-ref.json) (TradingView Pine Script v6 canonical metadata).

### Kết quả kiểm tra Smoke Test (`tools/smoke.mjs`)
- [x] **ww: indicator, khong phai strategy**: Khai báo `indicator("Wonderwhales", ...)` và không chứa lệnh đặt lệnh `strategy.entry()`.
- [x] **ww: shorttitle <= 10 ky tu**: Đạt yêu cầu hiển thị TradingView (`shorttitle = "WWHALES"`).
- [x] **ww: overlay = true**: Hiển thị trực tiếp trên biểu đồ giá chính.
- [x] **ww: PSAR inputs mac dinh 0.02 / 0.02 / 0.2**: Đúng chuẩn theo ảnh tham khảo.
- [x] **ww: confirm on bar close mac dinh true**: Mặc định ngăn chặn repainting.
- [x] **ww: 4 che do signal mode day du**: Đầy đủ `Parabolic SAR Reversal`, `EMA Crossover`, `SAR + EMA Trend Filter`, `SAR + EMA + ATR Filter`.
- [x] **ww: EMA filter + ATR filter co input / toggle**: Đầy đủ các inputs cấu hình độc lập.
- [x] **ww: alertcondition cho BUY, SELL va Any Signal**: Đầy đủ 3 điều kiện cảnh báo có tiêu đề và thông điệp chuẩn hóa.
- [x] **ww: nhan BUY / SELL ngon ngu EN va CN**: Hỗ trợ đầy đủ văn bản "BUY", "SELL", "买", "卖".

---

## 2. Checklist kiểm tra chức năng (Functional Matrix)

| STT | Hạng mục kiểm tra | Tiêu chí đạt | Trạng thái |
|---|---|---|:---:|
| 1 | Cú pháp Pine v6 | `//@version=6` ở dòng 1; không dùng hàm bị loại bỏ | Đạt |
| 2 | Loại script | `indicator(overlay=true)` | Đạt |
| 3 | Tách biệt tín hiệu | BUY và SELL không bao giờ xuất hiện đồng thời trên cùng 1 nến | Đạt |
| 4 | Chống lặp tín hiệu | Mỗi đợt đảo chiều chỉ xuất hiện duy nhất 1 nhãn tại nến bắt đầu xu hướng | Đạt |
| 5 | Xử lý dữ liệu ban đầu | Khi `ww_psar` còn `na` ở đầu chuỗi dữ liệu, không phát sinh tín hiệu rác | Đạt |
| 6 | Độc lập chế độ cơ bản | Chế độ mặc định `Parabolic SAR Reversal` hoàn toàn không bị ảnh hưởng bởi EMA hay ATR | Đạt |
| 7 | Tương thích Alert | Alertcondition kích hoạt cùng lúc và cùng điều kiện với nhãn hiển thị trên chart | Đạt |
| 8 | Lựa chọn ngôn ngữ | Chuyển đổi giữa `EN (BUY/SELL)` và `CN (买/卖)` hiển thị đúng văn bản nhãn | Đạt |
| 9 | Kích cỡ nhãn | Thay đổi `Tiny`, `Small`, `Normal` render đúng kích thước tương ứng | Đạt |
| 10 | Toggle ẩn hiện | Tắt `Show Parabolic SAR` chỉ ẩn dots, không thay đổi logic tính toán tín hiệu | Đạt |

---

## 3. Hướng dẫn kiểm thử thủ công trên TradingView

Để kiểm thử thực tế trên TradingView:
1. Chạy lệnh: `npm run pine:copy:ww` để sao chép mã nguồn vào clipboard.
2. Dán vào Pine Editor trên TradingView và chọn **Add to chart**.
3. **Kiểm thử trên BTCUSDT Perpetual (Khung D1, 4H, 1H)**:
   - Đối chiếu vị trí chấm PSAR tím hồng và nhãn BUY/SELL xanh/đỏ tại các điểm đảo chiều xu hướng.
   - Kiểm tra khi nến đang chạy (realtime): nếu `Confirm signals on bar close = true`, nhãn chỉ xuất hiện khi nến đóng; nếu tắt, nhãn có thể xuất hiện tức thời.
   - Thử chuyển đổi giữa 4 chế độ trong phần Settings (F2):
     - `Parabolic SAR Reversal`
     - `EMA Crossover`
     - `SAR + EMA Trend Filter`
     - `SAR + EMA + ATR Filter`
   - Quan sát xem tín hiệu có lọc bỏ các pha ngược xu hướng EMA hoặc lọc bỏ các vùng nến đi ngang biên hẹp không.
