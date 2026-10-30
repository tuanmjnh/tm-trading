import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { engineDb } from './engineModel'

type Store = typeof import('../../exec/exchangeDemoStore.mjs')
type Loose<T> = { [K in keyof T]: T[K] extends (...args: any[]) => any ? (...args: any[]) => any : T[K] }
let storePromise: Promise<Loose<Store>> | null = null

async function loadStore(): Promise<Loose<Store>> {
  if (!storePromise) {
    storePromise = (async () => {
      const db = await engineDb()
      if (!await db.connectMongo()) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })
      return import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'exec', 'exchangeDemoStore.mjs')).href) as Promise<Loose<Store>>
    })().catch((error) => { storePromise = null; throw error })
  }
  return storePromise
}

export async function listExchangeDemoConnections(ownerId: string) {
  const store = await loadStore()
  return store.listDemoConnections(ownerId)
}

export async function saveExchangeDemoConnection(ownerId: string, input: Record<string, unknown>) {
  const store = await loadStore()
  return store.saveDemoConnection(ownerId, input)
}

export async function deleteExchangeDemoConnection(ownerId: string, profile: string) {
  const store = await loadStore()
  return store.removeDemoConnection(ownerId, profile)
}

export async function testExchangeDemoConnection(ownerId: string, profile: string) {
  const store = await loadStore()
  return store.testDemoConnection(ownerId, profile)
}

export function exchangeDemoHttpError(error: unknown) {
  const err = error as { statusCode?: number; code?: string; message?: string }
  if (err.statusCode) return err
  const code = String(err.code ?? 'exchange.internal-error')
  const status = code === 'exchange.connection-not-found' ? 404
    : code === 'exchange.credential-key-missing' ? 503
      : code === 'exchange.invalid-connection' || code === 'exchange.invalid-profile' || code === 'exchange.demo-host-required' || code === 'exchange.invalid-host' ? 400
        : 502
  return createError({ statusCode: status, statusMessage: code, message: String(err.message ?? 'Exchange demo operation failed').slice(0, 240) })
}
