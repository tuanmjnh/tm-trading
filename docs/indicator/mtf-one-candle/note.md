Phương pháp thực sự gồm hai nửa
Nửa A — "1 cây nến" (video XAU/USD 15m): thang khung tuyến tính D1 → H4 (khoanh cụm nến = vùng hiện hành) → H1 (cấu trúc trong vùng) → M30 (mức vào/LMT 4396.2) → M15 (khoanh tròn đúng 1 nến) → vẽ tay Entry/SL/TP. Ở giây 66 có khoanh đỏ một nến thân nhỏ trong cụm; 110–216s vẽ đủ hai kèo: một SELL (SL trên → entry → TP dưới) và một BUY (TP 4410, entry ~4395, SL ~4391).

Nửa B — "nhồi lệnh" (video USOIL): cùng thang đó nhưng D1→H4→H1→M10 (hộp đỏ vùng cầu) →M5, rồi tăng khối lượng theo bậc 0.01 → 0.11 → 0.34 → 0.73 lô, mua thêm 0.73/0.65/0.55 khi giá hồi, và dời SL về đúng entry trước TP.

Nhận định của bạn là chính xác: khung lớn quyết định hướng, khung nhỏ chỉ được chọn cây nến để đo Entry/SL/TP — nó không có quyền đổi chiều.

Tài liệu đã tổng hợp
README.md — bảng bằng chứng theo mốc thời gian cho cả 2 video, thang khung 5 tầng, định nghĩa "nến mồi" (4 điều kiện, cần ≥2), công thức Entry/SL/TP, thang nhồi L0–L3, checklist 8 bước, 8 điểm yếu (nặng nhất: nhồi lệnh 0.01→0.73 là martingale một chiều; video chỉ khoe ngày thắng; một kèo mẫu có TP gần hơn SL nên sau phí là âm), và so sánh trực tiếp với Price Action MTF.
BUILD.md — spec build: 11 module, target mtf1c + mtf1c-strategy (twin), 6 nhóm input với mặc định, pseudo-code T1–T5 / nến mồi / RR filter / pyramid / state machine, chống repaint, dashboard 2×12, alert JSON mtf1c.signal.v1.0, nghiệm thu và thứ tự thực hiện.
Đã thêm link vào docs/indicator/README.md §4.
Kiểm tra: npm run docs:check → PASS 1451/1451, 0 fail (gate bắt mọi npm run và đường dẫn backtick phải tồn tại). Mình chưa viết Pine — đây là spec để bạn duyệt trước, và mình cố ý không bịa ra đường dẫn pine/parts-... khi thư mục đó chưa tồn tại.

Cần bạn chốt 5 điểm trước khi build
Tiêu chí nến mồi: 4 điều kiện (≥2) như mình đề xuất, hay chỉ inside bar + thân nhỏ?
Nhồi lệnh bật mặc định không, dừng ở L2 hay cho tới L3 (×4)?
TP: ưu tiên vùng đối diện (pivot) hay 2R cố định?
Chỉ XAU + USOIL, hay mở BTC/Futures?
Làm bộ mới MTF One-Candle, hay gộp vào Price Action MTF thành một entry mode (thêm 1 module, không cần dist mới)?
Mình nghiêng phương án 5: phương pháp này dùng chung 80% hạ tầng với PA MTF, tách bộ riêng sẽ phải nhân đôi phần level/zone/regime.

Nếu bạn muốn nghe lại phần "1 cây nến" kỹ hơn, mình có thể trích xuất dày hơn đoạn 100–220s của video 2 (1 khung/2s) để đọc chính xác vị trí 3 đường SL/Entry/TP theo pixel trên trục giá.