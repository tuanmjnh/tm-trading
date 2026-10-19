import fs from 'node:fs'
const src = fs.readFileSync('tools/build.mjs', 'utf8')
const body = src.match(/const TARGETS = \{([\s\S]*?)\n\}/)[1]
const targets = [...body.matchAll(/'([\w-]+)':\s*\{[\s\S]*?file:\s*'([^']+)'/g)].map((x) => ({ t: x[1], f: x[2] }))
const dirs = new Set()
for (const tt of targets) {
  const mm = src.match(new RegExp(`'${tt.t}':\\s*\\{[\\s\\S]*?dir:\\s*'([^']+)'`))
  if (mm) dirs.add(mm[1])
}
console.log('targets:', targets.map((t) => t.t + '=' + t.f).join(', '))
console.log('dirs used:', [...dirs].join(', '))
const actual = fs.readdirSync('pine').filter((d) => d.startsWith('parts'))
console.log('actual parts dirs:', actual.join(', '))