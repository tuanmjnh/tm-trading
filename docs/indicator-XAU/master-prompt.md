# ROLE

You are the lead software architect and senior quantitative trading-system engineer.

Build a production-quality, modular market-analysis system for XAUUSDT using TradingView/Pine Script as the market-data and visualization layer, a backend API as the orchestration layer, configurable AI providers as analysis assistants, and a database for signals, outcomes, backtesting, and statistical analysis.

The system is an ANALYSIS and RESEARCH system first. It must NOT automatically place real trades.

The primary trading timeframes are M5 and M15.

Higher timeframes are used as context:

- H1
- H4
- D
- W
- M

Optional lower timeframe:

- M1

# CORE PRINCIPLES

1. Never repaint confirmed historical signals.
2. Never use future candles in historical calculations.
3. Clearly distinguish FORMING and CONFIRMED signals.
4. Rules and deterministic calculations are the source of market data.
5. AI must analyze supplied structured data and must not invent missing indicators.
6. AI cannot override the Risk Engine.
7. Every signal must be reproducible from stored historical data.
8. Every important parameter must be configurable.
9. Timeframe-specific configuration must be supported.
10. The system must be designed for backtesting from the beginning.
11. Do not optimize parameters using future/out-of-sample data.
12. Do not claim that a signal guarantees profit.

# SYSTEM MODULES

Implement the system as independent modules:

1. Timeframe Engine
2. Market Structure Engine
3. Liquidity Engine
4. Support/Resistance Engine
5. Trendline Engine
6. Candle Pattern Engine
7. Volume Engine
8. Volatility Engine
9. Momentum Engine
10. Session Engine
11. News Risk Engine
12. Feature Engine
13. Scoring Engine
14. Scenario Engine
15. Projection Engine
16. AI Router
17. AI Analyst modules
18. Risk Engine
19. Signal Logger
20. Backtest Engine
21. Statistics Engine
22. Configuration Engine
23. Visualization/UI layer

# TIMEFRAME ARCHITECTURE

Use hierarchical analysis:

Macro:
W → D → H4

Context:
H1 → M15

Execution:
M5 → optional M1

M5/M15 must not independently override a strong higher-timeframe context without explicitly labeling the setup as counter-trend.

Create separate configuration profiles for:

M1
M5
M15
H1
H4
D
W
M

Do not use one universal configuration.

# MARKET STRUCTURE

Detect:

- Swing High
- Swing Low
- HH
- HL
- LH
- LL
- BOS
- CHoCH
- MSS

Every structure event must contain:

- timestamp
- timeframe
- price
- direction
- event type
- confirmation state
- source bar
- strength

Never use future information to confirm a historical event incorrectly.

# LIQUIDITY

Detect:

- Previous Day High
- Previous Day Low
- Previous Week High
- Previous Week Low
- Session High
- Session Low
- Equal High
- Equal Low
- Swing High liquidity
- Swing Low liquidity
- Liquidity Sweep
- Failed Breakout

Store each liquidity event as structured data.

# SUPPORT AND RESISTANCE

Build dynamic zones rather than single-price lines.

Each zone should contain:

- upper price
- lower price
- timeframe
- strength
- touch count
- age
- source
- status
- distance from current price

Merge nearby zones intelligently.

Higher timeframe zones must receive higher contextual weight than lower timeframe zones.

# TRENDLINES

Automatically detect:

- bullish trendlines
- bearish trendlines
- support trendlines
- resistance trendlines

Calculate:

- slope
- touch count
- age
- strength
- breakout status
- retest status

Do not treat every two random points as a strong trendline.

# CANDLE PATTERN ENGINE

Implement configurable pattern detection for:

Reversal:
- Pin Bar
- Hammer
- Shooting Star
- Bullish Engulfing
- Bearish Engulfing
- Morning Star
- Evening Star
- Tweezer Top
- Tweezer Bottom

Continuation:
- Inside Bar
- Marubozu
- Three White Soldiers
- Three Black Crows

Trading-specific:
- Displacement Candle
- Liquidity Sweep Candle
- Failed Breakout Candle
- Breakout Candle
- Rejection Candle

Do not use candle patterns as independent buy/sell signals.

They are features that contribute to the overall score.

# VOLUME

Support:

- Volume
- Volume Moving Average
- Relative Volume
- Volume Spike
- OBV

If the selected data provider supports them, allow:

- Delta
- CVD

# VOLATILITY

Implement:

- ATR
- ATR percentage
- volatility regime
- volatility expansion
- volatility contraction

ATR must be timeframe-specific.

Do not use a universal fixed stop distance.

# MOMENTUM

Support:

- RSI
- MACD
- ROC
- Stochastic

Momentum indicators are confirmation features, not standalone signals.

# SESSION ENGINE

Support:

- Asian session
- London session
- New York session
- London/New York overlap

Track:

- session open
- session high
- session low
- session range

# NEWS RISK

Support high-impact macro events such as:

- CPI
- NFP
- FOMC
- PCE
- Fed decisions
- GDP
- Retail Sales
- unemployment data

Expose:

- event
- event time
- expected impact
- time until event
- post-event cooldown

The Risk Engine may block signals during configurable high-risk periods.

# FEATURE ENGINE

Normalize all technical information into a consistent feature schema.

Example:

{
  symbol,
  timestamp,
  timeframe,

  trend,
  market_regime,

  structure,
  liquidity,
  support_resistance,
  trendlines,

  candle_patterns,
  volume,
  volatility,
  momentum,

  session,
  news_risk,

  higher_timeframe_context
}

Every feature must include enough metadata to reproduce its calculation.

# SCORING ENGINE

Create a configurable 0-100 score.

Suggested categories:

- Trend
- Structure
- Liquidity
- Support/Resistance
- Candle
- Volume
- Volatility
- Momentum
- Session
- Multi-timeframe alignment

Initial thresholds may be:

0-49 = NO TRADE
50-64 = WEAK
65-74 = SETUP
75-84 = STRONG
85-100 = A+

These values are placeholders and MUST be backtested before being considered valid.

Never hard-code scoring weights.

# SCENARIO ENGINE

Generate at least:

- LONG
- SHORT
- RANGE/NO TRADE

Each scenario should include:

- probability/confidence estimate
- entry zone
- invalidation level
- TP1
- TP2
- optional TP3
- expected R:R
- supporting factors
- opposing factors

Do not present scenario probability as guaranteed statistical probability unless it has been empirically calibrated.

Distinguish:

MODEL SCORE

from

EMPIRICAL PROBABILITY.

# PROJECTION ENGINE

Create projected price paths for visualization.

A projected path is a scenario, not a guaranteed prediction.

Support:

- bullish path
- bearish path
- range path

Projection must be generated only from information available at the current bar.

Never use future data.

Historical projections must remain unchanged during backtesting once the signal timestamp has passed.

# AI ARCHITECTURE

Create an AI Router supporting multiple providers.

The provider interface should be generic.

Example:

AIProvider:
- name
- model
- analyze()
- healthCheck()
- tokenCost()
- latency()

Do not hard-code the application to one provider.

Support future providers and local models.

# AI ROLES

Implement separate logical AI roles:

1. Macro Analyst

Input:
W/D/H4

Output:
- market regime
- macro bias
- major support
- major resistance
- major risks

2. Intraday Analyst

Input:
H1/M15

Output:
- intraday bias
- structure
- liquidity
- setup quality

3. Entry Analyst

Input:
M15/M5

Output:
- entry quality
- trigger
- invalidation
- TP levels
- opposing evidence

4. Contrarian/Risk Analyst

Its primary task is to find reasons NOT to trade.

5. Consensus Engine

Combine AI opinions with deterministic system data.

AI must never override deterministic risk restrictions.

# AI INPUT CONTRACT

Send structured JSON rather than relying exclusively on screenshots.

Example:

{
  "symbol": "XAUUSDT",
  "timestamp": "...",
  "execution_timeframe": "M5",

  "macro": {},
  "context": {},
  "execution": {},

  "features": {},
  "zones": {},
  "trendlines": {},
  "liquidity": {},
  "candles": {},
  "volume": {},
  "volatility": {},
  "session": {},
  "news": {},

  "score": 87
}

AI must never invent unavailable values.

If information is missing, return:

"unknown"

rather than guessing.

# AI OUTPUT CONTRACT

Return strict JSON:

{
  "decision": "LONG | SHORT | NO_TRADE",
  "confidence": 0,
  "setup_quality": 0,

  "entry": {
    "low": 0,
    "high": 0
  },

  "invalidation": 0,

  "targets": [],

  "risk_reward": 0,

  "supporting_factors": [],
  "opposing_factors": [],

  "market_regime": "",
  "reasoning_summary": "",

  "data_quality": "HIGH | MEDIUM | LOW"
}

Never return executable trading commands.

# RISK ENGINE

Risk Engine has final authority.

It must consider:

- stop distance
- ATR
- nearby higher-timeframe resistance/support
- R:R
- volatility
- news risk
- spread/data quality if available
- counter-trend status
- maximum daily risk
- maximum consecutive losses

Possible final states:

TRADE_CANDIDATE
LOW_QUALITY
NO_TRADE
BLOCKED_BY_RISK

# DATABASE

Persist:

- raw market features
- detected structures
- liquidity events
- zones
- trendlines
- patterns
- scores
- AI inputs
- AI outputs
- final scenario
- projected path
- entry
- SL
- TP
- result
- MFE
- MAE
- market regime
- session
- news state

Every signal must have a unique ID.

# BACKTESTING

Backtesting must be designed from the beginning.

Measure:

- Win Rate
- Loss Rate
- Profit Factor
- Expectancy
- Average R
- Maximum Drawdown
- Maximum Consecutive Losses
- MFE
- MAE
- Long performance
- Short performance
- Session performance
- Timeframe performance
- Pattern performance
- Market-regime performance

Prevent:

- look-ahead bias
- repainting
- survivorship bias
- future leakage
- data leakage

Separate:

Training
Validation
Out-of-Sample
Forward Test

# STATISTICAL EDGE DISCOVERY

After collecting sufficient historical data, calculate performance of combinations such as:

Liquidity Sweep
+
CHoCH
+
Higher-timeframe alignment
+
Volume confirmation
+
Session

Do not assume a setup has an edge.

Measure it.

Store sample count with every statistic.

Never display a percentage without sample size.

Example:

"Win Rate: 68.4% (n=842)"

is preferable to:

"Win Rate: 68.4%"

# VISUALIZATION

TradingView should display:

- trendlines
- support zones
- resistance zones
- liquidity levels
- BOS
- CHoCH
- entry zones
- SL
- TP
- projected scenarios
- score
- market regime

Use different visual states for:

CONFIRMED
FORMING
PROJECTED

Never visually imply that projected paths are actual future prices.

# DEVELOPMENT ORDER

Implement in this exact order:

Phase 1:
Project skeleton and configuration

Phase 2:
Timeframe engine

Phase 3:
Market structure

Phase 4:
Liquidity

Phase 5:
Support/resistance

Phase 6:
Trendlines

Phase 7:
Candle patterns

Phase 8:
Volume/volatility/momentum

Phase 9:
Feature engine

Phase 10:
Scoring

Phase 11:
Scenario/projection

Phase 12:
Backtesting

Phase 13:
Database/statistics

Phase 14:
AI Router

Phase 15:
AI analysts

Phase 16:
Consensus

Phase 17:
Dashboard/Market Map

Phase 18:
Paper trading/forward testing

Do not skip directly to AI.

# CODING RULES

Before implementing each phase:

1. Explain architecture.
2. Define interfaces/types.
3. Implement the smallest working version.
4. Add tests.
5. Verify no repaint/look-ahead.
6. Document configuration.
7. Only then continue.

Do not rewrite unrelated modules.

Do not create fake APIs.

Do not invent unavailable market data.

Do not silently change trading logic.

When a requirement is ambiguous, choose the safest deterministic interpretation and document it.

# FINAL OBJECTIVE

The final system should answer:

1. What is the macro market regime?
2. What is the higher-timeframe bias?
3. Where are important support/resistance zones?
4. Where is liquidity?
5. What structure is forming?
6. What candle/volume/volatility evidence exists?
7. Is there a valid setup?
8. What are LONG/SHORT/RANGE scenarios?
9. Where are entry/invalidation/targets?
10. What is the estimated setup quality?
11. What reasons argue against the trade?
12. What does historical data say about this exact setup?
13. Should the system display TRADE CANDIDATE or NO TRADE?

The system must prioritize reproducibility, statistical validation, risk control, and avoidance of future-data leakage over visual complexity or impressive AI predictions.