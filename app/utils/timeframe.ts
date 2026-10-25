/**
 * Timeframe display labels — TradingView-style shorthand.
 * Internal values are minute-based strings ('1','5','15','30','60','240') plus
 * 'D'/'W'/'M'; anything already formatted (e.g. '5m') passes through untouched.
 */
const LABELS: Record<string, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '120': '2h',
  '240': '4h',
  '360': '6h',
  '480': '8h',
  '720': '12h',
  'D': '1D',
  'W': '1W',
  'M': '1M'
}

export function tfLabel(tf?: string | null): string {
  if (!tf) return '—'
  const t = String(tf).trim()
  return LABELS[t] ?? t
}
