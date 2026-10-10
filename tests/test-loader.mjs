import { register } from 'module'

const __dirname = new URL('.', import.meta.url).pathname
const root = __dirname.replace('/tests/', '/')

// Register the alias hooks
register('~~', {
  parentURL: import.meta.url,
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('~~/')) {
      const newSpecifier = specifier.replace('~~/', `${new URL('file://', import.meta.url).href}`)
      return nextResolve(newSpecifier, context)
    }
    if (specifier.startsWith('@@/')) {
      const newSpecifier = specifier.replace('@@/', `${new URL('file://', import.meta.url).href}`)
      return nextResolve(newSpecifier, context)
    }
    return nextResolve(specifier, context, nextResolve)
  }
})