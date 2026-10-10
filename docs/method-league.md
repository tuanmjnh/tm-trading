# Method League

> Sinh tu dong boi `npm run engine:league` (engine/league.mjs) — KHONG chinh sua tay.

- Sinh luc: 2026-10-09 01:19:55 UTC
- Cua so du lieu: 2026-04-21 12:00 -> 2026-10-05 03:00 (UTC) — toi da 1000 bar/moi o
- Symbol x TF: BTCUSDT, ETHUSDT, ZECUSDT x [60, 15]
- Method: orderflow (Orderflow (taker delta spike + delta divergence)); price-action (Price action / SMC (pin, engulf, inside, BOS)); sweep (Liquidity Sweep (quet thanh khoan + rau tu choi + volume VSA)); trend (Trend (MA pullback, ATR/Donchian breakout, range mean-reversion)); vsa (VSA / Wyckoff (method 0))
- Params: DEFAULTS tung method (chua optimize); phi/slippage theo feePct/slipPct cua method.
- Khong dung sub1m: cung bar SL+TP tinh theo SL bao thu.

## Pooled theo method

_Gop toan bo trades cac o: tong % khong compound, chi tham khao — can so sanh nghiem tuc doc bang chi tiet._

| Method | Trades | Closed | WR% | PF | Net% | E[R] |
|---|---|---|---|---|---|---|
| orderflow | 131 | 130 | 29.0 | 0.63 | -28.71 | -0.53 |
| price-action | 1168 | 1163 | 34.5 | 0.99 | -5.32 | -0.16 |
| sweep | 19 | 19 | 10.5 | 1.06 | 1.17 | -0.91 |
| trend | 1424 | 1422 | 33.6 | 0.87 | -129.73 | -0.33 |
| vsa | 209 | 208 | 23.9 | 0.62 | -66.05 | -0.68 |

## Chi tiet tung o

| Method | Symbol | TF | Bars | Trades | Closed | WR% | PF | Net% | MaxDD% | NoFill | Repl |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orderflow | BTCUSDT | 60 | 4000 | 8 | 8 | 37.5 | 0.84 | -0.63 | 2.07 | 0 | 0 |
| price-action | BTCUSDT | 60 | 4000 | 223 | 223 | 37.2 | 0.84 | -22.73 | 37.94 | 0 | 0 |
| sweep | BTCUSDT | 60 | 4000 | 1 | 1 | 0.0 | 0.00 | -0.59 | 0.59 | 0 | 0 |
| trend | BTCUSDT | 60 | 4000 | 262 | 262 | 37.0 | 0.80 | -26.10 | 33.98 | 0 | 0 |
| vsa | BTCUSDT | 60 | 4000 | 38 | 38 | 21.1 | 0.79 | -5.24 | 7.46 | 0 | 78 |
| orderflow | BTCUSDT | 15 | 3000 | 52 | 52 | 32.7 | 0.46 | -9.77 | 12.11 | 0 | 0 |
| price-action | BTCUSDT | 15 | 3000 | 120 | 120 | 35.0 | 0.78 | -8.93 | 14.24 | 0 | 0 |
| sweep | BTCUSDT | 15 | 3000 | 5 | 5 | 0.0 | 0.00 | -2.72 | 2.72 | 0 | 0 |
| trend | BTCUSDT | 15 | 3000 | 212 | 212 | 27.4 | 0.43 | -34.48 | 35.40 | 0 | 0 |
| vsa | BTCUSDT | 15 | 3000 | 37 | 37 | 21.6 | 0.46 | -7.44 | 8.55 | 0 | 61 |
| orderflow | ETHUSDT | 60 | 4000 | 2 | 2 | 50.0 | 0.69 | -0.18 | 0.59 | 0 | 0 |
| price-action | ETHUSDT | 60 | 4000 | 245 | 245 | 33.1 | 0.76 | -47.33 | 53.10 | 0 | 0 |
| sweep | ETHUSDT | 60 | 4000 | 2 | 2 | 0.0 | 0.00 | -1.78 | 1.78 | 0 | 0 |
| trend | ETHUSDT | 60 | 4000 | 216 | 216 | 31.5 | 0.74 | -41.20 | 43.81 | 0 | 0 |
| vsa | ETHUSDT | 60 | 4000 | 34 | 34 | 23.5 | 0.48 | -22.04 | 24.99 | 0 | 71 |
| orderflow | ETHUSDT | 15 | 3000 | 41 | 41 | 19.5 | 0.28 | -14.91 | 14.91 | 0 | 0 |
| price-action | ETHUSDT | 15 | 3000 | 152 | 152 | 35.5 | 0.79 | -13.24 | 14.79 | 0 | 0 |
| sweep | ETHUSDT | 15 | 3000 | 5 | 5 | 0.0 | 0.00 | -2.43 | 2.43 | 0 | 0 |
| trend | ETHUSDT | 15 | 3000 | 214 | 214 | 34.6 | 0.45 | -40.70 | 42.27 | 0 | 0 |
| vsa | ETHUSDT | 15 | 3000 | 38 | 38 | 31.6 | 0.82 | -2.32 | 7.13 | 0 | 68 |
| orderflow | ZECUSDT | 60 | 4000 | 5 | 5 | 40.0 | 2.03 | 7.26 | 4.12 | 0 | 0 |
| price-action | ZECUSDT | 60 | 4000 | 254 | 254 | 36.2 | 1.34 | 131.48 | 41.81 | 0 | 0 |
| sweep | ZECUSDT | 60 | 4000 | 6 | 6 | 33.3 | 1.81 | 8.69 | 9.43 | 0 | 0 |
| trend | ZECUSDT | 60 | 4000 | 313 | 313 | 35.1 | 1.08 | 29.99 | 47.07 | 0 | 0 |
| vsa | ZECUSDT | 60 | 4000 | 28 | 28 | 21.4 | 0.71 | -14.58 | 22.77 | 0 | 67 |
| orderflow | ZECUSDT | 15 | 3000 | 23 | 23 | 30.4 | 0.60 | -10.48 | 14.55 | 0 | 0 |
| price-action | ZECUSDT | 15 | 3000 | 174 | 174 | 29.3 | 0.76 | -44.57 | 59.19 | 0 | 0 |
| sweep | ZECUSDT | 15 | 3000 | 0 | 0 | 0.0 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| trend | ZECUSDT | 15 | 3000 | 207 | 207 | 34.3 | 0.89 | -17.23 | 42.00 | 0 | 0 |
| vsa | ZECUSDT | 15 | 3000 | 34 | 34 | 23.5 | 0.50 | -14.43 | 14.97 | 0 | 51 |
