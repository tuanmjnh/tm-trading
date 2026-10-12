# TM Indicator --- Roadmap nâng cấp hệ thống phân tích đa tài sản / đa khung thời gian

> **Mục đích tài liệu:** Đây là tài liệu nguồn duy nhất để AI coding
> agent (OpenCode hoặc công cụ tương đương) audit, lập kế hoạch và nâng
> cấp mã Pine Script hiện tại. Đọc toàn bộ tài liệu trước khi sửa code.
> Làm theo từng phase, không bỏ qua các cổng kiểm định.
>
> **Tên dự án đề xuất:** **TM Indicator**. Tên này phù hợp hơn "TM XAU
> Signals" khi mở rộng từ vàng sang crypto. Nếu muốn mô tả rõ chức năng
> trong repo, dùng tiêu đề đầy đủ **TM Indicator --- Multi-Asset Futures
> Analysis System**. Giữ tên file/script cũ trong giai đoạn tương thích;
> chỉ đổi tên hiển thị sau khi có kế hoạch migration và không làm mất
> các alert/template đang dùng.

------------------------------------------------------------------------

## 1. Tầm nhìn và phạm vi

Xây dựng một hệ thống phân tích kỹ thuật trên TradingView bằng Pine
Script, hỗ trợ nhiều loại tài sản, nhiều khung thời gian và thị trường
Futures. Hệ thống trước tiên tạo tín hiệu có thể giải thích, sau đó mới
đánh giá hiệu quả bằng backtest và walk-forward. Không được quảng bá hay
tuyên bố độ chính xác/lợi nhuận khi chưa có kết quả kiểm định ngoài mẫu.

### 1.1 Phạm vi tài sản

-   **XAU:** vàng, ưu tiên các mã XAUUSD/XAUUSDT hoặc mã tương đương tùy
    sàn/dữ liệu biểu đồ.
-   **BTC:** các cặp BTC futures, ưu tiên hợp đồng tuyến tính định giá
    bằng USDT khi triển khai mô hình đầu tiên.
-   **ETH:** các cặp ETH futures tương tự.
-   **Altcoin:** chỉ áp dụng cấu hình altcoin khi symbol/dữ liệu đáp ứng
    điều kiện thanh khoản và dữ liệu tối thiểu.
-   **Altcoin thanh khoản thấp/rủi ro cao:** phải có cảnh báo riêng và
    mặc định có thể chặn tín hiệu khi spread/biến động/dữ liệu không đủ
    tin cậy.

Không giả định mọi sàn, mọi mã hoặc mọi hợp đồng đều có cùng quy tắc
khối lượng, tick size, phí, funding, đòn bẩy hay cách tính PnL. Trước
mắt tập trung phân tích và mô phỏng; không tích hợp đặt lệnh thật.

### 1.2 Phạm vi khung thời gian

Hỗ trợ khung vào lệnh và khung bối cảnh lớn, cấu hình được theo tài sản:

-   Khung vào lệnh: M1, M3, M5, M15.
-   Khung setup: M15, M30, H1, H4.
-   Khung bối cảnh: H1, H4, D, W, có thể thêm M khi cần.
-   Không cố định một bộ khung cho tất cả tài sản. Mọi kết hợp phải được
    kiểm tra thứ tự và tính hợp lệ.
-   Cấu hình mặc định chỉ là điểm khởi đầu, không phải khẳng định khung
    nào sinh lời tốt hơn.

### 1.3 Những gì không nằm trong phạm vi ban đầu

-   Không tự động giao dịch hoặc gửi lệnh thật.
-   Không tuyên bố "AI dự đoán chính xác", tỷ lệ thắng hoặc lợi nhuận
    nếu không có bằng chứng kiểm định.
-   Không dùng dữ liệu tương lai, lookahead sai, hoặc logic repaint để
    làm tín hiệu lịch sử đẹp hơn.
-   Không thêm chỉ báo chỉ vì phổ biến; mỗi thành phần phải có giả
    thuyết và được đánh giá bằng ablation test.
-   Không viết lại toàn bộ indicator ngay lập tức nếu có thể sửa theo
    từng phần nhỏ, kiểm tra được.

------------------------------------------------------------------------

## 2. Trạng thái mã nguồn hiện tại và các phát hiện cần xác minh

Mã nguồn đầu vào được cung cấp là `TM XAU Signals 2.pine`, Pine Script
v6, khoảng 1.382 dòng theo lần audit trước. AI phải đọc lại toàn bộ file
hiện hành trước khi kết luận, vì source có thể đã thay đổi kể từ lần
audit.

### 2.1 Kiến trúc hiện tại

-   Script hiện tại khai báo `indicator(...)`, không phải
    `strategy(...)`.
-   Đã có các thành phần như Market Structure (BOS/CHoCH/MSS), Liquidity
    Sweep, S/R, FVG, Order Block, EMA, RSI, MACD, DMI/ADX, ATR,
    Bollinger Band Width, Volume/OBV, VWAP, score 0--100, MTF, kế hoạch
    Entry/SL/TP và mô phỏng vòng đời vị thế.
-   Có cấu hình bối cảnh MTF và setup TF; lần audit trước ghi nhận bối
    cảnh có các lựa chọn 240/D/W/M và setup có 15/60.
-   Có session score dựa trên Asia/London/NY. Logic này cần đánh giá lại
    cho crypto hoạt động 24/7.
-   Có mô phỏng vị thế và bộ đếm kết quả; không được mặc định xem các bộ
    đếm này là backtest hợp lệ.

### 2.2 Lỗi/rủi ro ưu tiên cao cần kiểm tra lại

**P0 --- Điều kiện RR có khả năng chặn toàn bộ tín hiệu**

Lần audit trước thấy trong `f_buildX2Plan()` có logic tương đương:

``` pine
bool rrOk = x2_rrMin <= 0.0 or x2_rr1 >= x2_rrMin
```

Giá trị mặc định `x2_rrMin = 1.5`, trong khi `x2_rr1 = 1.0`. Nếu đúng
với source hiện tại, điều kiện này làm `rrOk` false theo mặc định và có
thể khiến kế hoạch không hợp lệ. Hãy xác minh toàn bộ đường đi của
`valid`, Entry/SL/TP và mọi nơi dùng nó. Không chỉ đổi giá trị mặc định
để "hết lỗi": phải xác định rõ ngưỡng RR áp dụng cho TP1 hay TP mục tiêu
nào, ghi chú trong UI/tài liệu và tạo checklist kiểm thử cho LONG/SHORT,
SL/TP hợp lệ và không hợp lệ.

**P0 --- Dữ liệu MTF có thể bị so sánh sai khung**

Lần audit trước thấy biểu thức MTF lấy EMA từ `request.security()` của
khung cao hơn, có offset `[1]` và `lookahead_on`, nhưng sau đó so sánh
với `close` của chart hiện tại. Ví dụ về dạng rủi ro:

``` pine
x2_ctxEma = request.security(syminfo.tickerid, x2_ctxTf,
     ta.ema(close, x2_ctxLen)[1], lookahead=barmerge.lookahead_on)
x2_ctxDir = close > x2_ctxEma ? 1 : -1
```

Nếu vẫn còn như vậy, `close` phải được xem là close của chart timeframe
chứ không phải close của context timeframe. Cần lấy **close và EMA trong
cùng một biểu thức `request.security()`**, cùng một timeframe và với
chính sách nến đã đóng nhất quán. Kiểm tra tương tự cho setup TF và mọi
biến MTF khác. Xác minh cú pháp/giới hạn Pine v6 và hành vi
realtime/historical; không tự nhận "non-repainting" nếu chưa kiểm tra.

**P0 --- Vòng đời vị thế và thống kê có thể phân loại sai**

Lần audit trước phát hiện các rủi ro: - Nếu một nến đồng thời chạm SL và
TP, hệ thống xử lý bảo thủ theo SL. Chính sách này có thể chấp nhận nếu
được ghi rõ và áp dụng nhất quán. - TP1/TP2 chỉ thay đổi stage, chưa
chắc phản ánh partial exit thật. - Timeout sau một số bar có thể được
ghi nhận nhầm như TP1 khi TP1 chưa chạm. - Bộ đếm win chỉ tăng khi TP3;
loss tăng khi SL; timeout có thể bị tính sai hoặc bỏ qua.

Hãy audit lại state machine, định nghĩa chính xác trạng thái vào
lệnh/đang giữ/partial exit/SL/TP/timeout/invalid, xử lý nến chạm nhiều
mức, và đảm bảo mỗi trade chỉ được đóng một lần. Phân biệt "đạt TP1" với
"trade đóng có lãi"; không trộn bộ đếm mô phỏng với số liệu strategy
backtest.

**P1 --- Điểm 0--100 không phải xác suất thắng**

Score hiện tại là điểm tổng hợp có trọng số, không tự động có nghĩa là
xác suất thắng 70% hoặc 80%. Kiểm tra xem ngưỡng score có thực sự gate
entry hay chỉ hiển thị. Tách rõ Signal Score, Trade Eligibility, Risk
Eligibility và Probability (chỉ thêm Probability nếu đã calibration trên
dữ liệu ngoài mẫu).

**P1 --- Session score không phù hợp mặc định cho mọi thị trường**

XAU có đặc trưng phiên giao dịch khác crypto. Crypto giao dịch gần như
24/7, nên session score phải là cấu hình tùy chọn hoặc trung tính mặc
định cho crypto cho đến khi được kiểm định. Không bê nguyên trọng số
phiên của XAU sang BTC/ETH/altcoin.

**P1 --- Futures chưa có mô hình chi phí/khớp lệnh đầy đủ**

Cần kiểm tra mô hình phí, spread, slippage, funding, loại hợp đồng, tick
size, position sizing, leverage/margin và liquidation. Không được suy ra
lợi nhuận thực tế từ giá Entry/TP/SL thuần túy nếu chưa mô hình hóa chi
phí và giả định khớp lệnh.

Các phát hiện trên là kết quả audit source trước đó và cần được AI xác
minh lại; không phải bằng chứng rằng code hiện tại đã được compile hoặc
backtest thành công.

------------------------------------------------------------------------

## 3. Nguyên tắc kỹ thuật bắt buộc

1.  **Đọc và lập bản đồ code trước khi sửa.** Xác định input, biến trạng
    thái, hàm, plots, labels, tables, alerts, security calls, các nhánh
    LONG/SHORT và phụ thuộc.
2.  **Giữ baseline.** Không ghi đè file gốc. Tạo bản mới/version mới, ví
    dụ `TM Indicator.pine`, đồng thời giữ `TM XAU Signals 2.pine` nguyên
    vẹn.
3.  **Sửa theo phase nhỏ.** Mỗi phase có thay đổi, lý do, checklist
    test, kết quả và danh sách vấn đề còn lại.
4.  **Pine Script v6.** Dùng cú pháp tương thích Pine v6; không giả định
    có thể gọi API ngoài hoặc chạy mô hình AI trực tiếp trong Pine.
5.  **Không lookahead sai / không repaint.** Tất cả `request.security()`
    phải có chính sách rõ về nến HTF đã đóng hay đang hình thành. Không
    dùng dữ liệu tương lai để tạo tín hiệu lịch sử. Phân biệt tín hiệu
    provisional realtime với tín hiệu confirmed.
6.  **Không giả định timeframe luôn hợp lệ.** Kiểm tra chart TF, setup
    TF, context TF. Nếu không thỏa chính sách MTF thì hiển thị cảnh báo
    hoặc từ chối tính toán theo cách rõ ràng.
7.  **Không gộp xác nhận trùng lặp.** RSI, MACD, EMA, ADX có thể cùng
    phản ánh momentum/trend; không đếm chúng như các bằng chứng hoàn
    toàn độc lập.
8.  **Chuẩn hóa giữa tài sản.** Ưu tiên ATR%, tỷ lệ theo giá, normalized
    distance, R-multiple và ngưỡng tương đối thay vì ngưỡng giá tuyệt
    đối dùng chung.
9.  **Không che giấu thiếu dữ liệu.** Volume, VWAP, funding hoặc các
    field không có sẵn phải được kiểm tra; nếu thiếu thì bỏ thành phần
    đó, đánh dấu degraded mode hoặc chặn tín hiệu theo cấu hình.
10. **Tách indicator khỏi strategy.** Indicator dùng cho phân tích/hiển
    thị/cảnh báo; Strategy Lab dùng `strategy()` để kiểm định. Không
    biến đổi trực tiếp indicator thành strategy theo cách phá vỡ hành vi
    đang dùng.
11. **Không tuyên bố compile thành công** nếu chưa mở/biên dịch trên
    TradingView hoặc chưa có bằng chứng compile đáng tin cậy. AI coding
    agent cần ghi rõ kiểm tra nào đã thực hiện thực tế và kiểm tra nào
    chỉ là review tĩnh.
12. **Không triển khai giao dịch thật.** Alert/paper trading chỉ là giai
    đoạn sau; không thêm API key, đặt lệnh hoặc quản lý tài khoản sàn.

------------------------------------------------------------------------

## 4. Kiến trúc mục tiêu

### 4.1 Các lớp logic

1.  **Data & Symbol Context**
    -   Symbol, exchange, asset profile, timeframe hiện tại.
    -   Dữ liệu OHLCV, tick/point assumptions khi có.
    -   Kiểm tra dữ liệu rỗng, volume không hợp lệ, lịch sử chưa đủ.
2.  **Asset Profile**
    -   `Auto`, `XAU`, `BTC`, `ETH`, `Liquid Altcoin`,
        `High-Risk Altcoin`, `Custom`.
    -   Auto detection chỉ là gợi ý; người dùng có thể override thủ
        công.
    -   Nếu không nhận diện chắc chắn, dùng `Custom/Unknown` an toàn,
        không âm thầm áp dụng profile XAU.
3.  **Market Structure & Price Action**
    -   Swing high/low, BOS, CHoCH/MSS.
    -   Trend/range regime.
    -   Candlestick patterns chỉ là yếu tố phụ có ngữ cảnh, không phải
        tín hiệu độc lập mặc định.
4.  **Location & Liquidity**
    -   Support/resistance zones.
    -   Liquidity sweep, equal highs/lows nếu logic hiện có hỗ trợ.
    -   FVG/imbalance và order blocks nếu có quy tắc xác định khách
        quan, không dùng vùng được vẽ lại để hợp thức hóa quá khứ.
5.  **Trend & Momentum**
    -   EMA/trend filter; RSI/MACD/ADX là tùy chọn.
    -   Chống đếm trùng thông tin giữa các chỉ báo.
6.  **Volume & Volatility**
    -   Volume/OBV/VWAP chỉ khi dữ liệu phù hợp.
    -   ATR, ATR%, Bollinger Band Width hoặc các thước đo volatility
        được chuẩn hóa.
7.  **MTF Engine**
    -   Context TF, Setup TF, Entry/Chart TF.
    -   Dữ liệu cùng timeframe phải được lấy/so sánh cùng nhau.
    -   Mặc định ưu tiên nến HTF đã đóng để có tính ổn định; realtime
        provisional phải được đánh dấu riêng nếu được bật.
8.  **Score & Decision Engine**
    -   Score theo nhóm, trọng số có thể cấu hình.
    -   Gate riêng cho tín hiệu, cấu trúc, MTF, thanh khoản và rủi ro.
    -   Trạng thái `No Trade` phải có lý do có thể giải thích.
9.  **Trade Plan & Futures Risk**
    -   Entry zone/price, invalidation/SL, TP levels, RR, position size
        tham khảo.
    -   Không được coi đòn bẩy là công cụ làm giảm rủi ro; leverage chỉ
        ảnh hưởng exposure/margin.
10. **Visuals & Alerts**
    -   Hiển thị nhất quán, có thể bật/tắt theo nhóm.
    -   Alert payload chuẩn hóa, không tạo alert trùng lặp ở mọi tick
        nếu không có chủ đích.
11. **Strategy Lab & Validation**
    -   Script riêng dùng `strategy()`.
    -   Backtest, cost assumptions, out-of-sample, walk-forward và
        ablation.
12. **Documentation & Regression Tests**
    -   Ghi lại giả định, hạn chế, test cases và thay đổi từng phiên
        bản.

### 4.2 Hệ thống điểm

Tách thành các nhóm độc lập về mặt ý nghĩa, ví dụ: - Trend/regime. -
Structure/price action. - Location/SR/liquidity. - Momentum. - Volume. -
Volatility suitability. - MTF agreement. - Session/context (tùy
profile).

Yêu cầu: - Trọng số và điều kiện bật/tắt phải cấu hình được. - Không
tính cùng một thông tin nhiều lần mà không có lý do. - Tạo bảng giải
thích score: nhóm nào cộng/trừ bao nhiêu, lý do nào chặn lệnh. - Điểm
tổng 0--100 chỉ là **Signal Score** cho đến khi được calibration. - Có
thể chia ngưỡng `Weak / Setup / Strong / No Trade`, nhưng phải xác minh
chúng thực sự ảnh hưởng tới eligibility theo đúng ý nghĩa đã mô tả. -
`Trade Eligibility` và `Risk Eligibility` là điều kiện riêng; score cao
không được bỏ qua rủi ro. - Nếu thiếu dữ liệu bắt buộc, không mặc định
điểm trung tính rồi phát tín hiệu như bình thường.

------------------------------------------------------------------------

## 5. Roadmap triển khai theo phase

## Phase 0 --- Đóng băng baseline và audit đầy đủ (P0)

### Việc cần làm

-   Đọc toàn bộ file `TM XAU Signals 2.pine`.
-   Xác nhận Pine version, input, hàm, các `request.security`, score,
    plan builder, state machine, visuals, alert conditions.
-   Lưu bản gốc không chỉnh sửa.
-   Tạo `docs/indicator/tm-indicator/audit-baseline.md` với phát hiện, vị trí code/line, mức độ
    P0/P1/P2, cách tái hiện và hướng sửa.
-   Tạo danh sách tính năng đang hoạt động để tránh vô tình xóa hành vi.
-   Ghi rõ không có compile/backtest nếu chưa thực hiện.

### Điều kiện hoàn tất

-   Có bản đồ module và danh sách issue có thể truy vết.
-   Không sửa hàng loạt trước khi hoàn thành audit.
-   Baseline source được bảo toàn.

## Phase 1 --- Sửa lỗi tính đúng đắn: RR, MTF, state machine (P0)

### RR và kế hoạch lệnh

-   Kiểm tra `f_buildX2Plan()` và mọi điều kiện `valid`.
-   Xác định RR được tính từ entry đến SL/TP nào; xử lý LONG/SHORT đối
    xứng.
-   Kiểm tra trường hợp SL/TP không hợp lệ, khoảng cách bằng 0, dữ liệu
    `na`, TP nằm sai phía.
-   Tạo test matrix cho RR thấp hơn, bằng và cao hơn ngưỡng.
-   Không hạ ngưỡng chỉ để có nhiều tín hiệu.

### MTF

-   Xác định quy ước timeframe và kiểm tra quan hệ Context / Setup /
    Entry.
-   Lấy close, EMA và mọi feature của một TF trong cùng ngữ cảnh
    `request.security()`.
-   Có chính sách rõ về nến HTF đã đóng; tránh dùng `lookahead` gây rò
    rỉ dữ liệu tương lai.
-   Audit mọi request cho context/setup và indicator khác, không chỉ
    EMA.
-   Xử lý chart TF cao hơn/thấp hơn setup TF, khung không hợp lệ và giá
    trị `na`.
-   Kiểm tra lịch sử và realtime để tìm repaint; ghi lại giới hạn của
    test.

### State machine

-   Xác định các trạng thái rõ ràng: idle, setup, open, TP1 partial, TP2
    partial, TP3/target exit, SL, timeout, invalidated.
-   Chỉ đóng trade một lần.
-   Định nghĩa thứ tự xử lý khi cùng nến chạm nhiều mức; chính sách bảo
    thủ SL-first có thể dùng nhưng phải công khai.
-   Timeout phải có exit reason riêng, không giả làm TP1.
-   Phân biệt TP milestone với realized trade outcome.
-   Nếu mô phỏng partial exit, phải có tỷ lệ khối lượng từng phần và
    cách tính realized PnL; nếu không mô hình hóa được thì ghi là
    milestone, không gọi là partial PnL.
-   Thống kê phải xử lý LONG/SHORT, trade mở cuối dữ liệu, timeout, gap
    và trường hợp nhiều mức bị chạm.

### Điều kiện hoàn tất

-   Tất cả issue P0 có kết luận rõ: fixed, not reproducible hoặc
    blocked.
-   Regression checklist cho LONG/SHORT, RR, MTF, SL/TP và timeout.
-   Không tuyên bố thành công nếu chưa kiểm tra thực tế.

## Phase 2 --- Thiết kế profile tài sản và timeframe (P1)

### Profile tài sản

-   XAU.
-   BTC.
-   ETH.
-   Liquid Altcoin.
-   High-Risk/Low-Liquidity Altcoin.
-   Custom/Unknown.

### Mỗi profile có thể cấu hình

-   EMA/trend lengths.
-   ATR/ATR% thresholds và volatility filters.
-   Swing/pivot sensitivity, S/R zone width, liquidity tolerance.
-   Momentum filters.
-   Volume/VWAP enablement.
-   Session weighting.
-   Min score, min RR, max risk per trade (chỉ tham khảo trong
    indicator), cooldown và signal frequency controls.
-   Futures fee/slippage/funding assumptions cho Strategy Lab, không giả
    vờ rằng indicator biết chi phí thật của mọi sàn.

### Timeframe profiles

-   Entry TF, Setup TF, Context TF.
-   Hỗ trợ M1/M3/M5/M15 cho entry; M15/M30/H1/H4 cho setup; H1/H4/D/W và
    tùy chọn M cho context.
-   Tạo validation rules cho mọi tổ hợp; không tự động giả định tất cả
    tổ hợp đều hợp lệ.
-   Cho phép preset nhưng giữ khả năng override.
-   Ghi rõ preset chỉ là cấu hình thử nghiệm cần backtest, không phải
    "best settings".

### Crypto session policy

-   Crypto mặc định hoạt động 24/7; session weighting tắt/trung tính
    theo mặc định cho profile crypto cho tới khi được kiểm định.
-   Nếu thêm phiên Á/Âu/Mỹ, định nghĩa timezone, DST và nguồn timestamp
    rõ ràng.
-   XAU có thể giữ session profile riêng nhưng phải được kiểm định
    riêng.

### Điều kiện hoàn tất

-   Không còn logic XAU-specific vô tình áp lên crypto.
-   Profile Unknown có hành vi an toàn, minh bạch.
-   Các tham số giá tuyệt đối được xem xét để chuẩn hóa theo ATR%, giá
    hoặc R-multiple.

## Phase 3 --- Chuẩn hóa Price Action, structure, indicators và scoring (P1/P2)

### Price Action / Structure

-   Kiểm tra swing, BOS/CHoCH/MSS, sweep, S/R, FVG, OB.
-   Mỗi khái niệm cần quy tắc xác định khách quan, thời điểm xác nhận và
    hành vi khi pivot mới xuất hiện.
-   Không dùng pivot tương lai để vẽ tín hiệu như thể đã biết tại thời
    điểm trước đó.
-   Phân biệt vùng đang hình thành với vùng confirmed.
-   Candlestick pattern phải có bối cảnh vị trí, xu hướng, volatility và
    invalidation; tránh danh sách pattern dài nhưng không có kiểm định.

### Indicators

-   Giữ EMA, RSI, MACD, DMI/ADX, ATR, BB width, Volume/OBV, VWAP dưới
    dạng feature có thể bật/tắt.
-   Kiểm tra khả năng có volume thật và ý nghĩa của volume theo loại sản
    phẩm/sàn.
-   Không bắt buộc mọi indicator phải xác nhận cùng hướng nếu điều đó
    làm tín hiệu quá trễ.
-   Mọi chỉ báo bổ sung phải có giả thuyết cụ thể và được kiểm tra bằng
    ablation test.

### Scoring/eligibility

-   Tách `Signal Score`, `Trade Eligibility`, `Risk Eligibility`.
-   Cho biết lý do LONG/SHORT/NO TRADE.
-   Nếu score là 0--100, giải thích nó là điểm tương đối, không phải xác
    suất thắng.
-   Chỉ tạo xác suất nếu có mô hình calibration, tập dữ liệu đủ, kiểm
    định ngoài mẫu và tài liệu phương pháp.
-   Kiểm tra ngưỡng `Weak/Setup/Strong` có thực sự gate tín hiệu không.

### Điều kiện hoàn tất

-   Mỗi nhóm score có giải thích.
-   Có thể tắt một nhóm để thử nghiệm.
-   Không có thay đổi làm repaint mà không được nêu rõ.

## Phase 4 --- Futures risk model (P1/P2)

Bắt đầu với **linear USDT-margined futures** làm giả định mô phỏng đầu
tiên, nếu dữ liệu/symbol phù hợp. Nêu rõ đây chỉ là mô hình giả định,
không áp dụng tự động cho inverse/coin-margined contracts.

Cần mô hình hóa hoặc ghi rõ chưa mô hình hóa: - Entry fill: close, next
bar open hoặc một giả định khác được lựa chọn rõ. - Maker/taker fee. -
Spread và slippage. - Funding rate và chu kỳ funding nếu có dữ liệu đáng
tin cậy; nếu không có dữ liệu funding thì phải hiển thị giới hạn, không
giả lập thành số thật. - Contract multiplier, tick size, quantity step
nếu phù hợp với loại hợp đồng. - Position sizing theo equity/risk per
trade. - Stop distance và realized R. - Leverage, notional exposure,
initial/maintenance margin assumptions. - Liquidation risk chỉ khi mô
hình đủ dữ liệu; không tự dựng giá thanh lý chính xác nếu thiếu thông số
sàn. - Max concurrent positions, portfolio exposure và tương quan nếu
sau này mô phỏng nhiều mã cùng lúc. - Gap/stop slippage và tình huống
thanh khoản thấp.

Không dùng leverage để tăng "điểm chất lượng tín hiệu". Tách signal
quality khỏi position sizing và margin constraints.

### Điều kiện hoàn tất

-   Có tài liệu `docs/indicator/tm-indicator/futures-risk-model.md` liệt kê công thức và giả
    định.
-   Mọi thông số giả định hiển thị rõ, có thể cấu hình.
-   Không gọi PnL mô phỏng là lợi nhuận chắc chắn.

## Phase 5 --- Tạo Strategy Lab riêng để backtest (P1)

Tạo script riêng, ví dụ `TM Indicator Strategy Lab.pine`, dùng
`strategy()`; không phá script indicator.

### Yêu cầu

-   Dùng chung logic tín hiệu hoặc có quy tắc đồng bộ rõ ràng với
    indicator.
-   Có chế độ LONG-only, SHORT-only, LONG+SHORT và No Trade.
-   Có cấu hình Entry/SL/TP, RR, partial exits nếu được hỗ trợ đúng.
-   Mô hình hóa phí, slippage và giả định khớp lệnh bằng các tùy chọn
    Pine phù hợp; tài liệu hóa giới hạn của mô hình.
-   Tránh lookahead và repaint; không tối ưu dựa trên dữ liệu tương lai.
-   Kiểm tra lệnh vào/ra, số lượng lệnh, giá khớp và thống kê qua nhiều
    giai đoạn.
-   Không nhầm lẫn mô phỏng state machine của indicator với kết quả
    TradingView Strategy Tester.

### Chỉ số cần báo cáo

-   Trade count.
-   Win rate.
-   Net PnL sau chi phí theo giả định.
-   Profit factor.
-   Expectancy / trade.
-   Max drawdown.
-   Average win/loss và realized R.
-   Long/short breakdown.
-   Holding time.
-   Kết quả theo asset, timeframe, regime và giai đoạn.
-   Sensitivity với fee/slippage và các tham số chính.

Win rate riêng lẻ không đủ để kết luận hệ thống tốt. PF cao trên số lệnh
ít hoặc một giai đoạn ngắn cũng không đủ.

## Phase 6 --- Ablation test, out-of-sample và walk-forward (P1)

### Các cấu hình thí nghiệm

-   **A --- Baseline:** Price Action + Market Structure + S/R.
-   **B --- Trend/Momentum:** A + trend filter và momentum đã chọn.
-   **C --- Liquidity/Volume:** B + sweep/volume/OBV/VWAP tùy dữ liệu.
-   **D --- MTF/Volatility/Risk:** C + MTF confirmed data +
    volatility/risk filters.
-   **E --- Asset/Timeframe profiles:** D + profile riêng cho
    XAU/BTC/ETH/altcoin và các timeframe.

Đây là các giả thuyết thí nghiệm, không phải kết luận rằng cấu hình E
chắc chắn tốt hơn.

### Quy trình dữ liệu

1.  Chia dữ liệu theo thứ tự thời gian thành train/development,
    validation và final test; không shuffle ngẫu nhiên chuỗi thời gian.
2.  Chốt cách chọn tham số trên train/development.
3.  Dùng validation để lựa chọn có giới hạn.
4.  Không tiếp tục điều chỉnh theo final test.
5.  Chạy rolling/anchored walk-forward trên nhiều cửa sổ thời gian.
6.  Báo cáo cả giai đoạn thị trường tăng, giảm, sideway và biến động cao
    nếu có dữ liệu đủ.
7.  Kiểm tra nhiều mã và nhiều timeframe; tránh chỉ báo cáo mã/giai đoạn
    đẹp nhất.
8.  Ghi lại số lượng thử nghiệm/param combinations để nhận diện nguy cơ
    overfitting.
9.  Thử độ nhạy với chi phí, slippage, funding và thay đổi tham số nhỏ.
10. Nếu mẫu quá nhỏ, nói rõ kết quả chưa đủ bằng chứng.

### Kết quả cần lưu

-   Bảng kết quả theo asset × timeframe × cấu hình.
-   Số lệnh và coverage.
-   Net PnL, PF, expectancy, drawdown, win rate và realized R.
-   Kết quả train/validation/test riêng.
-   Walk-forward windows và độ ổn định qua từng cửa sổ.
-   So sánh baseline với từng nhóm feature.
-   Danh sách thất bại, thị trường không phù hợp và giới hạn dữ liệu.

### Điều kiện hoàn tất

-   Không dùng kết quả trên dữ liệu tối ưu làm bằng chứng out-of-sample.
-   Không tuyên bố "độ chính xác X%" nếu chưa định nghĩa chính xác
    metric, mẫu, giai đoạn và quy trình kiểm định.
-   Nếu TradingView không cung cấp dữ liệu/điều kiện cần cho một phép
    kiểm định, ghi rõ giới hạn và đề xuất quy trình kiểm tra ngoài Pine
    thay vì bịa số liệu.

## Phase 7 --- Alerts và paper trading (P2)

-   Chuẩn hóa payload alert: project/version, symbol, exchange nếu biết,
    asset profile, timeframe, timestamp, side, score, eligibility,
    entry/SL/TP, RR và reason codes.
-   Có signal ID để tránh trùng lặp.
-   Phân biệt setup forming, bar-confirmed signal, entry event, exit
    event.
-   Alert không được ngụ ý đã khớp lệnh.
-   Paper trading phải ghi nhận giá tín hiệu, giá khớp giả định,
    phí/slippage giả định, exit reason và realized R.
-   Đối chiếu alert realtime với lịch sử; log missing/duplicate signals.
-   Không thêm chức năng gửi lệnh thật trong roadmap này.

## Phase 8 --- Hoàn thiện, tài liệu và phát hành phiên bản (P2)

-   Viết README về cách cài indicator, chọn profile, chọn TF, hiểu score
    và alert.
-   Viết changelog.
-   Có migration notes khi đổi tên từ `TM XAU Signals 2` sang
    `TM Indicator`.
-   Giữ bản baseline và cung cấp hướng rollback.
-   Phân biệt rõ: Static code review / Pine compile / historical
    backtest / out-of-sample / walk-forward / paper trading. Đây là các
    mức kiểm chứng khác nhau.
-   Tạo bảng Known Limitations.
-   Chỉ đánh dấu release candidate khi tất cả gate tương ứng đã đạt.

------------------------------------------------------------------------

## 6. Regression test checklist

AI phải cập nhật checklist và đánh dấu `PASS`, `FAIL`, `NOT TESTED`,
hoặc `BLOCKED` kèm bằng chứng.

### Tính toán

-   [ ] LONG và SHORT đối xứng hợp lý.
-   [ ] Entry, SL, TP không phải `na` khi kế hoạch được đánh dấu hợp lệ.
-   [ ] SL nằm đúng phía so với Entry.
-   [ ] TP nằm đúng phía so với Entry.
-   [ ] RR tính đúng cho từng target và hướng giao dịch.
-   [ ] RR threshold bằng 0, dưới ngưỡng, bằng ngưỡng và trên ngưỡng.
-   [ ] ATR bằng 0/na và lịch sử chưa đủ không tạo phép chia lỗi.
-   [ ] Score không vượt phạm vi thiết kế nếu phạm vi là 0--100.
-   [ ] No Trade có lý do.
-   [ ] Score cao không vượt qua risk gate.

### MTF và repaint

-   [ ] Context close/EMA được lấy từ cùng timeframe.
-   [ ] Setup close/EMA/features được lấy từ cùng timeframe.
-   [ ] Không so sánh close của chart TF với feature HTF như thể cùng TF
    nếu không chủ đích.
-   [ ] Kiểm tra chart TF nhỏ hơn, bằng và lớn hơn Setup TF.
-   [ ] Kiểm tra Context TF không cao hơn Setup TF theo chính sách được
    chọn.
-   [ ] Kiểm tra bar realtime chưa đóng và bar confirmed.
-   [ ] Kiểm tra tín hiệu sau reload để phát hiện thay đổi lịch sử.
-   [ ] Không dùng lookahead gây rò rỉ dữ liệu tương lai.

### Vòng đời trade

-   [ ] SL chạm trước TP.
-   [ ] TP chạm trước SL.
-   [ ] Cùng một nến chạm SL và TP.
-   [ ] TP1 rồi SL.
-   [ ] TP1, TP2 rồi TP3.
-   [ ] Timeout trước bất kỳ TP.
-   [ ] Timeout sau TP1/TP2.
-   [ ] Gap qua SL/TP.
-   [ ] Không đóng một trade hai lần.
-   [ ] Trade đang mở ở cuối dữ liệu được xử lý minh bạch.
-   [ ] Kết quả timeout không bị ghi nhầm là TP1/TP2/TP3.

### Profiles

-   [ ] XAU profile.
-   [ ] BTC profile.
-   [ ] ETH profile.
-   [ ] Liquid altcoin profile.
-   [ ] High-risk altcoin profile.
-   [ ] Unknown/Custom profile.
-   [ ] Crypto không tự động nhận trọng số session của XAU.
-   [ ] Thiếu volume/VWAP được xử lý minh bạch.
-   [ ] Giá/ATR/tick size khác nhau không làm hỏng ngưỡng tuyệt đối.

### Backtest / nghiên cứu

-   [ ] Indicator và Strategy Lab có quy tắc đồng bộ tín hiệu.
-   [ ] Phí và slippage được cấu hình/ghi rõ.
-   [ ] Partial exits được mô hình hóa đúng hoặc không được gọi là
    partial exits.
-   [ ] Không dùng final test để chọn tham số.
-   [ ] Có baseline và ablation.
-   [ ] Có walk-forward nhiều cửa sổ.
-   [ ] Báo cáo theo asset/timeframe, không chỉ gộp toàn bộ.
-   [ ] Ghi rõ số lệnh, giai đoạn dữ liệu và giới hạn.

------------------------------------------------------------------------

## 7. Cấu trúc file/artefact mong muốn

Tạo các artefact sau nếu môi trường repo hỗ trợ:

-   `TM XAU Signals 2.pine` --- bản gốc, giữ nguyên.
-   `TM Indicator.pine` --- indicator đa tài sản đã nâng cấp.
-   `TM Indicator Strategy Lab.pine` --- strategy riêng cho kiểm định.
-   `docs/indicator/tm-indicator/audit-baseline.md` --- audit code gốc và vị trí issue.
-   `docs/indicator/tm-indicator/architecture_indicator.md` --- kiến trúc module và luồng dữ liệu.
-   `docs/indicator/tm-indicator/asset-profiles.md` --- cấu hình từng nhóm tài sản/timeframe và quy tắc MTF.
-   `docs/indicator/tm-indicator/futures-risk-model.md` --- công thức, phí và giả định.
-   `docs/indicator/tm-indicator/ablation-walkforward-protocol.md` --- protocol nghiên cứu và metric.
-   `docs/indicator/tm-indicator/regression-checklist.md` --- test cases và trạng thái.
-   `CHANGELOG.md` --- thay đổi từng phase.
-   `docs/indicator/tm-indicator/known-limitations.md` --- giới hạn còn tồn tại.

Không bắt buộc phải tạo tất cả file ngay ở Phase 0. Hãy ưu tiên hoàn
thành đúng phase hiện tại trước, rồi mới mở rộng.

------------------------------------------------------------------------

## 8. Prompt thực thi cho AI coding agent

Sao chép toàn bộ phần dưới đây vào OpenCode/AI coding agent cùng với
file `TM XAU Signals 2.pine`.

### Vai trò

Bạn là Pine Script v6 engineer, code auditor và quantitative research
engineer. Nhiệm vụ là nâng cấp source hiện tại thành **TM Indicator**,
hệ thống phân tích đa tài sản/đa khung thời gian cho XAU, BTC, ETH và
altcoin trong bối cảnh Futures. Bạn phải ưu tiên correctness, dữ liệu
MTF đúng, khả năng giải thích, quản lý rủi ro và kiểm định ngoài mẫu.
Không hứa hẹn lợi nhuận.

### Quy tắc không được vi phạm

1.  Đọc toàn bộ source trước khi sửa.
2.  Không ghi đè bản gốc; tạo file/version mới.
3.  Thực hiện tuần tự theo Phase 0 → Phase 8 trong roadmap.
4.  Trước mỗi phase, liệt kê file sẽ thay đổi và rủi ro tương thích.
5.  Không thay đổi đồng thời quá nhiều nhóm logic trong một patch.
6.  Không tự ý xóa plots, labels, tables, inputs, alert conditions hoặc
    hành vi người dùng đang dựa vào mà không ghi migration note.
7.  Xác minh RR bug và MTF bug được mô tả trong phần audit; nếu source
    hiện tại khác, ghi lại bằng chứng và cập nhật kết luận.
8.  Không dùng dữ liệu tương lai, không dùng lookahead sai và không làm
    repaint để làm lịch sử đẹp hơn.
9.  Tách indicator và strategy. Tạo Strategy Lab riêng.
10. Không xem Signal Score 0--100 là xác suất thắng.
11. Không bê nguyên cấu hình/session của XAU sang crypto.
12. Không giả định funding, spread, fee, volume hay contract
    specification có sẵn nếu không có nguồn dữ liệu phù hợp.
13. Không đặt lệnh thật.
14. Không tuyên bố Pine compile/backtest đã thành công nếu chưa thực sự
    kiểm tra được. Đánh dấu rõ `PASS`, `FAIL`, `NOT TESTED`, `BLOCKED`
    và nêu bằng chứng.
15. Không tự bịa metrics, kết quả backtest, win rate, profit factor hoặc
    lợi nhuận.

### Thứ tự bắt buộc

**Bước A --- Audit** - Đọc hết file, tạo `docs/indicator/tm-indicator/audit-baseline.md`. - Ghi
line/section/function cho từng finding. - Phân loại P0/P1/P2 và phân
biệt lỗi chắc chắn với giả thuyết cần kiểm tra. - Không sửa code cho đến
khi có bản đồ logic và danh sách issue.

**Bước B --- Correctness patch** - Sửa và test RR/plan validity. - Sửa
MTF để close và indicators của một timeframe được lấy trong cùng
context. - Quy định confirmed HTF bars và realtime behavior. - Sửa state
machine, timeout reason, partial exit accounting và trade outcome. - Tạo
regression checklist và changelog. - Không thêm feature mới cho tới khi
các lỗi P0 được xử lý.

**Bước C --- Multi-asset profiles** - Thêm profile XAU/BTC/ETH/Liquid
Altcoin/High-Risk Altcoin/Custom. - Thêm timeframe profile và kiểm tra
thứ tự Context/Setup/Entry. - Chuẩn hóa thresholds bằng ATR%, relative
distance hoặc R-multiple khi phù hợp. - Crypto session neutral/off mặc
định cho tới khi được kiểm định. - Tạo `docs/indicator/tm-indicator/asset-profiles.md`.

**Bước D --- Score/eligibility** - Tách Signal Score, Trade Eligibility,
Risk Eligibility. - Giải thích score contributions và No Trade
reasons. - Tránh double-counting indicators. - Chỉ thêm probability nếu
có calibration và validation ngoài mẫu.

**Bước E --- Futures risk model** - Bắt đầu với linear USDT-margined
futures như một giả định được ghi rõ. - Xác định entry fill, fee,
slippage, spread, funding, position sizing, leverage/margin và
liquidation limitations. - Không tạo giả định ẩn. - Tạo
`docs/indicator/tm-indicator/futures-risk-model.md`.

**Bước F --- Strategy Lab** - Tạo `TM Indicator Strategy Lab.pine` với
`strategy()`. - Đồng bộ signal logic với indicator. - Có long/short
modes, exit rules, realistic configurable cost assumptions và thống
kê. - Nếu Pine không thể biểu diễn chính xác một phần mô hình, ghi rõ
limitation.

**Bước G --- Research validation** - Thiết kế baseline A, B, C, D, E như
trong roadmap. - Thiết lập chronological train/validation/test và
walk-forward. - Không tune trên final test. - Báo cáo metric theo từng
asset/timeframe và từng cửa sổ. - Nếu không thể chạy kiểm định trong môi
trường hiện tại, chỉ tạo protocol/checklist, không bịa kết quả.

**Bước H --- Paper alerts & documentation** - Chuẩn hóa alert payload và
signal IDs. - Không khẳng định alert là fill. - Viết README, changelog,
known limitations, regression results. - Không thêm real order
execution.

### Báo cáo sau mỗi phase

Trả về: 1. Tóm tắt thay đổi. 2. File đã tạo/sửa. 3. Issue đã fix và tham
chiếu line/function. 4. Test đã chạy và bằng chứng. 5. Test chưa chạy
hoặc bị block. 6. Rủi ro/giới hạn còn lại. 7. Đề xuất phase tiếp theo.

### Tiêu chí hoàn tất cuối cùng

Không gọi hệ thống là "đã chính xác" hoặc "có lợi nhuận" chỉ vì code
chạy hay backtest đẹp. Phân biệt rõ: - Static audit. - Pine compile. -
Historical backtest. - Out-of-sample. - Walk-forward. - Paper trading.

Chỉ báo cáo mức kiểm chứng đã thực sự hoàn thành, với phạm vi tài sản,
timeframe, giai đoạn, số lượng lệnh và giả định chi phí cụ thể.

------------------------------------------------------------------------

## 9. Quyết định đặt tên và versioning

### Khuyến nghị

-   Tên dự án/tên sản phẩm: **TM Indicator**.
-   Mô tả: **Multi-Asset Futures Analysis System**.
-   File indicator mới: `TM Indicator.pine` (nếu tên file có dấu cách
    không tiện cho toolchain, dùng `TM_Indicator.pine`).
-   File backtest: `TM Indicator Strategy Lab.pine` hoặc
    `TM_Indicator_Strategy_Lab.pine`.
-   Tên cũ `TM XAU Signals 2` chỉ giữ cho baseline và migration notes.

### Quy tắc version

-   Không ghi đè source gốc.
-   Mỗi phase có changelog.
-   Tăng version chỉ sau khi có test và nêu rõ trạng thái.
-   Không dùng tên `Final`, `Accurate`, `Proven` hoặc tương tự nếu chưa
    được kiểm định.

------------------------------------------------------------------------

## 10. Trạng thái ban đầu

-   [ ] Source gốc được đọc lại và đóng băng.
-   [ ] Audit đầy đủ được cập nhật theo source hiện tại.
-   [ ] RR logic đã xác minh.
-   [ ] MTF logic đã xác minh.
-   [ ] State machine đã xác minh.
-   [ ] Pine compile đã kiểm tra thực tế.
-   [ ] Strategy Lab đã tạo.
-   [ ] Backtest protocol đã tạo.
-   [ ] Out-of-sample/walk-forward đã thực hiện.
-   [ ] Paper trading đã thực hiện.

**Mặc định tất cả trạng thái trên là `NOT TESTED` cho tới khi AI agent
có bằng chứng trực tiếp.** Tài liệu này là roadmap và chỉ dẫn triển
khai, không phải báo cáo rằng các bước đã hoàn thành.
