// alias-import.mjs
// Import hook for Node.js --import flag
// Registers ~~ and @@ aliases for module resolution

import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const Module = require('module')

const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function(request, parent, isMain, options) {
  // Handle ~~ alias (project root)
  if (request.startsWith('~~/')) {
    const newPath = request.replace('~~/', '')
    // Resolve relative to project root
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

console.log('[alias-import] ~~ and @@ aliases registered')