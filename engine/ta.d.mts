/**
 * Type declarations for `engine/ta.mjs` when imported from TypeScript
 * (app/utils/indicators.ts). TypeScript cannot read `.mjs` -> the sibling
 * `ta.d.mts` is what TS resolves for the `./ta.mjs` specifier. Keep in sync
 * when adding/removing exports in ta.mjs.
 *
 * Shared shape: `null` = Pine `na`.
 */

export interface Bar {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export declare function sma(values: Array<number | null>, length: number): Array<number | null>
export declare function rma(values: Array<number | null>, length: number): Array<number | null>
export declare function trueRange(bars: Bar[]): number[]
export declare function atr(bars: Bar[], length: number): Array<number | null>
export declare function rollingSum(values: Array<number | null>, length: number): Array<number | null>
export declare function pivotLow(
  values: Array<number | null>,
  leftbars: number,
  rightbars: number,
): Array<{ value: number, index: number } | null>
export declare function pivotHigh(
  values: Array<number | null>,
  leftbars: number,
  rightbars: number,
): Array<{ value: number, index: number } | null>
export declare function lowest(values: Array<number | null>, length: number, from?: number, to?: number): Array<number | null>
export declare function highest(values: Array<number | null>, length: number, from?: number, to?: number): Array<number | null>
export declare function sessionOk(timeMs: number, sess: string, tz?: string): boolean
export declare function vsaBucket(
  vol: number,
  ma: number | null,
  r: { rP: number, rVH: number, rH: number, rN: number, rL: number },
): 'TIM' | 'VeryHigh' | 'High' | 'Normal' | 'Low' | 'VeryLow'

// Phase 7I indicator primitives
export declare function ema(values: Array<number | null>, length: number): Array<number | null>
export declare function rsi(closes: Array<number | null>, length: number): Array<number | null>
export declare function stdev(values: Array<number | null>, length: number): Array<number | null>
export declare function macd(
  closes: Array<number | null>,
  fast?: number,
  slow?: number,
  signal?: number,
): { macd: Array<number | null>, signal: Array<number | null>, hist: Array<number | null> }
export declare function vwap(bars: Bar[]): Array<number | null>
export declare function obv(bars: Bar[]): Array<number | null>
export declare function cmf(bars: Bar[], length: number): Array<number | null>
export declare function donchian(
  bars: Bar[],
  length: number,
): { upper: Array<number | null>, lower: Array<number | null>, middle: Array<number | null> }
