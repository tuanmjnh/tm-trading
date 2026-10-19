# TM Fusion Zones --- Roadmap triển khai hệ thống phân tích đa tài sản trên TradingView

**Tên dự án:** TM Fusion Zones\
**Tên kỹ thuật:** `TM-FZ`\
**Phiên bản tài liệu:** Roadmap v1.0\
**Nền tảng mục tiêu:** TradingView Pine Script v6\
**Định hướng:** Indicator phân tích xu hướng + vùng cung cầu/hỗ trợ
kháng cự + xác nhận Price Action + tín hiệu LONG/SHORT + quản lý rủi
ro + dashboard.

> **Lưu ý:** Đây là thiết kế một hệ thống mới lấy cảm hứng từ đặc điểm
> quan sát được trong ảnh tham khảo. Chưa xác định được tên hoặc mã
> nguồn indicator trong ảnh, vì vậy roadmap này không khẳng định sao
> chép chính xác chỉ báo đó. Mọi quy tắc và hiệu quả phải được kiểm thử;
> không gọi score là xác suất thắng nếu chưa hiệu chuẩn thống kê.

## 1. Mục tiêu sản phẩm

Xây dựng indicator Pine Script v6 có thể: 1. Hiển thị Trend Ribbon gồm
hai đường xu hướng và vùng tô. 2. Phát hiện vùng cung cầu/hỗ trợ kháng
cự. 3. Tạo tín hiệu LONG và SHORT theo logic cân bằng. 4. Kết hợp Price
Action/Market Structure để xác nhận tại vùng giá. 5. Tính Entry, Stop
Loss (SL), Take Profit (TP1/TP2/TP3), RR trước và sau chi phí ước tính.
6. Hỗ trợ XAUUSD, BTC, ETH và crypto khác qua asset profiles. 7. Có
dashboard giải thích tín hiệu và lý do No Trade. 8. Có alert và quy
trình kiểm thử không repaint/hiệu quả ngoài mẫu.

Không cam kết winrate/lợi nhuận; không tự động gửi lệnh thật trong phiên
bản indicator đầu tiên; không khẳng định nhận diện đúng indicator trong
ảnh; không thêm chỉ báo trùng lặp chỉ để tăng điểm.

## 2. Kiến trúc tổng quát

``` text
Price/Volume
  -> Asset Profile + Market Regime
  -> Trend Ribbon + HTF Bias
  -> Supply/Demand Zones + S/R
  -> Market Structure + Liquidity + Price Action
  -> LONG/SHORT Setup Engine
  -> Risk/RR Gate + Setup Quality Score
  -> Signal Decision
  -> Chart Renderer + Dashboard + Alerts
  -> Separate Strategy Lab + Validation
```

Cấu trúc repository gợi ý:

``` text
tm-fusion-zones/
├─ README.md
├─ ROADMAP.md
├─ CHANGELOG.md
├─ pine/
│  ├─ src/tm_fz_main.pine
│  └─ dist/tm_fusion_zones.pine
├─ tests/
│  ├─ manual-test-matrix.md
│  ├─ regression-checklist.md
│  └─ backtest-protocol.md
└─ docs/
   ├─ design-decisions.md
   ├─ signal-rules.md
   └─ known-limitations.md
```

**Lưu ý Pine:** Pine Script không hỗ trợ import file local tùy ý như
nhiều ngôn ngữ khác. Chỉ tách module nếu repository có bundler đã kiểm
chứng; nếu không, dùng một file Pine có section rõ ràng. Không giả định
`#include`/import cục bộ tự hoạt động.

## 3. Các module chính

### 3.1 Trend Ribbon

-   Hai đường trung bình có thể cấu hình (EMA/HMA hoặc lựa chọn đã kiểm
    thử).
-   Vùng tô thể hiện Bull/Bear/Neutral.
-   Tùy chọn độ dài, màu, độ dày và bật/tắt.
-   Ribbon chỉ lọc hướng, không tự động là tín hiệu vào lệnh.
-   Không giả định đường trong ảnh chính xác là EMA/HMA.

### 3.2 Zone Engine

Triển khai theo thứ tự: 1. Pivot zones từ swing high/low đã xác nhận. 2.
Impulse-origin zones sau khi baseline ổn định. 3. HTF zones. 4.
PDH/PDL/PWH/PWL như mức tham chiếu riêng.

Mỗi zone cần quản lý `top`, `bottom`, `createdBar`, `sourceTF`, `type`,
`touchCount`, `isBroken` và trạng thái. Pivot chỉ được sử dụng sau khi
xác nhận đủ nến bên phải; ghi rõ độ trễ. Có gộp vùng gần nhau, giới hạn
số lượng và dọn object cũ. Không dùng dữ liệu tương lai.

### 3.3 Market Structure & Liquidity

Triển khai lần lượt: - Swing high/low đã xác nhận. - BOS. - CHoCH nếu
định nghĩa rõ. - Sweep swing/PDH/PDL và nến đóng trở lại. - Displacement
so với ATR nếu kiểm thử có ích. - FVG/Order Block là tùy chọn nâng cao,
mặc định tắt.

Mỗi khái niệm phải có định nghĩa định lượng trong
`docs/indicator/TM Fusion Zones/signal-rules.md`.

### 3.4 Ba setup vào lệnh

Mỗi setup bật/tắt độc lập để ablation testing.

**Trend Pullback** - HTF bias cùng hướng. - Giá hồi về ribbon hoặc zone
phù hợp. - Có xác nhận price action. - Không vào nếu giá quá xa vùng
hoặc RR không đạt.

**Liquidity Sweep Reversal** - Quét swing/PDH/PDL đã định nghĩa. - Nến
đóng trở lại vùng/mức. - Có xác nhận đảo chiều; không vào chỉ vì wick
quét. - Đo hiệu quả riêng khi thuận/ngược HTF.

**Range / Mean Reversion** - Chỉ bật khi regime detector đánh giá thị
trường đi ngang. - Vào gần biên vùng với xác nhận từ chối giá. - Không
áp dụng máy móc trong xu hướng mạnh.

Mỗi tín hiệu phải ghi `setupType`.

### 3.5 LONG/SHORT cân bằng

Tách riêng: - `longSetupDetected`, `shortSetupDetected` - `longScore`,
`shortScore` (0--100) - `longEligible`, `shortEligible` -
`longBlockReason`, `shortBlockReason` - Entry/SL/TP riêng cho từng
hướng.

Không lấy `100 - longScore` làm SHORT score nếu các yếu tố không đối
xứng. Kiểm thử chart tăng, giảm, sideway; đếm setup phát hiện, bị chặn
theo lý do và tín hiệu cuối theo hướng.

## 4. Score, bộ lọc và rủi ro

### 4.1 Ba lớp quyết định

1.  **Setup detection:** mẫu hình có xuất hiện không?
2.  **Setup quality score:** mức phù hợp tương đối theo các yếu tố đã
    định nghĩa.
3.  **Trade eligibility:** điều kiện rủi ro, RR, regime và chi phí có
    đạt không?

Điểm số cao không được vượt qua điều kiện rủi ro bắt buộc.

### 4.2 Nhóm điểm ban đầu

-   Trend/HTF context.
-   Vị trí tại zone.
-   Structure/liquidity.
-   Price-action confirmation.
-   Regime suitability.

Trọng số ban đầu chỉ là giả thuyết. Không cộng điểm đầy đủ cho EMA, MACD
và oscillator nếu chúng cùng phản ánh xu hướng/động lượng. Hiển thị
`Setup quality: 76/100`, không hiển thị `76% win probability`.

### 4.3 Risk & RR gate

-   LONG: SL thường dưới Entry; SHORT: SL thường trên Entry.
-   RR = khoảng cách từ Entry đến mục tiêu / khoảng cách từ Entry đến
    SL.
-   Tách RR TP1/TP2/TP3; không kiểm tra RR TP1 bằng ngưỡng áp dụng cho
    TP2.
-   Kiểm tra vùng cản gần nhất, spread, commission và slippage theo cấu
    hình.
-   Không tạo tín hiệu nếu SL không hợp lệ hoặc RR tối thiểu không đạt.
-   Kiểm thử tránh lỗi mặc định chặn toàn bộ tín hiệu do threshold không
    khớp mục tiêu.

Futures: không mặc định leverage làm giảm rủi ro. Liquidation, funding
và maintenance margin tùy sàn cần được ghi rõ là giới hạn nếu chưa mô
hình hóa.

## 5. MTF và asset profiles

### MTF

-   Chart timeframe, Setup timeframe và Context/Bias timeframe tùy chọn.
-   Không so sánh giá chart timeframe với EMA HTF rồi gọi đó là điều
    kiện HTF tương thích nếu chưa định nghĩa rõ.
-   Mặc định dùng HTF đã xác nhận/non-repainting.
-   Kiểm tra `request.security`, `lookahead` và thời điểm xác nhận.
-   Ghi rõ chế độ intrabar có thể thay đổi trước khi nến đóng.

### Asset profiles

-   XAUUSD: phiên, spread và biến động tùy nhà cung cấp.
-   BTC/ETH: giao dịch 24/7; không mặc định dùng phiên vàng.
-   Altcoins: chú ý thanh khoản và spread.
-   Có `Auto / XAU / BTC / ETH / Crypto Other / Custom`, với fallback rõ
    ràng.
-   Không hardcode khiến script chỉ chạy trên một symbol.

## 6. Giao diện và dashboard

### Simple mặc định

-   Trend Ribbon.
-   Các zone quan trọng với giới hạn số lượng.
-   Nhãn LONG/SHORT khi đủ điều kiện.
-   Entry, SL, TP1/TP2/TP3.
-   Màu và legend nhất quán.

### Advanced

-   Swing, BOS/CHoCH, liquidity sweeps, HTF zones.
-   Chi tiết điểm thành phần và lý do bị chặn.
-   FVG/Order Block tùy chọn.
-   Debug labels.

### Dashboard tối thiểu

-   Asset/profile và timeframe.
-   HTF Bias: Bull/Bear/Neutral.
-   Regime: Trend/Range/Unclear.
-   Setup type.
-   LONG/SHORT score.
-   Signal state: LONG/SHORT/WAIT/NO TRADE.
-   Entry, SL, TP1/TP2/TP3 và RR từng mục tiêu.
-   Block reason: No setup, HTF conflict, No confirmation, RR too low,
    SL invalid, Overextended, Regime mismatch.
-   Trạng thái Confirmed/Intrabar.

Cho phép compact mode, vị trí dashboard và bật/tắt thành phần.

## 7. Alerts

-   LONG setup confirmed.
-   SHORT setup confirmed.
-   Tín hiệu bị chặn (debug, tùy chọn).
-   Zone created/broken (tùy chọn).
-   Alert gồm symbol, timeframe, hướng, setup type, Entry/SL/TP và
    score.
-   Chọn bar-close hoặc intrabar rõ ràng; chống phát lặp.
-   Không tuyên bố lệnh đã được khớp trên sàn.

## 8. Kế hoạch triển khai

### Phase 0 --- Audit và baseline

-   Audit repository, Pine version, giới hạn object, MTF, alert,
    build/test.
-   Lưu baseline và chart test cho XAU/BTC/ETH.
-   Ghi giả định/rủi ro.
-   **Done:** có báo cáo thật; không bịa trạng thái test.

### Phase 1 --- Trend Ribbon

-   Hai đường, vùng tô, Bull/Bear/Neutral, inputs.
-   **Done:** compile; kiểm tra tăng/giảm/sideway và đổi inputs.

### Phase 2 --- Zone Engine

-   Pivot zones, touch/break state, source timeframe, merge/limit zones.
-   **Done:** không dùng pivot chưa xác nhận; không vượt quota object.

### Phase 3 --- Structure/Liquidity

-   Swing, BOS, CHoCH tùy chọn, sweep, displacement tùy chọn.
-   **Done:** mỗi nhãn có định nghĩa và test case; không dùng dữ liệu
    tương lai.

### Phase 4 --- LONG/SHORT Setup Engine

-   Ba setup độc lập, Entry/SL/TP và block reason theo hướng.
-   **Done:** test xu hướng tăng, giảm, sideway; không có score/RR bug
    thiên lệch.

### Phase 5 --- Risk/RR/MTF

-   RR từng TP, obstacle distance, confirmed HTF, cost assumptions.
-   **Done:** tính toán kiểm tra thủ công được; RR gate không chặn toàn
    bộ ngoài ý muốn; MTF đúng timeframe.

### Phase 6 --- Score/Dashboard

-   Score minh bạch, chống double-counting, Simple/Advanced, No Trade
    reasons.
-   **Done:** người dùng hiểu vì sao có/không có tín hiệu; score không
    gọi là win probability.

### Phase 7 --- Alerts/performance

-   Alerts, chống lặp, tối ưu object/MTF.
-   **Done:** alert khớp chart; không spam ngoài thiết kế.

### Phase 8 --- Strategy Lab/validation

Tạo `strategy()` riêng; không coi indicator là backtest. - Khai báo
commission/slippage và quy tắc khớp lệnh. - Báo cáo LONG/SHORT và từng
setup riêng. - In-sample, out-of-sample, walk-forward, ablation
testing. - Chỉ số: số lệnh, win rate, net expectancy, profit factor, max
drawdown, average win/loss, theo hướng/setup/asset, độ nhạy tham số. -
**Done:** kết quả tái lập, có mẫu ngoài tập tối ưu, ghi rõ giới hạn dữ
liệu.

## 9. Test và regression checklist

### Compile/UI

-   [ ] Pine v6 compile.
-   [ ] Default inputs chạy được.
-   [ ] Thử các tổ hợp input quan trọng.
-   [ ] Object count trong giới hạn; object cũ được dọn.
-   [ ] Dashboard đúng trên nhiều timeframe.

### LONG/SHORT

-   [ ] Có test LONG khi điều kiện tăng phù hợp.
-   [ ] Có test SHORT khi điều kiện giảm phù hợp.
-   [ ] Hai hướng đều bị chặn đúng khi RR/SL không đạt.
-   [ ] Score mapping không thiên lệch.
-   [ ] Block reason đúng.
-   [ ] Entry/SL/TP và RR đúng từng hướng.

### MTF/non-repaint

-   [ ] HTF values đúng timeframe.
-   [ ] Confirmed HTF không dùng nến HTF chưa đóng.
-   [ ] Kiểm tra sau reload và đổi timeframe/symbol.
-   [ ] Pivot có độ trễ xác nhận rõ.
-   [ ] Alert bar-close khớp tín hiệu.

### Validation

-   [ ] Phí và slippage được áp dụng.
-   [ ] LONG/SHORT báo cáo riêng.
-   [ ] Setup type báo cáo riêng.
-   [ ] Có out-of-sample.
-   [ ] Không tuyên bố hiệu suất nếu chưa có kết quả.

## 10. Prompt cho AI coding agent

Sao chép prompt dưới đây vào OpenCode hoặc agent coding sau khi mở đúng
repository:

``` text
Bạn là Senior Pine Script v6 Engineer và Quant Research Engineer. Hãy triển khai TM Fusion Zones theo ROADMAP.md.

BẮT BUỘC:
1. Audit repository, Pine files, build/test scripts và tài liệu trước khi sửa.
2. Không xóa/ghi đè bản đang dùng; tạo file/nhánh mới và giữ baseline.
3. Không tuyên bố compile/backtest/test nếu chưa thực sự chạy được.
4. Pine không hỗ trợ import file local tùy ý. Chỉ dùng module riêng nếu có bundler đã kiểm chứng; nếu không, dùng một file Pine có section rõ ràng.
5. Triển khai theo phase, compile và kiểm tra từng phase trước khi tiếp tục.
6. Tách LONG/SHORT score, eligibility và block reason; kiểm tra thiên lệch hướng.
7. Tách setup detection, setup quality score và risk eligibility.
8. Không gọi score là win probability, không hứa winrate/lợi nhuận.
9. MTF mặc định dùng dữ liệu đã xác nhận/non-repainting; kiểm tra request.security/lookahead.
10. Không setup hoặc risk gate fail thì NO TRADE, kèm lý do.
11. Không cộng điểm trùng lặp cho các indicator tương quan; dùng ablation testing.
12. Không tự động giao dịch live. Indicator/alerts và Strategy Lab phải tách riêng.

THỨ TỰ:
A. Audit/baseline
B. Trend Ribbon
C. Zone Engine
D. Structure/Liquidity
E. LONG/SHORT Setup Engine
F. Risk/RR/MTF
G. Score/Dashboard
H. Alerts
I. Strategy Lab/validation

Mỗi phase:
- Nêu file sửa/tạo và giả định.
- Viết code.
- Chạy build/test có thật trong môi trường.
- Nếu không có Pine compiler/backtest trong môi trường, nói rõ và tạo checklist thủ công; không bịa kết quả.
- Cập nhật ROADMAP.md/CHANGELOG.md với TODO, IN_PROGRESS, BLOCKED hoặc DONE.
- Không đánh dấu DONE nếu chưa đạt tiêu chí nghiệm thu.

ĐẦU RA:
- Pine Script v6.
- signal-rules, limitations, test matrix và regression checklist.
- Strategy Lab riêng nếu phù hợp.
- Báo cáo test thật, lỗi còn tồn tại và bước người dùng cần làm trên TradingView.
```

## 11. Đề xuất versioning

-   `v0.1`: Trend Ribbon baseline.
-   `v0.2`: Zone Engine.
-   `v0.3`: Structure/Liquidity.
-   `v0.4`: LONG/SHORT setups.
-   `v0.5`: Risk/MTF.
-   `v0.6`: Dashboard/Alerts.
-   `v0.9`: Validation candidate.
-   `v1.0`: chỉ phát hành sau compile, regression và validation theo
    tiêu chí; không có nghĩa là chắc chắn sinh lời.

## 12. Những quyết định cần chốt

1.  Symbol/sàn mục tiêu đầu tiên.
2.  Timeframe giao dịch chính.
3.  Bar-close hay intrabar.
4.  RR tối thiểu và cách chọn SL.
5.  Chi phí giao dịch cần mô hình hóa.
6.  Xây dựng độc lập hay tích hợp mã nguồn TM Indicator hiện tại.
7.  Repository có bundler thật hay không.

Nếu chưa có câu trả lời, agent chọn mặc định an toàn, ghi rõ vào
`docs/indicator/TM Fusion Zones/design-decisions.md`, không tuyên bố thông số đó là tối ưu.

## 13. Kết luận

TM Fusion Zones là hệ thống **Trend + Zones + Price Action + Risk** lấy
cảm hứng từ ảnh tham khảo, không phải khẳng định về mã nguồn chỉ báo
trong ảnh. Giá trị cốt lõi là quy tắc rõ ràng, LONG/SHORT cân bằng, MTF
đúng, risk gate hợp lệ, giao diện dễ đọc và kiểm chứng bằng dữ liệu
ngoài mẫu.
