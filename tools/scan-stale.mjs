import fs from 'node:fs'

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name
    if (e.isDirectory()) {
      if (['node_modules', '.nuxt', '.output', 'dist', 'archive'].includes(e.name)) continue
      walk(p, acc)
    } else if (/\.(mjs|ts|vue|json|md)$/.test(e.name)) acc.push(p)
  }
  return acc
}

const files = []
for (const d of ['engine', 'simulation', 'services', 'exec', 'app', 'server', 'tools', 'scripts', 'pine', 'docs']) walk(d, files)
const texts = files.map(f => [f, fs.readFileSync(f, 'utf8')])

const terms = [
  'TM Signals', 'TM Backtest', 'TM VSA Wyckoff', 'TM VSA Backtest', 'TM Indicator',
  'TM Indicator Strategy Lab', 'TM Liquidity Sweep', 'TM XAU Signals',
  'parts-vsa', 'parts-sweep', 'parts-xau2', 'parts-tm2', 'parts-longkaco-vsa',
  'parts-price-action-mtf', 'parts-tm', 'parts-xau',
  'indicator:parity', 'pine:inventory', 'pine:parity', 'pine-compatibility', 'pine-inventory'
]
for (const t of terms) {
  const hits = texts.filter(([f, c]) => c.includes(t)).map(([f]) => f.replace('engine/', '').replace('simulation/', '').replace('services/', '').replace('exec/', '').replace('app/', '').replace('server/', '').replace('tools/', '').replace('scripts/', '').replace('pine/', '').replace('docs/', ''))
  console.log(t.padEnd(28), hits.length ? hits.slice(0, 8).join(' | ') : 'ABSENT')
}