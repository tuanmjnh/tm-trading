Có 5 nguyên tắc mình muốn AI code phải tuân thủ.
1. Rule Engine là nguồn dữ liệu gốc
AI không tự tính lại dữ liệu thị trường nếu hệ thống đã cung cấp.
Ví dụ:
{
  "rsi": 67.2,
  "atr": 3.82,
  "volume_ratio": 1.74,
  "m15_trend": "bullish"
}

AI phải sử dụng các giá trị này.
Không được tự suy đoán:
"Có vẻ RSI khoảng 70."

2. AI không được tạo tín hiệu từ không khí
AI chỉ đánh giá:
DATA
 ↓
ANALYSIS
 ↓
SCENARIO
 ↓
CONFIDENCE

Không:
CHART
 ↓
AI đoán
 ↓
BUY

3. Không repaint
Đặc biệt:
- pivot
- BOS
- CHoCH
- trendline
- liquidity sweep
- projected path
phải phân biệt:
CONFIRMED
vs
FORMING

4. Backtest phải dùng dữ liệu tại thời điểm đó
Không được để:
Signal lúc 10:00

nhìn thấy:
giá lúc 10:05

Đây là lỗi cực kỳ nguy hiểm khi xây hệ thống trading.
5. AI không có quyền vượt Risk Engine
Nếu AI:
LONG 95%

nhưng:
RR = 0.6
H4 resistance quá gần

thì:
NO TRADE

vẫn phải thắng.