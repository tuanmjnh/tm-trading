# Method League

> Sinh tu dong boi `npm run engine:league` (engine/league.mjs) — KHONG chinh sua tay.

- Sinh luc: 2026-10-22 09:52:11 UTC
- Cua so du lieu: 2026-09-10 18:00 -> 2026-10-22 09:30 (UTC) — toi da 1000 bar/moi o
- Symbol x TF: BTCUSDT, ETHUSDT, ZECUSDT x [60, 15]
- Method: orderflow (Orderflow (taker delta spike + delta divergence)); price-action (Price action / SMC (pin, engulf, inside, BOS)); sweep (Liquidity Sweep (quet thanh khoan + rau tu choi + volume VSA)); trend (Trend (MA pullback, ATR/Donchian breakout, range mean-reversion)); vsa (VSA / Wyckoff (method 0))
- Params: DEFAULTS tung method (chua optimize); phi/slippage theo feePct/slipPct cua method.
- Khong dung sub1m: cung bar SL+TP tinh theo SL bao thu.

## Pooled theo method

_Gop toan bo trades cac o: tong % khong compound, chi tham khao — can so sanh nghiem tuc doc bang chi tiet._

| Method | Trades | Closed | WR% | PF | Net% | E[R] |
|---|---|---|---|---|---|---|
| orderflow | 36 | 36 | 36.1 | 1.32 | 6.86 | -0.14 |
| price-action | 381 | 376 | 27.0 | 0.69 | -104.74 | -0.42 |
| sweep | 6 | 6 | 16.7 | 0.63 | -1.50 | -0.13 |
| trend | 428 | 425 | 34.3 | 0.82 | -47.51 | -0.30 |
| vsa | 48 | 47 | 20.8 | 0.84 | -7.02 | -0.91 |

## Chi tiet tung o

| Method | Symbol | TF | Bars | Trades | Closed | WR% | PF | Net% | MaxDD% | NoFill | Repl |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orderflow | BTCUSDT | 60 | 1000 | 3 | 3 | 33.3 | 2.56 | 1.90 | 0.64 | 0 | 0 |
| price-action | BTCUSDT | 60 | 1000 | 55 | 55 | 25.5 | 0.51 | -18.75 | 19.27 | 0 | 0 |
| sweep | BTCUSDT | 60 | 1000 | 0 | 0 | 0.0 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| trend | BTCUSDT | 60 | 1000 | 62 | 62 | 38.7 | 0.84 | -4.82 | 13.28 | 0 | 0 |
| vsa | BTCUSDT | 60 | 1000 | 6 | 6 | 0.0 | 0.00 | -3.69 | 3.69 | 0 | 11 |
| orderflow | BTCUSDT | 15 | 1000 | 16 | 16 | 25.0 | 0.53 | -4.01 | 5.50 | 0 | 0 |
| price-action | BTCUSDT | 15 | 1000 | 73 | 73 | 27.4 | 0.43 | -15.48 | 15.86 | 0 | 0 |
| sweep | BTCUSDT | 15 | 1000 | 0 | 0 | 0.0 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| trend | BTCUSDT | 15 | 1000 | 70 | 70 | 28.6 | 0.42 | -11.97 | 13.80 | 0 | 0 |
| vsa | BTCUSDT | 15 | 1000 | 12 | 12 | 8.3 | 0.11 | -4.88 | 4.88 | 0 | 19 |
| orderflow | ETHUSDT | 60 | 1000 | 2 | 2 | 50.0 | 5.64 | 2.74 | 0.59 | 0 | 0 |
| price-action | ETHUSDT | 60 | 1000 | 64 | 64 | 20.3 | 0.48 | -26.28 | 29.07 | 0 | 0 |
| sweep | ETHUSDT | 60 | 1000 | 1 | 1 | 0.0 | 0.00 | -0.90 | 0.90 | 0 | 0 |
| trend | ETHUSDT | 60 | 1000 | 62 | 62 | 24.2 | 0.50 | -23.44 | 23.44 | 0 | 0 |
| vsa | ETHUSDT | 60 | 1000 | 9 | 9 | 33.3 | 0.80 | -1.37 | 6.30 | 0 | 18 |
| orderflow | ETHUSDT | 15 | 1000 | 9 | 9 | 33.3 | 0.76 | -1.30 | 4.83 | 0 | 0 |
| price-action | ETHUSDT | 15 | 1000 | 59 | 59 | 27.1 | 0.60 | -11.18 | 12.73 | 0 | 0 |
| sweep | ETHUSDT | 15 | 1000 | 4 | 4 | 25.0 | 1.38 | 0.72 | 1.88 | 0 | 0 |
| trend | ETHUSDT | 15 | 1000 | 73 | 73 | 49.3 | 1.17 | 3.17 | 5.79 | 0 | 0 |
| vsa | ETHUSDT | 15 | 1000 | 6 | 6 | 16.7 | 0.40 | -1.67 | 2.00 | 0 | 12 |
| orderflow | ZECUSDT | 60 | 1000 | 1 | 1 | 0.0 | 0.00 | -5.14 | 5.14 | 0 | 0 |
| price-action | ZECUSDT | 60 | 1000 | 75 | 75 | 26.7 | 0.82 | -24.80 | 61.88 | 0 | 0 |
| sweep | ZECUSDT | 60 | 1000 | 1 | 1 | 0.0 | 0.00 | -1.32 | 1.32 | 0 | 0 |
| trend | ZECUSDT | 60 | 1000 | 71 | 71 | 31.0 | 0.92 | -7.30 | 32.73 | 0 | 0 |
| vsa | ZECUSDT | 60 | 1000 | 7 | 7 | 42.9 | 1.52 | 7.42 | 11.71 | 0 | 13 |
| orderflow | ZECUSDT | 15 | 1000 | 5 | 5 | 80.0 | 18.17 | 12.68 | 0.74 | 0 | 0 |
| price-action | ZECUSDT | 15 | 1000 | 55 | 55 | 36.4 | 0.85 | -8.25 | 12.41 | 0 | 0 |
| sweep | ZECUSDT | 15 | 1000 | 0 | 0 | 0.0 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| trend | ZECUSDT | 15 | 1000 | 90 | 90 | 33.3 | 0.95 | -3.14 | 14.18 | 0 | 0 |
| vsa | ZECUSDT | 15 | 1000 | 8 | 8 | 25.0 | 0.70 | -2.83 | 8.18 | 0 | 28 |
