# Method League

> Sinh tu dong boi `npm run engine:league` (engine/league.mjs) — KHONG chinh sua tay.

- Sinh luc: 2026-10-04 10:23:06 UTC
- Cua so du lieu: 2026-08-23 19:00 -> 2026-10-04 10:15 (UTC) — toi da 1000 bar/moi o
- Symbol x TF: BTCUSDT, ETHUSDT, ZECUSDT x [60, 15]
- Method: orderflow (Orderflow (taker delta spike + delta divergence)); price-action (Price action / SMC (pin, engulf, inside, BOS)); trend (Trend (MA pullback, ATR/Donchian breakout, range mean-reversion)); vsa (VSA / Wyckoff (method 0))
- Params: DEFAULTS tung method (chua optimize); phi/slippage theo feePct/slipPct cua method.
- Khong dung sub1m: cung bar SL+TP tinh theo SL bao thu.

## Pooled theo method

_Gop toan bo trades cac o: tong % khong compound, chi tham khao — can so sanh nghiem tuc doc bang chi tiet._

| Method | Trades | Closed | WR% | PF | Net% | E[R] |
|---|---|---|---|---|---|---|
| orderflow | 43 | 42 | 30.2 | 0.74 | -5.12 | -0.58 |
| price-action | 337 | 331 | 33.8 | 0.93 | -18.38 | -0.21 |
| trend | 393 | 390 | 26.5 | 0.62 | -101.16 | -0.57 |
| vsa | 66 | 65 | 21.2 | 0.33 | -37.19 | -0.92 |

## Chi tiet tung o

| Method | Symbol | TF | Bars | Trades | Closed | WR% | PF | Net% | MaxDD% | NoFill | Repl |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orderflow | BTCUSDT | 60 | 1000 | 1 | 1 | 0.0 | 0.00 | -0.64 | 0.64 | 0 | 0 |
| price-action | BTCUSDT | 60 | 1000 | 47 | 47 | 29.8 | 0.56 | -15.05 | 18.18 | 0 | 0 |
| trend | BTCUSDT | 60 | 1000 | 61 | 61 | 32.8 | 0.65 | -11.08 | 16.64 | 0 | 0 |
| vsa | BTCUSDT | 60 | 1000 | 7 | 7 | 0.0 | 0.00 | -5.35 | 5.35 | 0 | 16 |
| orderflow | BTCUSDT | 15 | 1000 | 16 | 16 | 37.5 | 0.62 | -1.95 | 3.88 | 0 | 0 |
| price-action | BTCUSDT | 15 | 1000 | 41 | 41 | 46.3 | 1.13 | 1.60 | 4.64 | 0 | 0 |
| trend | BTCUSDT | 15 | 1000 | 66 | 66 | 15.2 | 0.17 | -18.58 | 18.58 | 0 | 0 |
| vsa | BTCUSDT | 15 | 1000 | 19 | 19 | 21.1 | 0.46 | -3.17 | 3.23 | 0 | 29 |
| orderflow | ETHUSDT | 60 | 1000 | 0 | 0 | 0.0 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| price-action | ETHUSDT | 60 | 1000 | 64 | 64 | 32.8 | 0.90 | -4.73 | 15.18 | 0 | 0 |
| trend | ETHUSDT | 60 | 1000 | 70 | 70 | 25.7 | 0.41 | -30.02 | 30.84 | 0 | 0 |
| vsa | ETHUSDT | 60 | 1000 | 10 | 10 | 30.0 | 0.63 | -3.17 | 8.65 | 0 | 12 |
| orderflow | ETHUSDT | 15 | 1000 | 17 | 17 | 17.6 | 0.14 | -6.61 | 6.84 | 0 | 0 |
| price-action | ETHUSDT | 15 | 1000 | 59 | 59 | 35.6 | 0.62 | -9.19 | 9.62 | 0 | 0 |
| trend | ETHUSDT | 15 | 1000 | 59 | 59 | 30.5 | 0.33 | -12.95 | 13.74 | 0 | 0 |
| vsa | ETHUSDT | 15 | 1000 | 18 | 18 | 27.8 | 0.62 | -1.94 | 2.89 | 0 | 27 |
| orderflow | ZECUSDT | 60 | 1000 | 0 | 0 | 0.0 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| price-action | ZECUSDT | 60 | 1000 | 68 | 68 | 33.8 | 1.17 | 19.43 | 39.75 | 0 | 0 |
| trend | ZECUSDT | 60 | 1000 | 64 | 64 | 29.7 | 0.92 | -7.39 | 30.03 | 0 | 0 |
| vsa | ZECUSDT | 60 | 1000 | 9 | 9 | 11.1 | 0.23 | -21.51 | 21.51 | 0 | 32 |
| orderflow | ZECUSDT | 15 | 1000 | 9 | 9 | 44.4 | 1.64 | 4.08 | 5.23 | 0 | 0 |
| price-action | ZECUSDT | 15 | 1000 | 58 | 58 | 27.6 | 0.80 | -10.43 | 27.93 | 0 | 0 |
| trend | ZECUSDT | 15 | 1000 | 73 | 73 | 26.0 | 0.60 | -21.13 | 24.25 | 0 | 0 |
| vsa | ZECUSDT | 15 | 1000 | 3 | 3 | 33.3 | 0.21 | -2.05 | 2.59 | 0 | 2 |
