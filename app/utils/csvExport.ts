// =============================================================================
//  Client-side CSV export for list pages (D: terminal actions).
//
//  Deliberately NOT a server-side export: the trading list endpoints are
//  cursor-paginated and Mongo-backed, and this repo forbids inventing data — so
//  the file carries exactly the rows the page has already loaded. Callers warn
//  with the row count (and the `hasMore` hint) so the user knows the scope.
// =============================================================================

export type CsvValue = string | number | boolean | null | undefined

export interface CsvColumn<T> {
  key: string
  label: string
  value: (row: T) => CsvValue
}

/** RFC 4180 cell escaping — quotes, commas and newlines. */
function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build a CSV document (CRLF rows, header first). */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCell(c.label)).join(',')
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(','))
  return [head, ...body].join('\r\n')
}

/** Timestamped file name, e.g. `tm-trading-orders-2026-10-18T12-30.csv`. */
export function csvFilename(prefix: string, at: Date = new Date()): string {
  const stamp = at.toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `${prefix}-${stamp}.csv`
}

/**
 * Trigger a browser download. A UTF-8 BOM is prepended so Excel opens the file
 * with the right encoding (Vietnamese labels/symbols survive the round trip).
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
