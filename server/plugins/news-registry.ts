import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  NEWS-REGISTRY — seed the default source registry on boot (V3.5 §60 Slice F).
//
//  The pilot registry (3 crypto RSS + optional CryptoPanic + the official
//  Fed / SEC EDGAR / ECB sources + 4 BLS program release feeds, seeded from
//  engine/newsIngest.mjs PILOT_SOURCES) must exist even when the services
//  runner never fired: a fresh DB would otherwise show an empty Source
//  Registry and degrade every news surface.
//  Policy fields seed with $setOnInsert — an operator edit (disable, retier)
//  is never overwritten. Health is written by ingest runs, never here.
//
//  Same contract as the other plugins: warn-only, never blocks boot, never
//  throws. Installed once per process via a global symbol.
//
//  Env: NEWS_REGISTRY=0  skip the seed entirely.
// =============================================================================
const kInstalled = Symbol.for('tm-trading:news-registry:installed')

export default defineNitroPlugin(() => {
  const proc = process as unknown as { [kInstalled]?: boolean }
  if (proc[kInstalled]) return
  proc[kInstalled] = true

  if (process.env.NEWS_REGISTRY === '0') return

  const tag = '[news-registry]'

  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    try {
      const href = pathToFileURL(join(process.cwd(), 'services', 'newsStore.mjs')).href
      const mod = await import(/* @vite-ignore */ href)
      const seeded = await mod.seedNewsSources({ now: new Date() })
      if (seeded) {
        const ids = Object.keys(seeded)
        console.log(`${tag} registry ready: ${ids.length} sources (${ids.join(', ')})`)
      }
    } catch (err) {
      console.warn(`${tag} ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
})
