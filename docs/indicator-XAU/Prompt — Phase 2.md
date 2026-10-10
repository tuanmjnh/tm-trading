Implement Phase 2: Market Structure Engine.

Do not implement unrelated features.

Requirements:

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

Requirements:

1. The algorithm must be deterministic.
2. Confirmed historical events must never repaint.
3. Clearly distinguish forming and confirmed pivots.
4. Support M1/M5/M15/H1/H4/D/W/M.
5. Use timeframe-specific configuration.
6. Every event must contain:
   - timestamp
   - timeframe
   - price
   - direction
   - type
   - confirmation state
   - source bar
   - strength
7. Write unit tests.
8. Create synthetic candle datasets for testing.
9. Include tests specifically designed to detect look-ahead bias.
10. Do not add AI.
11. Do not add trading execution.

After implementation:
- show the algorithm
- show examples
- show test results
- explain repaint protection
- explain known limitations.