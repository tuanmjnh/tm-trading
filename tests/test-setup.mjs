// test-setup.mjs
// Register module aliases for tests (tsx doesn't support moduleAliases in config)
import { register } from 'module-alias'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = __dirname.replace('/tests', '')

register({
  '~~': root,
  '@@': root,
})

// Also register for CommonJS require (if needed)
require('module-alias').addAlias('~~', root)
require('module-alias').addAlias('@@', root)