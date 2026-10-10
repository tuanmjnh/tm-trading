// alias-loader.mjs
// Custom loader to resolve ~~ and @@ aliases for Node.js tests
// Usage: node --experimental-loader ./tests/alias-loader.mjs services/test.mjs

import { URL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

console.error('[alias-loader] Loader loaded, cwd:', process.cwd())

export async function resolve(specifier, context, nextResolve) {
  console.error('[alias-loader] Resolving:', specifier)
  // Handle ~~ and @@ aliases
  if (specifier.startsWith('~~/')) {
    const newSpecifier = `file://${resolve(process.cwd(), specifier.slice(4))}`
    console.error('[alias-loader] Resolved ~~/ to:', newSpecifier)
    return nextResolve(newSpecifier, context)
  }
  if (specifier.startsWith('@@/')) {
    const newSpecifier = `file://${resolve(process.cwd(), specifier.slice(4))}`
    return nextResolve(newSpecifier, context)
  }
  return nextResolve(specifier, context)
}

export { resolve }