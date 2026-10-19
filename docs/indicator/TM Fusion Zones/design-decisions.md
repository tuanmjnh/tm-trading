# Các Quyết Định Thiết Kế — TM Fusion Zones (Design Decisions)

> Tài liệu ghi nhận các quyết định kiến trúc, lựa chọn tham số mặc định và các đánh đổi (trade-offs)
> trong quá trình phát triển **TM Fusion Zones**.

---

## 1. Mặc Định An Toàn & Đánh Đổi Thiết Kế

1. **Overlay Chart (`overlay = true`)**:
   - Dải băng Trend Ribbon và các vùng Supply/Demand cần hiển thị trực tiếp đè lên biểu đồ giá để người giao dịch quan sát trực quan nhất.
   - Do đó, cả bản indicator và backtest đều được cấu hình `overlay = true`.

2. **Chế Độ Chống Repaint (`fz_confirmOnly = true`)**:
   - Mặc định chỉ tính toán và phát sinh cảnh báo khi cây nến hiện tại đã hoàn tất (`barstate.isconfirmed`).
   - Quyết định này giúp loại bỏ 100% hiện tượng tín hiệu nhảy múa trong phiên (intrabar repaint), đảm bảo sự trung thực khi đối chiếu giữa chart trực tiếp và kết quả backtest.

3. **Cân Bằng Đối Xứng LONG / SHORT**:
   - Không suy diễn điểm SHORT bằng công thức $100 - \text{longScore}$. Điểm số của từng hướng được tính toán độc lập hoàn toàn theo các dữ kiện cấu trúc, vùng và nến tương ứng.
   - Khi cả hai hướng đều thỏa mãn điều kiện, hệ thống yêu cầu khoảng chênh lệch điểm tối thiểu (`fz_scoreMargin = 8`) để chọn hướng có xác suất cao hơn.

4. **Tách Biệt Độc Lập Giữa Điểm Số và Quản Trị Rủi Ro**:
   - Điểm chất lượng cao (ví dụ 90/100) **không bao giờ** được phép bỏ qua các quy tắc rủi ro bắt buộc (Obstacle Gate, Min RR, Cooldown).
   - Nếu có vùng cản Supply/Demand đối diện nằm gần hơn mốc TP1, lệnh bắt buộc phải bị chặn để bảo vệ vốn.

5. **Lựa Chọn Khung Thời Gian HTF Bias**:
   - Mặc định tham chiếu khung 240 phút (4h) với đường EMA 100.
   - Phù hợp với cả giao dịch Swing và Day Trading trên các khung M15 / M30 / H1.

---

## 2. Hạn Mức Bộ Nhớ & Tối Ưu Pine v6

- Giới hạn số lượng vùng hiển thị tối đa (`fz_zn_max = 10`) để đảm bảo không bị vượt quá giới hạn 500 hộp vẽ của TradingView.
- Tự động xóa (box.delete) các vùng đã bị phá vỡ (broken zones) và cập nhật số lần chạm (mitigation/touches) để giữ cho biểu đồ luôn sạch sẽ, dễ nhìn.
