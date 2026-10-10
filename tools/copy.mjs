#!/usr/bin/env node
// =============================================================================
//  TM TRADING - CLIPBOARD HELPER
//  Copy san file .pine tu pine/dist vao clipboard de dan thang vao Pine Editor.
//
//  Usage: node tools/copy.mjs [ten-file]     (mac dinh: TM Signals.pine)
// =============================================================================

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] || 'TM Signals.pine'
const file = join(ROOT, 'pine', 'dist', target)

const code = readFileSync(file, 'utf8')
const bytes = Buffer.byteLength(code, 'utf8')

const candidates =
  process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
      ? [
          ['powershell', ['-NoProfile', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; $input | Set-Clipboard']],
          ['clip', []],
        ]
      : [
          ['xclip', ['-selection', 'clipboard']],
          ['xsel', ['--clipboard', '--input']],
        ]

for (const [cmd, args] of candidates) {
  const r = spawnSync(cmd, args, { input: code, encoding: 'utf8' })
  if (!r.error && r.status === 0) {
    console.log(`Da copy ${target} vao clipboard (${code.split('\n').length} dong, ${bytes} bytes).`)
    console.log('DAN vao Pine Editor roi bam "Add to chart".')
    process.exit(0)
  }
}

console.error(`Khong copy duoc (thu ${candidates.map((c) => c[0]).join(', ')}).`)
console.error(`Tu dan file: ${file}`)
process.exit(1)
