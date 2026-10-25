const ROOT = 'D:/Applications/tm-trading'
const fs = await import('node:fs')
const path = await import('node:path')
const dataDir = path.join(ROOT, 'data', 'fapi')
const files = fs.readdirSync(dataDir)
const btcFiles = files.filter(f => f.startsWith('BTCUSDT'))
console.log('BTC files:', btcFiles)
btcFiles.forEach(f => {
  const p = path.join(dataDir, f)
  const content = fs.readFileSync(p, 'utf8')
  const doc = JSON.parse(content)
  console.log(f, 'bars:', doc.bars?.length, 'fetchedAt:', doc.fetchedAt)
})
process.exit(0)