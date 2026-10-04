/** "Name <email>" | "email" → { name, email } */
export function parseAddress(raw: string): { name: string, email: string } {
  const value = (raw || '').trim()
  const match = value.match(/^(.*?)(?:<([^>]+)>)\s*$/)
  if (match && match[2]) {
    return { name: (match[1] || '').trim().replace(/^"|"$/g, ''), email: match[2].trim() }
  }
  return { name: value, email: value }
}

/**
 * Sanitize dangerous elements in HTML mail (untrusted content):
 * script/style/iframe..., on* handlers, javascript: URLs.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return ''
  let out = html
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|form|base|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|form|base|svg|math)\b[^>]*\/?>/gi, '')
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = out.replace(/(href|src)\s*=\s*("|')?\s*(javascript|data:text\/html)[^"'>\s]*/gi, '$1="#"')
  return out
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
