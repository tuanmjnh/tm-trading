# Method League

> Sinh tu dong boi `npm run engine:league` (engine/league.mjs) — KHONG chinh sua tay.

- Sinh luc: 2026-10-22 10:19:41 UTC
- Cua so du lieu: 2026-05-08 19:00 -> 2026-10-22 10:15 (UTC) — toi da 4000 bar/moi o
- Symbol x TF: BTCUSDT, ETHUSDT, ZECUSDT x [60, 15]
- Method: orderflow (Orderflow (taker delta spike + delta divergence)); price-action (Price action / SMC (pin, engulf, inside, BOS)); sweep (Liquidity Sweep (quet thanh khoan + rau tu choi + volume VSA)); trend (Trend (MA pullback, ATR/Donchian breakout, range mean-reversion)); vsa (VSA / Wyckoff (method 0))
- Params: DEFAULTS tung method (chua optimize); phi/slippage theo feePct/slipPct cua method.
- Khong dung sub1m: cung bar SL+TP tinh theo SL bao thu.

## Pooled theo method

_Gop toan bo trades cac o: tong % khong compound, chi tham khao — can so sanh nghiem tuc doc bang chi tiet._

| Method | Trades | Closed | WR% | PF | Net% | E[R] |
|---|---|---|---|---|---|---|
| orderflow | 162 | 162 | 30.2 | 0.77 | -21.38 | -0.46 |
| price-action | 1385 | 1379 | 33.2 | 0.93 | -82.96 | -0.23 |
| sweep | 22 | 22 | 18.2 | 1.26 | 4.69 | -0.46 |
| trend | 1682 | 1680 | 33.3 | 0.83 | -190.27 | -0.35 |
| vsa | 222 | 221 | 22.5 | 0.69 | -55.37 | -0.78 |

## Chi tiet tung o

| Method | Symbol | TF | Bars | Trades | Closed | WR% | PF | Net% | MaxDD% | NoFill | Repl |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orderflow | BTCUSDT | 60 | 4000 | 10 | 10 | 40.0 | 1.41 | 1.91 | 2.07 | 0 | 0 |
| price-action | BTCUSDT | 60 | 4000 | 222 | 222 | 35.1 | 0.78 | -31.18 | 46.99 | 0 | 0 |
| sweep | BTCUSDT | 60 | 4000 | 1 | 1 | 0.0 | 0.00 | -0.59 | 0.59 | 0 | 0 |
| trend | BTCUSDT | 60 | 4000 | 276 | 276 | 35.5 | 0.75 | -36.02 | 36.02 | 0 | 0 |
| vsa | BTCUSDT | 60 | 4000 | 35 | 35 | 20.0 | 0.82 | -4.22 | 8.45 | 0 | 69 |
| orderflow | BTCUSDT | 15 | 4000 | 65 | 65 | 30.8 | 0.62 | -9.56 | 11.06 | 0 | 0 |
| price-action | BTCUSDT | 15 | 4000 | 200 | 200 | 33.0 | 0.66 | -23.29 | 30.66 | 0 | 0 |
| sweep | BTCUSDT | 15 | 4000 | 4 | 4 | 0.0 | 0.00 | -2.44 | 2.44 | 0 | 0 |
| trend | BTCUSDT | 15 | 4000 | 291 | 291 | 29.2 | 0.46 | -43.25 | 46.19 | 0 | 0 |
| vsa | BTCUSDT | 15 | 4000 | 49 | 49 | 12.2 | 0.21 | -17.29 | 17.29 | 0 | 77 |
| orderflow | ETHUSDT | 60 | 4000 | 2 | 2 | 50.0 | 5.64 | 2.74 | 0.59 | 0 | 0 |
| price-action | ETHUSDT | 60 | 4000 | 240 | 240 | 30.4 | 0.70 | -59.93 | 67.60 | 0 | 0 |
| sweep | ETHUSDT | 60 | 4000 | 3 | 3 | 0.0 | 0.00 | -2.68 | 2.68 | 0 | 0 |
| trend | ETHUSDT | 60 | 4000 | 215 | 215 | 30.2 | 0.73 | -45.39 | 50.95 | 0 | 0 |
| vsa | ETHUSDT | 60 | 4000 | 30 | 30 | 30.0 | 0.61 | -14.30 | 19.23 | 0 | 70 |
| orderflow | ETHUSDT | 15 | 4000 | 52 | 52 | 23.1 | 0.32 | -17.57 | 21.74 | 0 | 0 |
| price-action | ETHUSDT | 15 | 4000 | 235 | 235 | 34.5 | 0.75 | -24.69 | 29.51 | 0 | 0 |
| sweep | ETHUSDT | 15 | 4000 | 9 | 9 | 22.2 | 0.78 | -0.83 | 1.94 | 0 | 0 |
| trend | ETHUSDT | 15 | 4000 | 267 | 267 | 39.0 | 0.70 | -25.71 | 31.62 | 0 | 0 |
| vsa | ETHUSDT | 15 | 4000 | 49 | 49 | 26.5 | 0.55 | -8.43 | 10.94 | 0 | 90 |
| orderflow | ZECUSDT | 60 | 4000 | 4 | 4 | 25.0 | 1.10 | 0.88 | 9.26 | 0 | 0 |
| price-action | ZECUSDT | 60 | 4000 | 271 | 271 | 35.1 | 1.26 | 107.11 | 61.88 | 0 | 0 |
| sweep | ZECUSDT | 60 | 4000 | 5 | 5 | 40.0 | 2.37 | 11.22 | 6.90 | 0 | 0 |
| trend | ZECUSDT | 60 | 4000 | 320 | 320 | 34.1 | 1.00 | 1.52 | 47.07 | 0 | 0 |
| vsa | ZECUSDT | 60 | 4000 | 27 | 27 | 29.6 | 1.11 | 4.82 | 22.77 | 0 | 69 |
| orderflow | ZECUSDT | 15 | 4000 | 29 | 29 | 37.9 | 1.01 | 0.21 | 14.24 | 0 | 0 |
| price-action | ZECUSDT | 15 | 4000 | 217 | 217 | 30.9 | 0.77 | -50.98 | 59.19 | 0 | 0 |
| sweep | ZECUSDT | 15 | 4000 | 0 | 0 | 0.0 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| trend | ZECUSDT | 15 | 4000 | 313 | 313 | 31.6 | 0.81 | -41.44 | 57.61 | 0 | 0 |
| vsa | ZECUSDT | 15 | 4000 | 32 | 32 | 21.9 | 0.47 | -15.95 | 19.66 | 0 | 58 |
