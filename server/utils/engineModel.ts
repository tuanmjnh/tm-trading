import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  Model engine cho server (Nitro) — mot NGUON cho ca signals/risk (D1).
//
//  Import runtime vi cung ly do nhu reports.ts: Nitro bundle tinh sai do sau
//  duong dan tuong doi ra ngoai `server/` (xem docs/app-inheritance.md) — dung
//  process.cwd() dua truc tiep vao Node.
//
//  Memo theo process: connectMongo cua engine da co state + cooldown rieng.
//  Mongo khong san sang -> tra null va HUY memo de lan sau thu lai (khong bam
//  loi 30s).
// =============================================================================

type EngineDb = typeof import('../../engine/db.mjs')
type AnyModel = typeof import('mongoose').Model<any>

let dbPromise: Promise<EngineDb> | null = null

export function engineDb(): Promise<EngineDb> {
  if (!dbPromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'db.mjs')).href
    dbPromise = import(/* @vite-ignore */ file) as Promise<EngineDb>
  }
  return dbPromise
}

const modelMemos = new Map<string, Promise<AnyModel | null>>()

/**
 * Model cua engine (vd. engineModel('alert.mjs', 'Alert')), co ket noi thi moi
 * tra ve — null = Mongo khong san sang (fail-soft, khong 500).
 */
export function engineModel(modelFile: string, exportName: string): Promise<AnyModel | null> {
  const key = `${modelFile}#${exportName}`
  const cached = modelMemos.get(key)
  if (cached) return cached

  const promise = (async () => {
    const db = await engineDb()
    const mongoose = await db.connectMongo()
    if (!mongoose) return null
    const file = pathToFileURL(join(process.cwd(), 'engine', 'models', modelFile)).href
    const mod = await import(/* @vite-ignore */ file)
    return (mod as Record<string, AnyModel | undefined>)[exportName] ?? null
  })()
  modelMemos.set(key, promise)
  promise.then((model) => {
    // Mongo chua len -> huy memo de lan sau thu lai.
    if (!model && modelMemos.get(key) === promise) modelMemos.delete(key)
  }).catch(() => {
    if (modelMemos.get(key) === promise) modelMemos.delete(key)
  })
  return promise
}
