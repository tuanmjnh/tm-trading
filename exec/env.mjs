// =============================================================================
//  TM TRADING - .env loader for exec/ services (same semantics as the one in
//  server/webhook.mjs: only fills keys that are NOT already set, so an explicit
//  shell export always wins). Kept separate from webhook.mjs on purpose — exec
//  scripts must not import the HTTP receiver (layering + side effects).
// =============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Read ROOT/.env (KEY=VALUE per line). Missing file = no-op. */
export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
