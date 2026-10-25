# Wonderwhales — Roadmap xây dựng chỉ báo TradingView

**Phiên bản tài liệu:** 1.0  
**Tên dự án:** Wonderwhales  
**Nền tảng:** TradingView / Pine Script v6  
**Loại sản phẩm:** Indicator hỗ trợ phân tích — không phải strategy đặt lệnh  
**Trạng thái:** Đặc tả cho AI coding agent triển khai  
**Ngôn ngữ tài liệu:** Tiếng Việt  

---

## 1. Mục tiêu dự án

Xây dựng một chỉ báo TradingView có tên **Wonderwhales**, hiển thị trực tiếp trên biểu đồ nến và cung cấp tín hiệu hỗ trợ nhận biết khả năng đảo chiều xu hướng. Bản đầu tiên ưu tiên tái tạo những đặc điểm nhìn thấy được trên ảnh tham khảo, có cấu trúc sạch, tín hiệu dễ đọc, cảnh báo dễ dùng và hạn chế tín hiệu thay đổi trong khi nến chưa đóng.

Wonderwhales là một công cụ hỗ trợ quyết định. Nó **không tự đặt lệnh, không phải chiến lược giao dịch có thể được kiểm thử trong Strategy Tester, và không bảo đảm tín hiệu có lợi nhuận**.

### 1.1 Mục tiêu v1.0

1. Vẽ Parabolic SAR (PSAR) thành các dấu chấm/cross màu tím hồng trên biểu đồ giá.
2. Phát hiện lúc trạng thái SAR đảo chiều từ giảm sang tăng và từ tăng sang giảm.
3. Hiển thị nhãn BUY màu xanh dưới nến khi có tín hiệu tăng; nhãn SELL màu đỏ phía trên nến khi có tín hiệu giảm.
4. Có ba thông số PSAR mặc định theo ảnh tham khảo: Initial Acceleration Factor = `0.02`, Increment = `0.02`, Maximum Acceleration Factor = `0.2`.
5. Có tùy chọn xác nhận khi nến đóng; mặc định bật để ưu tiên tín hiệu ổn định.
6. Có alert riêng cho BUY và SELL.
7. Cho phép bổ sung các bộ lọc EMA và ATR ở chế độ tùy chọn, nhưng không bật mặc định trong chế độ cơ bản vì ảnh chỉ xác nhận rõ PSAR và các nhãn giao dịch.
8. Tổ chức mã nguồn rõ ràng, có chú thích, hướng dẫn sử dụng, changelog và checklist kiểm thử.

### 1.2 Ngoài phạm vi v1.0

- Không đặt lệnh mua/bán, không kết nối sàn giao dịch.
- Không dùng `strategy()` và không tuyên bố có kết quả Strategy Tester.
- Không mô phỏng vốn, đòn bẩy, phí giao dịch, funding, thanh lý hoặc chuỗi thua trong phiên bản đầu tiên.
- Không khẳng định đây là bản sao thuật toán nội bộ của script tham khảo. Mã nguồn của script tham khảo không được cung cấp; chỉ được triển khai độc lập dựa trên thông tin người dùng quan sát và mô tả họ cung cấp.
- Không thêm các vùng cung/cầu, Order Block, Liquidity Sweep, volume profile hoặc Smart Money Concepts nếu chưa có yêu cầu riêng.
- Không thêm truy vấn đa khung thời gian (MTF) vào MVP. Chỉ làm khi có yêu cầu và có kế hoạch kiểm soát repainting.

---

## 2. Dữ liệu đầu vào và mức độ tin cậy

AI phải giữ tách biệt giữa **điều quan sát được**, **nội dung mô tả do người dùng cung cấp**, và **phần thiết kế mới**. Không biến giả định thành sự thật về mã nguồn gốc.

### 2.1 Những điều đã quan sát được trên ảnh

- Biểu đồ: BTCUSDT Perpetual, sàn Binance, khung D1 trong ảnh tham khảo.
- Có các chấm/cross tím hồng chạy phía trên hoặc dưới nến, hình thức rất phù hợp với Parabolic SAR.
- Có nhãn xanh `买` (nghĩa là mua/BUY) và nhãn đỏ `卖` (nghĩa là bán/SELL).
- Nhãn được đặt gần các điểm chuyển hướng của đường/chấm SAR.
- Tab Inputs hiển thị ba thông số: `Initial Acceleration Factor = 0.02`, `Increment = 0.02`, `Maximum Acceleration Factor = 0.2`.
- Không thấy các thông số EMA, ATR, stop-loss, take-profit, vốn hoặc số lệnh thua liên tiếp trong ảnh cài đặt đã gửi.

### 2.2 Nội dung mô tả được người dùng cung cấp nhưng chưa xác nhận từ ảnh

Mô tả văn bản nói chỉ báo/strategy sử dụng EMA nhanh và EMA chậm, lọc biến động bằng ATR, stop-loss theo phần trăm, trailing take-profit, thoát khi giao cắt EMA ngược chiều, kích thước vị thế theo phần trăm vốn và giới hạn số lần thua liên tiếp.

Các nội dung này khác với giao diện chỉ có ba tham số PSAR trong ảnh. Vì vậy, roadmap xử lý như sau:

- **Chế độ mặc định:** PSAR đảo chiều — bám sát bằng chứng nhìn thấy.
- **Chế độ EMA/ATR:** module tùy chọn được thiết kế theo phần mô tả, không tuyên bố là thuật toán đã xác minh của script tham khảo.
- **SL/TP, kích thước vị thế, giới hạn chuỗi thua:** để ngoài phạm vi indicator v1.0; chỉ cân nhắc ở phiên bản sau dưới dạng đường/rủi ro giả lập trực quan hoặc một strategy riêng được đặt tên rõ ràng.

---

## 3. Thiết kế sản phẩm

### 3.1 Tên và nhận diện

- Tên hiển thị: `Wonderwhales`.
- Phiên bản khởi đầu: `Wonderwhales v1.0` trong tiêu đề hoặc mô tả, tránh trùng lặp tên nếu TradingView có giới hạn hiển thị.
- Mô tả ngắn: `Parabolic SAR reversal signals with optional EMA trend and ATR volatility filters.`
- Phong cách: nền tảng, gọn, dễ đọc trên biểu đồ tối hoặc sáng; tín hiệu không che khuất phần lớn nến.

### 3.2 Nguyên tắc UI

- `overlay = true`: vẽ trên biểu đồ giá chính.
- Màu PSAR mặc định: tím hồng, tương phản với nến.
- BUY: nền xanh, chữ dễ đọc, mặc định đặt dưới nến.
- SELL: nền đỏ, chữ dễ đọc, mặc định đặt trên nến.
- Có lựa chọn nhãn `BUY/SELL` hoặc `买/卖`; nếu triển khai tùy chọn ngôn ngữ gây phức tạp không cần thiết thì có thể dùng `BUY/SELL` mặc định ở v1.0 và thêm tiếng Trung sau.
- Không tô nền toàn biểu đồ ở mặc định.
- Không vẽ EMA ở mặc định.
- Không hiển thị dashboard ở mặc định. Dashboard, nếu bổ sung, phải có công tắc bật/tắt.
- Tên input phải dễ hiểu; gom các tham số theo nhóm.

### 3.3 Tương thích khung thời gian và tài sản

- Ưu tiên kiểm thử trên khung `1H`, `4H`, `1D`, phù hợp với phần mô tả nhận được.
- Kiểm tra ít nhất BTCUSDT Perpetual và một vài thị trường khác nếu người dùng có dữ liệu phù hợp.
- Không khẳng định chiến lược hiệu quả trên một thị trường chỉ vì hiển thị đẹp trên BTC khung ngày.
- Khung 1m/5m không phải mục tiêu tối ưu hóa của v1.0; PSAR có thể đảo chiều nhiều lần khi giá nhiễu.

---

## 4. Đặc tả tín hiệu lõi — PSAR Reversal

### 4.1 Tính PSAR

Dùng hàm tích hợp của Pine Script v6:

```pine
psar = ta.sar(psarStart, psarIncrement, psarMaximum)
```

Giá trị mặc định:

| Input | Giá trị mặc định | Ý nghĩa |
|---|---:|---|
| Initial Acceleration Factor | `0.02` | Hệ số gia tốc ban đầu |
| Increment | `0.02` | Mức tăng hệ số gia tốc |
| Maximum Acceleration Factor | `0.2` | Giới hạn hệ số gia tốc |

Ràng buộc:

- Các giá trị phải dương.
- `psarMaximum` không được nhỏ hơn `psarStart`.
- Dùng `input.float()` với bước tăng hợp lý; không hard-code giá trị ở nhiều vị trí.
- Chú thích cần giải thích rằng thay đổi ba tham số làm thay đổi độ nhạy của PSAR.

### 4.2 Xác định trạng thái PSAR

Cần dùng cùng một quy tắc cho lịch sử và realtime. Cách triển khai đề xuất:

- Bullish state khi điểm PSAR nằm dưới đáy nến hiện tại (`psar < low`).
- Bearish state khi điểm PSAR nằm trên đỉnh nến hiện tại (`psar > high`).
- Nếu điểm PSAR không nằm rõ ràng ở một phía của biên nến, không tự tạo tín hiệu đảo chiều từ trạng thái mơ hồ; giữ hành vi an toàn và kiểm tra tình huống này trong test.

Một cách phát hiện flip có thể dùng:

```pine
sarBull = psar < low
sarBear = psar > high
buyFlip  = sarBull and sarBear[1]
sellFlip = sarBear and sarBull[1]
```

Đây là đặc tả tham khảo cho AI triển khai, không phải cam kết rằng điều kiện trên tái tạo chính xác mã nguồn đóng. AI phải xác thực logic bằng cách xem giá trị PSAR trên biểu đồ, xử lý các bar đầu tiên có `na`, và kiểm tra trường hợp đảo chiều qua gap.

Không dùng `ta.crossover(close, psar)` làm đại diện mặc định cho mọi trường hợp đảo chiều nếu điều đó tạo kết quả khác với việc trạng thái SAR chuyển từ phía trên sang phía dưới nến.

### 4.3 Xác nhận khi nến đóng

Tạo input:

- `Confirm signals on bar close` — mặc định `true`.

Quy tắc:

- Khi bật, tín hiệu được phát ra chỉ khi điều kiện flip đúng và `barstate.isconfirmed` là `true`.
- Khi tắt, người dùng chấp nhận khả năng tín hiệu hiện ra rồi biến mất trước khi nến đóng; phải ghi rõ trong mô tả input và README.
- Tín hiệu đã được xác nhận ở nến lịch sử không được chủ động di chuyển sang nến trước hoặc vẽ lại ngược thời gian.
- Không dùng dữ liệu tương lai, pivot được hồi tố hoặc `lookahead_on` không an toàn.

### 4.4 Quy tắc BUY/SELL cơ bản

- BUY: trạng thái PSAR vừa chuyển từ bearish sang bullish.
- SELL: trạng thái PSAR vừa chuyển từ bullish sang bearish.
- Chỉ phát một nhãn cho mỗi lần chuyển trạng thái; không lặp BUY ở mọi nến trong một xu hướng.
- BUY/SELL cơ bản phải phản ánh PSAR, không được âm thầm bị thay đổi bởi EMA/ATR nếu người dùng chọn chế độ `Parabolic SAR reversal`.
- Không dùng nhãn BUY/SELL làm cam kết “nên mua/bán”; tooltip/mô tả cần gọi đây là tín hiệu chỉ báo.

### 4.5 Vẽ điểm PSAR

- Vẽ một chuỗi `plot()` với kiểu dấu chấm/cross; ưu tiên `plot.style_cross` hoặc kiểu tương đương giúp mô phỏng hình ảnh.
- Màu mặc định: tím hồng.
- Có input `Show Parabolic SAR` mặc định `true`.
- Độ dày mặc định nhỏ/vừa, không che nến.
- Điểm PSAR phải đi theo giá trị PSAR trên mỗi nến; không tạo `label.new()` cho từng điểm nếu `plot()` đủ đáp ứng, nhằm tránh dùng hết giới hạn drawing objects.

### 4.6 Vẽ nhãn tín hiệu

- `plotshape()` được ưu tiên cho các nhãn có nội dung tĩnh.
- BUY: `shape.labelup`, vị trí `location.belowbar`, nền xanh, chữ trắng hoặc màu tương phản.
- SELL: `shape.labeldown`, vị trí `location.abovebar`, nền đỏ, chữ trắng hoặc màu tương phản.
- Input `Show Buy/Sell Labels` mặc định `true`.
- Input kích thước nhãn có thể là `Tiny / Small / Normal`; nếu input size không thể kết nối trực tiếp với tham số `size` do yêu cầu kiểu hằng số trong Pine, AI phải dùng các nhánh `plotshape()` với giá trị `size` cố định cho từng lựa chọn.
- Nếu có lựa chọn ngôn ngữ, các chuỗi truyền vào `plotshape(text=...)` phải đáp ứng ràng buộc kiểu dữ liệu Pine. Dùng các lời gọi riêng cho nhãn BUY/SELL và 买/卖 khi cần, không cố nhét một chuỗi động vào đối số yêu cầu `const string`.
- Tín hiệu BUY và SELL không được cùng đúng trên cùng một nến trong chế độ lõi. Nếu phát hiện xung đột, giữ an toàn và không phát cả hai.

---

## 5. Module tùy chọn EMA và ATR

Module này lấy cơ sở từ mô tả văn bản do người dùng cung cấp. Vì không được xác nhận trong ảnh Inputs, toàn bộ phải là **tùy chọn**, và chế độ mặc định vẫn là PSAR cơ bản.

### 5.1 Bộ chọn nguồn tín hiệu

Thêm input `Signal Mode` với các chế độ rõ nghĩa:

1. `Parabolic SAR Reversal` — mặc định; chỉ dùng flip PSAR.
2. `EMA Crossover` — tín hiệu BUY khi EMA nhanh cắt lên EMA chậm; SELL khi EMA nhanh cắt xuống EMA chậm.
3. `SAR + EMA Trend Filter` — tín hiệu xuất phát từ flip PSAR, nhưng BUY chỉ hợp lệ khi EMA nhanh lớn hơn EMA chậm; SELL chỉ hợp lệ khi EMA nhanh nhỏ hơn EMA chậm.
4. `SAR + EMA + ATR Filter` — dùng flip PSAR, xác nhận hướng EMA và yêu cầu biến động ATR vượt ngưỡng cấu hình.

Chuyển chế độ phải làm thay đổi tín hiệu theo định nghĩa trên; không được chỉ đổi tên chế độ mà giữ nguyên logic.

### 5.2 EMA nhanh/chậm

Inputs đề xuất:

| Input | Giá trị đề xuất ban đầu | Ghi chú |
|---|---:|---|
| Fast EMA Length | `20` | Giá trị thiết kế ban đầu, không phải thông số đã xác minh từ script gốc |
| Slow EMA Length | `50` | Giá trị thiết kế ban đầu, không phải thông số đã xác minh từ script gốc |
| Show EMA Lines | `false` | Mặc định tắt để biểu đồ gần ảnh tham khảo |

Quy tắc:

- Độ dài phải là số nguyên dương.
- Cảnh báo nếu fast length bằng hoặc lớn hơn slow length; có thể cho phép người dùng đảo ý định nhưng phải chú thích rõ. Khuyến nghị validate fast < slow.
- `EMA Crossover`: dùng `ta.crossover(fastEma, slowEma)` cho BUY và `ta.crossunder(fastEma, slowEma)` cho SELL.
- `SAR + EMA Trend Filter`: tín hiệu flip phải đến từ SAR, sau đó lọc theo hướng EMA; không tạo tín hiệu chỉ vì EMA đã nằm đúng phía.
- Nếu bật plot EMA, chọn màu trung tính để không cạnh tranh với màu PSAR và nhãn.

### 5.3 Bộ lọc biến động ATR

Inputs đề xuất:

| Input | Giá trị đề xuất ban đầu | Ghi chú |
|---|---:|---|
| ATR Length | `14` | Thông số thông dụng để bắt đầu kiểm thử |
| Minimum ATR as % of Price | `0.5` | Ngưỡng ban đầu để kiểm thử, cần hiệu chỉnh theo thị trường/khung thời gian |
| Enable ATR Volatility Filter | `false` | Mặc định tắt trong chế độ cơ bản |

Định nghĩa đề xuất để tương đối dễ chuyển giữa tài sản có mức giá khác nhau:

```text
ATR Percent = ATR(ATR Length) / close * 100
Volatility OK = ATR Percent >= Minimum ATR as % of Price
```

Yêu cầu:

- Không so sánh ATR tuyệt đối với một ngưỡng tiền tệ cố định nếu mục tiêu là dùng trên BTC, cổ phiếu và các tài sản có mức giá khác nhau.
- Nếu ATR không hợp lệ hoặc giá đóng cửa bằng 0/`na`, không phát tín hiệu đã lọc.
- Khi chế độ có ATR được chọn, tín hiệu không hợp lệ nếu `Volatility OK` sai.
- Ngưỡng `0.5%` chỉ là điểm bắt đầu để kiểm thử, không phải thông số tối ưu hay ngưỡng đúng cho mọi thị trường.
- Đưa nguyên tắc tính ATR% vào README để người dùng hiểu rằng ngưỡng phụ thuộc tài sản và khung thời gian.

### 5.4 Hành vi khi bộ lọc chặn tín hiệu

- Không hiển thị nhãn BUY/SELL chính thức nếu tín hiệu bị chặn trong chế độ đã chọn.
- Ở chế độ debug (mặc định tắt), có thể hiển thị dấu nhỏ màu xám tại flip PSAR bị bộ lọc chặn; không được nhầm nó với tín hiệu hợp lệ.
- Nếu debug được thêm, cung cấp legend ngắn giải thích `SAR flip blocked by EMA` và `SAR flip blocked by ATR`.
- Chế độ debug không được tạo alert BUY/SELL.

---

## 6. Alerts / Cảnh báo

### 6.1 Alerts bắt buộc v1.0

Tạo các điều kiện cảnh báo riêng trong indicator:

- `Wonderwhales BUY`.
- `Wonderwhales SELL`.
- Có thể bổ sung `Wonderwhales Any Signal` nếu vẫn rõ ràng và tránh gửi trùng thông báo.

Dùng `alertcondition()` với tiêu đề và message ổn định, ví dụ:

- `Wonderwhales BUY | {{exchange}}:{{ticker}} | TF={{interval}} | Close={{close}}`
- `Wonderwhales SELL | {{exchange}}:{{ticker}} | TF={{interval}} | Close={{close}}`

`alertcondition()` tạo điều kiện cho người dùng chọn trong hộp thoại Create Alert; bản thân script không tự tạo alert thay người dùng.

### 6.2 Nguyên tắc kích hoạt

- Với `Confirm signals on bar close = true`, các điều kiện alert cũng phải đợi đến lúc nến xác nhận.
- Alert phải dùng cùng tín hiệu cuối cùng được vẽ trên chart. Không để chart hiển thị một tín hiệu còn alert kích hoạt theo một điều kiện khác.
- Hướng dẫn người dùng tạo alert và lựa chọn tần suất Once Per Bar Close khi thích hợp.
- Sau khi đổi input/mã nguồn, người dùng có thể cần tạo lại alert vì TradingView dùng snapshot cấu hình tại thời điểm tạo alert.
- Không gửi nhiều alert cho cùng một flip trên cùng một nến.

---

## 7. Kiến trúc code Pine Script

Pine Script được tổ chức trong một file chính để dễ dán vào TradingView Pine Editor. Không giả định dự án có thể dùng hệ thống module/import kiểu Node.js. Chỉ sử dụng Pine library nếu có một nhu cầu thực tế và được triển khai đúng cách.

### 7.1 File giao nộp

```text
Wonderwhales/
├── Wonderwhales.pine       # Script chính để dán vào Pine Editor
├── README.md               # Cách cài đặt, tham số, tín hiệu, cảnh báo, giới hạn
├── CHANGELOG.md            # Ghi lại thay đổi theo phiên bản
├── TEST_PLAN.md             # Danh sách test và kết quả thực tế
└── ROADMAP.md               # Bản roadmap này
```

Nếu agent chỉ có thể tạo một tệp trong môi trường làm việc hiện tại, ưu tiên giao `Wonderwhales.pine` và `README.md`; không được tuyên bố đã kiểm thử nếu chưa thực sự compile/test trên TradingView.

### 7.2 Các section bên trong `Wonderwhales.pine`

1. Version / declaration.
2. Input groups — PSAR, Signal Confirmation, EMA Filter, ATR Filter, Visuals, Alerts.
3. Input validation / guards.
4. Calculations — PSAR, trạng thái SAR, EMA, ATR%.
5. Raw signal detection — PSAR flips, EMA crosses.
6. Signal filtering — mode, EMA direction, ATR regime, confirmed bar.
7. Visuals — PSAR dots, EMA lines tùy chọn, BUY/SELL labels, debug tùy chọn.
8. Alerts — `alertcondition()` và message constants.
9. Comments / usage notes.

### 7.3 Quy tắc chất lượng code

- Dùng `//@version=6`.
- Dùng `indicator()` chứ không dùng `strategy()` trong bản Wonderwhales indicator.
- Dùng `overlay=true`.
- Đặt `max_labels_count`/`max_lines_count` chỉ khi thực sự dùng drawing objects; tránh tăng hạn mức không cần thiết.
- Tên biến có nghĩa, thống nhất tiếng Anh trong code; chú thích nghiệp vụ có thể bằng tiếng Anh hoặc tiếng Việt.
- Không lặp lại công thức PSAR/EMA/ATR tại nhiều nơi.
- Không dùng dữ liệu tương lai, `lookahead` không an toàn hoặc hành vi vẽ lùi tín hiệu để làm lịch sử trông đẹp hơn.
- Không tạo object mới mỗi tick mà không kiểm soát; ưu tiên `plot()`/`plotshape()` cho phần lớn hình ảnh.
- Các điều kiện raw và filtered signal cần đặt tên riêng để dễ audit.
- Nếu logic có thể làm phát BUY và SELL đồng thời, phải xử lý xung đột có chủ ý.
- Không thêm thư viện ngoài hoặc dịch vụ API bên ngoài; v1.0 hoạt động thuần trong Pine Script.

---

## 8. Lộ trình triển khai theo giai đoạn

### Phase 0 — Xác định yêu cầu và baseline

**Mục tiêu:** khóa đặc tả trước khi viết nhiều code.

Công việc:

1. Xem lại hai ảnh do người dùng cung cấp và phần mô tả văn bản.
2. Ghi rõ các tính năng xác nhận từ ảnh và những tính năng chỉ đến từ mô tả.
3. Chốt `Parabolic SAR Reversal` là chế độ mặc định.
4. Xác nhận indicator thuần, không giao dịch và không backtest bằng Strategy Tester.
5. Đọc tài liệu Pine Script v6 chính thức về `ta.sar`, visual plots, alerts và repainting.

**Đầu ra:** `ROADMAP.md`, danh sách input và quy tắc tín hiệu trước khi viết code.

**Điều kiện hoàn thành:** AI không mô tả EMA/ATR/SL/TP là thuật toán đã được xác minh của script tham khảo.

### Phase 1 — MVP: PSAR và nhãn BUY/SELL

**Mục tiêu:** hiển thị chính xác phần lõi.

Công việc:

1. Tạo `Wonderwhales.pine` với Pine Script v6 và `indicator(..., overlay=true)`.
2. Thêm ba tham số PSAR đúng giá trị mặc định.
3. Tính PSAR bằng built-in `ta.sar()`.
4. Xây dựng logic chuyển trạng thái tăng/giảm và xử lý `na` ở những bar đầu.
5. Vẽ chấm/cross PSAR màu tím hồng.
6. Vẽ nhãn BUY xanh và SELL đỏ ở đúng phía của nến.
7. Thêm công tắc bật/tắt điểm PSAR và nhãn.

**Điều kiện hoàn thành:** script compile; PSAR và nhãn hiển thị; không có nhãn lặp ở từng nến trong cùng một pha xu hướng; BUY/SELL không đồng thời xuất hiện cho cùng một lần đảo chiều.

### Phase 2 — Xác nhận nến và Alerts

**Mục tiêu:** đồng bộ tín hiệu chart và alert.

Công việc:

1. Thêm `Confirm signals on bar close`, mặc định bật.
2. Áp cùng điều kiện xác nhận cho nhãn và alerts.
3. Tạo `alertcondition()` riêng cho BUY và SELL.
4. Dùng placeholder hợp lệ trong message.
5. Viết hướng dẫn tạo alert trong README.

**Điều kiện hoàn thành:** chart/alert dùng chung điều kiện signal; không phát tín hiệu chỉ trong lúc nến đang mở nếu tùy chọn xác nhận được bật; người dùng có thể chọn BUY hoặc SELL riêng trong Create Alert.

### Phase 3 — Module EMA và ATR tùy chọn

**Mục tiêu:** hỗ trợ các bộ lọc trong mô tả nhưng không làm thay đổi chế độ cơ bản.

Công việc:

1. Thêm lựa chọn Signal Mode theo mục 5.1.
2. Thêm EMA nhanh/chậm và tuỳ chọn vẽ đường EMA.
3. Thêm ATR length và ATR% threshold.
4. Thêm chế độ SAR + EMA filter.
5. Thêm chế độ SAR + EMA + ATR filter.
6. Kiểm tra thứ tự ưu tiên và đảm bảo chế độ cơ bản luôn cho kết quả PSAR gốc.
7. Thêm nhãn/debug cho tín hiệu bị chặn nếu thật sự hữu ích; mặc định tắt.

**Điều kiện hoàn thành:** đổi mode tạo ra khác biệt đúng như định nghĩa; bật/tắt EMA/ATR không ảnh hưởng mode PSAR cơ bản; các input được mô tả rõ là thông số cần hiệu chỉnh theo thị trường.

### Phase 4 — Hoàn thiện trải nghiệm người dùng

**Mục tiêu:** giúp người dùng cấu hình dễ dàng.

Công việc:

1. Gom input theo nhóm tên rõ ràng.
2. Kiểm tra màu sắc trên theme tối/sáng.
3. Tối ưu kích thước/độ đặt của labels.
4. Thêm lựa chọn ngôn ngữ BUY/SELL hoặc 买/卖 nếu compile ổn định.
5. Tối ưu mặc định để biểu đồ gần hình tham khảo, không vẽ EMA/dashboard khi chưa bật.
6. Hoàn thành README và changelog.

**Điều kiện hoàn thành:** người mới hiểu mỗi input trong một lần đọc; có thể tắt các thành phần không muốn thấy; biểu đồ không bị quá nhiều dấu/nhãn.

### Phase 5 — Kiểm thử và sửa lỗi

**Mục tiêu:** xác nhận tính nhất quán, không phải chứng minh lợi nhuận.

Công việc:

1. Kiểm thử BTCUSDT Perpetual trên khung D1 và 4H.
2. Kiểm thử ít nhất một khung 1H và một thị trường khác.
3. Thử cuộn lịch sử, reload script, thay input và chuyển timeframe.
4. Quan sát tín hiệu ở nến realtime; đối chiếu với trạng thái sau khi nến đóng.
5. Tạo thử BUY alert và SELL alert.
6. Kiểm thử tham số biên và vùng có dữ liệu thiếu.
7. Ghi lại mọi lỗi và kết quả trong `TEST_PLAN.md`.

**Điều kiện hoàn thành:** compile không lỗi; không có runtime error đã biết; logic tín hiệu phù hợp với đặc tả; không ghi nhận repaint ngoài hành vi realtime được lựa chọn và giải thích rõ.

### Phase 6 — Tùy chọn tương lai: Trade-plan overlay

**Chỉ triển khai khi người dùng yêu cầu riêng.** Không được làm chậm hoặc thay đổi MVP.

Các tính năng có thể xem xét:

- Vẽ đường giá vào lệnh giả định tại giá đóng cửa của tín hiệu đã xác nhận.
- Vẽ mức stop-loss cố định theo tỷ lệ phần trăm.
- Vẽ mức trailing line theo quy tắc được định nghĩa rõ.
- Hiển thị điểm thoát giả định khi có tín hiệu ngược chiều.
- Tạo bảng thống kê mô phỏng có cảnh báo rõ rằng đây không phải Strategy Tester.

Nếu cần kiểm thử lệnh, tỷ lệ thắng, drawdown, kích thước vị thế, phí/funding hoặc chuỗi thua thì nên tạo **một strategy riêng** thay vì biến indicator thành thứ nửa indicator nửa strategy. Không tuyên bố thống kê của mô phỏng indicator tương đương Strategy Tester.

---

## 9. Kế hoạch kiểm thử bắt buộc

AI phải thực hiện test trên TradingView nếu môi trường cho phép. Nếu chỉ viết code trong file mà không truy cập được Pine Editor, phải đánh dấu compile là `Not verified` và hướng dẫn người dùng test thủ công; không được báo đã thành công.

### 9.1 Compile & input

- [ ] Khai báo Pine Script v6 hợp lệ.
- [ ] `indicator()` được dùng, không phải `strategy()`.
- [ ] `overlay=true`.
- [ ] PSAR mặc định là 0.02 / 0.02 / 0.2.
- [ ] Giá trị sai hoặc không hợp lệ được xử lý an toàn.
- [ ] Các chế độ input đều có tên và chú thích dễ hiểu.

### 9.2 Signal logic

- [ ] BUY chỉ phát khi chế độ PSAR chuyển từ giảm sang tăng.
- [ ] SELL chỉ phát khi PSAR chuyển từ tăng sang giảm.
- [ ] Không phát tín hiệu ở các bar đầu có dữ liệu chưa đủ.
- [ ] Không phát lại nhiều nhãn cùng chiều trong cùng một pha chỉ vì trạng thái vẫn duy trì.
- [ ] Không phát đồng thời BUY và SELL trên một bar.
- [ ] Khi `Confirm signals on bar close` bật, tín hiệu chỉ được chốt ở nến đóng.
- [ ] Sau khi reload, tín hiệu lịch sử không bị tự ý dịch sang các bar trước.

### 9.3 Visuals

- [ ] PSAR nằm đúng phía của nến theo trạng thái xu hướng.
- [ ] Màu PSAR là tím hồng và có thể nhìn thấy trên nền tối/sáng.
- [ ] BUY xanh nằm dưới nến, SELL đỏ nằm trên nến.
- [ ] Tắt `Show Parabolic SAR` chỉ ẩn dots, không thay đổi logic tín hiệu.
- [ ] Tắt `Show Buy/Sell Labels` chỉ ẩn nhãn, không thay đổi alert signal.
- [ ] Không vẽ thêm EMA hoặc panel ở chế độ mặc định.

### 9.4 Filters

- [ ] `Parabolic SAR Reversal` cho tín hiệu độc lập với EMA/ATR.
- [ ] `EMA Crossover` phát BUY/SELL theo đúng giao cắt EMA.
- [ ] `SAR + EMA Trend Filter` chỉ cho tín hiệu SAR cùng hướng EMA.
- [ ] `SAR + EMA + ATR Filter` chặn tín hiệu khi ATR% thấp hơn ngưỡng.
- [ ] Thử tăng/giảm ATR threshold và kiểm tra số tín hiệu thay đổi hợp lý.
- [ ] Không phát alert cho dấu debug của tín hiệu bị chặn.

### 9.5 Alerts

- [ ] BUY và SELL hiển thị thành hai lựa chọn riêng trong Create Alert.
- [ ] Message có symbol/timeframe/close bằng placeholder hợp lệ.
- [ ] Khi đóng nến, alert và nhãn dùng cùng điều kiện cuối cùng.
- [ ] Không có nhiều alert cho một tín hiệu do cùng một điều kiện bị gọi lặp.

### 9.6 Regression

Sau mỗi thay đổi:

- [ ] Chế độ PSAR mặc định vẫn giống baseline đã ghi nhận.
- [ ] Không đổi tên input đã lưu mà không ghi trong changelog.
- [ ] Không thêm tính năng mới gây lỗi compile hoặc vượt quá giới hạn visuals.
- [ ] Ghi phiên bản, thay đổi và test trong `CHANGELOG.md` / `TEST_PLAN.md`.

---

## 10. Định nghĩa hoàn thành v1.0

Wonderwhales v1.0 chỉ được đánh dấu hoàn thành khi đáp ứng tất cả điều kiện sau:

1. Có file `Wonderwhales.pine` hoàn chỉnh.
2. Có README mô tả hoạt động, thông số, alert và các hạn chế.
3. PSAR dùng giá trị mặc định 0.02 / 0.02 / 0.2.
4. Chế độ mặc định bám sát quan sát trong ảnh: chấm PSAR tím hồng và nhãn BUY/SELL xanh/đỏ.
5. Tín hiệu được xác nhận khi đóng nến theo mặc định.
6. Alert BUY/SELL riêng hoạt động theo đúng tín hiệu cuối cùng.
7. EMA/ATR là module tùy chọn, không âm thầm làm biến đổi chế độ cơ bản.
8. Không quảng bá script là chiến lược có lợi nhuận hoặc có kết quả backtest nếu chưa có strategy riêng.
9. Danh sách kiểm thử được cập nhật trung thực; phần nào chưa thể kiểm chứng phải ghi rõ.
10. Tên `Wonderwhales` xuất hiện nhất quán trong tiêu đề, alert, tài liệu và changelog.

---

## 11. Hướng dẫn cho AI coding agent

AI agent phải làm theo thứ tự này, không bỏ qua việc làm rõ điểm chưa xác minh:

1. Đọc toàn bộ roadmap trước khi viết code.
2. Dùng Pine Script v6 và xác nhận cú pháp với tài liệu chính thức TradingView.
3. Triển khai Phase 1 trước; compile/kiểm tra phần PSAR cốt lõi rồi mới thêm module.
4. Không tự thêm tính năng như order blocks, supply/demand, liquidity sweep, multi-timeframe hoặc dashboard nếu roadmap không yêu cầu.
5. Không mô phỏng thuật toán đóng của tác giả như thể đã biết source code. Chỉ triển khai dựa trên hành vi quan sát và quy tắc được đặc tả tại đây.
6. Giữ mode mặc định là `Parabolic SAR Reversal`; EMA/ATR không được bật ngầm.
7. Không chuyển sang `strategy()` chỉ để có số liệu lợi nhuận. Nếu người dùng cần backtest, đề xuất file strategy riêng.
8. Không tuyên bố code đã compile hoặc test trên TradingView trừ khi việc đó thực sự đã diễn ra.
9. Nếu không chắc API Pine, tra tài liệu chính thức hoặc giảm phạm vi triển khai; không đoán tên hàm/tham số.
10. Khi hoàn thành, trả kết quả gồm: tệp `.pine`, mô tả thay đổi, cách cài vào TradingView, test đã thực hiện và những mục còn chưa xác minh.

### Prompt có thể giao trực tiếp cho AI agent

> Bạn là lập trình viên Pine Script v6. Hãy triển khai dự án Wonderwhales dựa trên file roadmap này. Đọc toàn bộ tài liệu trước khi code. Bắt đầu bằng indicator overlay sử dụng `ta.sar()` với mặc định 0.02 / 0.02 / 0.2, vẽ các chấm/cross tím hồng và đánh dấu BUY xanh dưới nến, SELL đỏ trên nến khi trạng thái PSAR đảo chiều. Mặc định chỉ xác nhận tín hiệu lúc nến đóng. Tạo alert riêng cho BUY và SELL, đồng bộ chính xác với tín hiệu đã vẽ. Sau khi lõi hoạt động, mới triển khai các chế độ EMA/ATR tùy chọn. Giữ chế độ PSAR mặc định không bị ảnh hưởng bởi bộ lọc. Không dùng `strategy()`, không giả lập backtest và không tuyên bố sao chép mã nguồn đóng. Viết code sạch, có chú thích, README, changelog và checklist test. Nếu không thể compile hoặc kiểm thử trong TradingView, hãy nói rõ thay vì khẳng định đã kiểm thử.

---

## 12. Tài liệu tham khảo kỹ thuật chính thức

AI agent phải kiểm tra tài liệu hiện hành trong quá trình triển khai:

- Pine Script — Built-ins: https://www.tradingview.com/pine-script-docs/language/built-ins/
- Pine Script — Repainting: https://www.tradingview.com/pine-script-docs/concepts/repainting/
- Pine Script — Bar states: https://www.tradingview.com/pine-script-docs/concepts/bar-states/
- Pine Script — Alerts: https://www.tradingview.com/pine-script-docs/concepts/alerts/
- Pine Script — Text and shapes: https://www.tradingview.com/pine-script-docs/concepts/text-and-shapes/
- Pine Script — Visuals FAQ: https://www.tradingview.com/pine-script-docs/faq/visuals/

---

## 13. Tuyên bố giới hạn và rủi ro

Wonderwhales là chỉ báo kỹ thuật hỗ trợ phân tích, không phải lời khuyên đầu tư. PSAR có thể tạo nhiều tín hiệu sai trong thị trường đi ngang hoặc biến động giật mạnh. Các bộ lọc EMA/ATR có thể giảm một số tín hiệu nhưng cũng có thể làm tín hiệu đến muộn hoặc bỏ lỡ cơ hội. Kết quả hiển thị trên lịch sử không đảm bảo hành vi hay kết quả trong tương lai. Người dùng cần tự kiểm thử trên tài sản, khung thời gian và cấu hình phù hợp trước khi sử dụng trong quyết định tài chính.
