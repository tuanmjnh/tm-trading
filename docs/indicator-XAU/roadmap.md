PHASE 0 — Định nghĩa sản phẩm
Trước khi code, tạo:
/docs
  architecture.md
  trading-rules.md
  timeframe-rules.md
  candle-patterns.md
  ai-contract.md
  risk-rules.md
  backtest-rules.md

Định nghĩa:
Symbol:
XAUUSDT

Primary:
M5 / M15

Context:
H1 / H4

Macro:
D / W / M

Mục tiêu ban đầu:
Không tự động đặt lệnh.

Chỉ:
Phân tích → tín hiệu → projection → lưu dữ liệu.

Sau khi hệ thống ổn định mới nghĩ đến execution.
PHASE 1 — Timeframe Engine
Không dùng một cấu hình cho tất cả.
Tạo:
M1
M5
M15
H1
H4
D
W
M

M5
Ưu tiên:
Liquidity
CHoCH
BOS
Displacement
Volume
Candle
ATR

M15
Structure
Trend
Liquidity
S/R
Volume
Momentum

H1
Trend
Structure
S/R
Liquidity

H4
Major Structure
Major S/R
Trend
Liquidity

D/W/M
Macro Trend
Major Structure
Major Zones
Market Regime

PHASE 2 — Market Structure Engine
Xây:
Swing High
Swing Low

HH
HL
LH
LL

BOS
CHoCH
MSS

Mỗi event phải có:
{
  "type": "BOS",
  "direction": "bullish",
  "timeframe": "M5",
  "price": 3342.5,
  "bar_index": 12345,
  "confirmed": true
}

Không chỉ vẽ lên chart.
Phải tạo structured data.
PHASE 3 — Liquidity Engine
Phát hiện:
PDH
PDL

PWH
PWL

Session High
Session Low

Equal High
Equal Low

Swing High
Swing Low

Sau đó:
Liquidity Sweep

Ví dụ:
PDL
─────────────────
        │
        │
        ▼
       sweep
        ▲
        │
        └── bullish reaction

Đây là một feature quan trọng cho M5.
PHASE 4 — Support / Resistance Engine
Không chỉ vẽ horizontal line.
Tạo Zone Engine.
Mỗi zone:
{
  "type": "resistance",
  "high": 3350.2,
  "low": 3347.8,
  "timeframe": "H4",
  "strength": 87,
  "touches": 4,
  "source": [
    "swing_high",
    "previous_day_high",
    "volume_cluster"
  ]
}

Sau đó gộp những vùng gần nhau.
PHASE 5 — Trendline Engine
Tự động tìm:
2-point trendline
3-point validated trendline

Chấm:
touchCount
slope
age
strength
breakout
retest

Ví dụ:
Trendline strength = 84/100

Quan trọng:
Trendline H4 phải có trọng số cao hơn trendline M5.

PHASE 6 — Candle Pattern Engine
Xây thư viện riêng.
Reversal
Pin Bar
Hammer
Shooting Star
Bullish Engulfing
Bearish Engulfing
Morning Star
Evening Star
Tweezer

Continuation
Inside Bar
Marubozu
Three Soldiers
Three Crows

Trading-specific
Đặc biệt xây:
Displacement Candle
Liquidity Sweep Candle
Failed Breakout
Breakout Candle
Rejection Candle

Mỗi pattern trả:
{
  "pattern": "bullish_engulfing",
  "direction": "bullish",
  "strength": 78,
  "body_ratio": 0.71,
  "volume_confirmation": true
}

PHASE 7 — Volume + Volatility + Momentum
Volume
Volume
Relative Volume
Volume MA
Volume Spike
OBV

Nếu data provider hỗ trợ:
Delta
CVD

Volatility
ATR
ATR%
ATR regime
Volatility expansion
Volatility contraction

Momentum
RSI
ROC
MACD
Stochastic

Nhưng momentum không được làm tín hiệu chính.
PHASE 8 — Session + News
Session:
Asia
London
New York
London/NY overlap

Feature:
session
session_high
session_low
session_open
session_range

News:
CPI
NFP
FOMC
PCE
Fed
GDP
Retail Sales

Có:
NEWS_RISK = HIGH

thì Risk Engine có thể:
NO TRADE

PHASE 9 — Scoring Engine
Đây là trái tim của hệ thống.
Ví dụ:
Trend             15
Structure         20
Liquidity         15
S/R               10
Candle            10
Volume             8
Volatility         7
Momentum           5
Session             5
MTF alignment      5
--------------------
TOTAL             100

Ví dụ:
0–49   NO TRADE
50–64  WEAK
65–74  SETUP
75–84  STRONG
85–100 A+

Nhưng trọng số phải configurable.
Không hard-code.
PHASE 10 — Scenario Engine
Không chỉ:
BUY

Mà:
LONG SCENARIO
SHORT SCENARIO
RANGE SCENARIO

Ví dụ:
{
  "scenario": "long",
  "probability": 0.68,
  "entry_zone": [3340, 3342],
  "invalidation": 3335,
  "targets": [3348, 3354, 3362]
}

PHASE 11 — AI Layer
Đây là nơi kết hợp nhiều provider.
Kiến trúc:
AI Router
│
├── Provider A
├── Provider B
├── Provider C
└── Local Model

Không khóa hệ thống vào một provider.
AI có 4 nhiệm vụ:
AI Macro Analyst
W/D/H4

AI Intraday Analyst
H1/M15

AI Entry Analyst
M15/M5

AI Risk/Contrarian
Tìm lý do không nên trade.
PHASE 12 — Database + Backtest + Learning
Lưu mọi setup, kể cả setup không vào lệnh.
Ví dụ:
signal_id
timestamp
symbol
timeframe

features
score

scenario
AI responses

entry
SL
TP

result
MFE
MAE

market regime
session
news

Sau đó thống kê:
Pattern
+
Liquidity
+
Session
+
Trend
+
Timeframe

→ Win rate.
Ví dụ:
PDL Sweep
+ Bullish CHoCH
+ M15 bullish
+ NY
+ Volume > 1.5x

Samples: 842

Win rate: 68.4%
Average R: 1.37

Đây mới là cách chứng minh một setup có edge.
IV. Market Map / Projection
UI cuối cùng nên hiển thị:
                 XAUUSDT M5

       H4 RESISTANCE
████████████████████████

                 ╭──── TP2
             ╭───╯
          ╭──╯
       ╭──╯ TP1
      ●
    ENTRY
      │
      │
      ● Sweep
████████████████████████
       H4 SUPPORT

Trend       ↑
Structure   Bullish
Liquidity   PDL swept

Score       87/100
AI          81%
Risk        Medium

Đường nét đứt là:
Scenario projection

không phải “giá chắc chắn sẽ đi theo đường này”.