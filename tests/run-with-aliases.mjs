// run-with-aliases.mjs
// Wrapper that monkey-patches Module._resolveFilename to handle ~~ and @@ aliases
// Usage: node tests/run-with-aliases.mjs services/test.mjs

import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const Module = require('module')

const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function(request, parent, isMain, options) {
  // Handle ~~ alias
  if (request.startsWith('~~/')) {
    const newPath = request.replace('~~/', '')
    const baseDir = parent ? new URL('.', parent).pathname : process.cwd()
    const resolved = resolveFrom(baseDir, newPath)
    return resolved
  }
  
  // Handle @@ alias
  if (request.startsWith('@@/')) {
    const newPath = request.replace('@@/', '')
    const baseDir = parent ? new URL('.', parent).pathname : process.cwd()
    const resolved = resolveFrom(baseDir, newPath)
    return resolved
  }
  
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

function resolveFrom(baseDir, relativePath) {
  const { resolve } = require('node:path')
  const { fileURLToPath } = require('node:url')
  
  let base = baseDir
  if (base.startsWith('file://')) {
    base = new URL(base).pathname
  }
  
  // Handle Windows paths
  if (process.platform === 'win32') {
    base = base.replace(/^\/([a-z]):\//i, '$1:/')
  }
  
  return 'file://' + resolve(base, relativePath)
}

// Run the target test file
const testFile = process.argv[2]
if (!testFile) {
  console.error('Usage: node run-with-aliases.mjs <test-file>')
  process.exit(1)
}

import(testFile).catch(console.error)