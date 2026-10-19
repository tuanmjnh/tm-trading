#!/usr/bin/env node
/**
 * Dev launcher (P0-7).
 *
 * `nuxt dev --no-fork` runs the whole dashboard in one Node process. With 77
 * pages, Tiptap/ProseMirror and six Nuxt modules this app was hitting the
 * default ~4 GB heap during long sessions:
 *
 *   FATAL ERROR: Ineffective mark-compacts near heap limit — out of memory
 *
 * Raising the limit in the script string would need `cross-env` (not a
 * dependency here) to work in cmd.exe, PowerShell and POSIX shells alike, so the
 * flag is applied to the child process instead and the launcher stays
 * dependency-free.
 *
 * Override the ceiling with:  TM_DEV_HEAP_MB=8192 npm run dev
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const heapMb = process.env.TM_DEV_HEAP_MB || '6144'
const nodeOptions = [process.env.NODE_OPTIONS, `--max-old-space-size=${heapMb}`]
  .filter(Boolean)
  .join(' ')

const nuxtBin = fileURLToPath(new URL('../node_modules/nuxt/bin/nuxt.mjs', import.meta.url))
const args = ['dev', '--port', '4001', '--no-fork', ...process.argv.slice(2)]

console.log(`[dev] NODE_OPTIONS="${nodeOptions}"`)

const child = spawn(process.execPath, [nuxtBin, ...args], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
