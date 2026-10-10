// alias-hook.mjs
// Monkey-patch Module._resolveFilename to handle ~~ and @@ aliases
// Usage: node --import ./tests/alias-hook.mjs services/test.mjs

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const Module = require('module')
const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request.startsWith('~~/')) {
    const newPath = request.replace('~~/', '')
    return Module._resolveFilename('./' + newPath, parent, isMain, options)
  }
  if (request.startsWith('@@/')) {
    const newPath = request.replace('@@/', '')
    return Module._resolveFilename('./' + newPath, parent, isMain, options)
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}