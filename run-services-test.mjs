// run-services-test.mjs
// Wrapper to run services tests with ~~ alias support

import { createRequire } from 'node:module'
import { register } from 'node:module'

const require = createRequire(import.meta.url)

// Simple alias resolution for ~~ and @@
const Module = require('module')
const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request.startsWith('~~/')) {
    const newPath = request.replace('~~/', '')
    const resolved = Module._resolveFilename('./' + newPath, parent, isMain, options)
    return resolved
  }
  if (request.startsWith('@@/')) {
    const newPath = request.replace('@@/', '')
    const resolved = Module._resolveFilename('./' + newPath, parent, isMain, options)
    return resolved
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

// Run the services test
import('./services/test.mjs').catch(console.error)