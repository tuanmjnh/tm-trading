                         ┌──────────────────────┐
                         │   TradingView        │
                         │   XAUUSDT            │
                         └──────────┬───────────┘
                                    │
                              Pine Script
                                    │
                                    ▼
                    ┌───────────────────────────┐
                    │   MARKET DATA ENGINE      │
                    │ M1 M5 M15 H1 H4 D W M     │
                    └─────────────┬─────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   Market Structure         Liquidity Engine        Candle Engine
   BOS / CHoCH              Sweep / S/R             Patterns
   HH HL LH LL              Trendlines              Displacement
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  ▼
                         FEATURE ENGINE
                                  │
                                  ▼
                         SCORING ENGINE
                                  │
                        ┌─────────┴─────────┐
                        ▼                   ▼
                  LONG/SHORT            NO TRADE
                        │
                        ▼
                 SCENARIO ENGINE
             ┌──────────┼──────────┐
             ▼          ▼          ▼
           LONG       RANGE       SHORT
             │          │          │
             └──────────┼──────────┘
                        ▼
                   AI ROUTER
             ┌──────────┼──────────┐
             ▼          ▼          ▼
          Provider A  Provider B  Local AI
             │          │          │
             └──────────┼──────────┘
                        ▼
                  AI CONSENSUS
                        │
                        ▼
                   RISK ENGINE
                        │
                        ▼
                 MARKET MAP/UI
                        │
                        ▼
          Entry / SL / TP / Zones / Path
                        │
                        ▼
                    DATABASE
                        │
                        ▼
              BACKTEST / ANALYTICS
                        │
                        └──────► cải thiện hệ thống