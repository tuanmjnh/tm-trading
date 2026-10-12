# TASK: Upgrade the XAUUSDT Trading Analysis System with a Quantitative Research and Indicator Validation Framework

You are a senior quantitative developer working on an existing modular XAUUSDT M5/M15 trading-analysis system.

Do not rewrite the entire project. Inspect the existing implementation and integrate the following features without breaking existing modules.

## 1. Price Action Engine

Implement objectively defined, configurable detection for:

- Swing highs and lows
- HH, HL, LH, LL
- BOS, CHoCH and MSS
- Breakout and retest
- Rejection candles
- Displacement candles
- Failed breakouts
- Trend continuation and pullbacks

Every event must include its source timestamp, timeframe, confirmation state and relevant price levels.

Confirmed events must not repaint.

## 2. Technical Indicator Engine

Add configurable indicators:

- EMA 20, 50 and 200
- RSI
- MACD
- ADX/DMI
- ATR and ATR percentage
- Bollinger Band Width
- VWAP where valid data is available
- Relative Volume
- OBV
- Optional Volume Profile/CVD when the data source supports them

Group indicators by their function: trend, momentum, volatility, volume and location.

Do not count correlated indicators as independent confirmations without validation.

## 3. Liquidity and Market Location

Support:

- Previous Day/Week High and Low
- Session High and Low
- Equal Highs/Lows
- Liquidity sweeps
- Support/Resistance zones
- Trendlines
- Optional FVG and objectively defined Order Blocks

Keep each feature configurable and independently testable.

## 4. Timeframe-Specific Configuration

Support M1, M5, M15, H1, H4, D, W and M.

Use H4/D/W/M for higher-level context, H1/M15 for setup context, and M5 for entry triggers.

Do not allow a lower-timeframe signal to silently override higher-timeframe resistance or risk constraints.

## 5. Ablation Testing

Build a research framework that compares:

A. Price Action + Structure + S/R baseline

B. A + RSI/MACD/ADX

C. B + Liquidity + Volume + Session

D. C + Multi-Timeframe Alignment + Volatility/Risk Filters

Keep entry/exit rules, fees, slippage assumptions and test periods consistent when comparing models.

Measure the incremental contribution of each feature group.

Do not assume any indicator improves profitability before testing.

## 6. Backtesting Requirements

Include:

- Trading fees and realistic slippage
- No look-ahead bias
- No future leakage
- No repainting of confirmed signals
- Chronological train/validation/out-of-sample splits
- Walk-forward evaluation
- Long/short performance separately
- Performance by timeframe, session and market regime
- Win rate, expectancy, Profit Factor, drawdown, average R, MFE and MAE
- Trade count and uncertainty estimates

Prevent overlapping trades or duplicate signals unless explicitly configured.

Document the fill model, stop/target execution rules and treatment of candles that hit both SL and TP within the same bar.

## 7. Statistical Validation

Prefer expectancy after costs and out-of-sample stability over win rate alone.

Track sample sizes and uncertainty. Avoid overfitting from repeated parameter searches. Use a final untouched test period.

Do not present model scores as calibrated probabilities unless they have been calibrated and evaluated empirically.

## 8. Feature Selection

Implement feature ablation and feature-group comparison before adding automatic feature selection.

Do not automatically delete or promote features solely from in-sample performance.

## 9. AI Integration

AI may summarize evidence, identify conflicting signals and review scenarios.

AI must not invent market data, alter historical results or bypass deterministic risk controls.

Keep AI outputs separate from actual backtest results.

## 10. Deliverables

Before coding, inspect the existing project and report the implementation plan.

Then implement in small, testable steps.

For every step:

- List changed files
- Add unit tests
- Run tests where possible
- Report actual results
- Document assumptions and limitations
- Do not claim tests passed unless they were run

The objective is to identify which feature combinations have robust out-of-sample value, not to maximize historical win rate.