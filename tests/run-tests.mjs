import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = dirname(fileURLToPath(import.meta.url))
const root = join(testsDir, '..')

const files = readdirSync(testsDir)
  .filter(f => f.endsWith('.test.ts'))
  .sort()
  .map(f => join('tests', f))

if (files.length === 0) {
  console.error('No *.test.ts files found in tests/')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  ['--experimental-test-module-mocks', '--import', 'tsx', '--test', ...files],
  {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: '.nuxt/tsconfig.server.json',
    },
  }
)

process.exit(result.status ?? 1)
