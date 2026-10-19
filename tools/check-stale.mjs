import fs from 'node:fs'
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const files = fs.readdirSync('pine/dist')
let n = 0
for (const k of Object.keys(p.scripts)) {
  const m = String(p.scripts[k]).match(/copy\.mjs "([^"]+)"/)
  if (m && !files.includes(m[1])) { console.log('STALE', k, '->', m[1]); n++ }
}
console.log('stale:', n, '| dist:', files.length)