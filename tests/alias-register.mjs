// alias-register.mjs
// Register ~~ and @@ aliases using Node's built-in module hooks (Node 18.19+)
// Usage: node --import ./tests/alias-register.mjs services/test.mjs

import { register } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Register the alias hooks
register('~~', {
  parentURL: import.meta.url,
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('~~/')) {
      const newSpecifier = `file://${resolve(process.cwd(), specifier.slice(4))}`
      return nextResolve(newSpecifier, context)
    }
    if (specifier.startsWith('@@/')) {
      const newSpecifier = `file://${resolve(process.cwd(), specifier.slice(4))}`
      return nextResolve(newSpecifier, context)
    }
    return nextResolve(specifier, context)
  }
})

console.log('[alias-register] ~~ and @@ aliases registered via module.register')