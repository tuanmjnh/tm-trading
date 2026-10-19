// =============================================================================
//  Hub endpoint resolution — the "login goes to localhost" class of bug.
//
//  Resolution must be explicit: which env var won, what happens to an EMPTY
//  variable, and whether login and the menu share one endpoint. Everything here
//  is offline: env objects are passed in, no Nuxt, no network.
// =============================================================================

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_HUB_URL,
  HUB_APP_ID_KEYS,
  HUB_URL_KEYS,
  hubEnvReport,
  resolveHubEnv,
} from '../shared/utils/hubEnv'

type Row = Record<string, any>

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

describe('hub endpoint resolution', () => {
  test('NUXT_PUBLIC_HUB_URL wins and is reported as the source', () => {
    const r = resolveHubEnv({
      NUXT_PUBLIC_HUB_URL: 'https://tm-hub-app.vercel.app',
      NUXT_PUBLIC_HUB_APP_ID: 'tm-trading_8pmp33',
      HUB_URL: 'http://elsewhere:4000',
    })
    assert.equal(r.url, 'https://tm-hub-app.vercel.app')
    assert.equal(r.source, 'NUXT_PUBLIC_HUB_URL')
    assert.equal(r.defaulted, false)
    assert.equal(r.problem, null)
    assert.deepEqual(r.warnings, [], 'the losing name is simply not chosen — no warning for that')
  })

  test('an EMPTY defined variable is ignored AND warned about (the silent-fallback trap)', () => {
    const r = resolveHubEnv({ NUXT_PUBLIC_HUB_URL: '   ', HUB_URL: 'https://legacy.example' })
    assert.equal(r.url, 'https://legacy.example')
    assert.equal(r.source, 'HUB_URL')
    assert.equal(r.warnings.length, 2, 'one for the empty var, one for the legacy name')
    assert.match(r.warnings[0], /NUXT_PUBLIC_HUB_URL is defined but EMPTY/)
    assert.match(r.warnings[1], /legacy name/)
  })

  test('legacy names still work but are flagged; the third name is accepted too', () => {
    assert.equal(resolveHubEnv({ HUB_URL: 'https://a' }).source, 'HUB_URL')
    const third = resolveHubEnv({ NUXT_PUBLIC_HUB_API_URL: 'https://b' })
    assert.equal(third.url, 'https://b')
    assert.match(third.warnings[0], /rename it to NUXT_PUBLIC_HUB_URL/)
  })

  test('nothing set -> explicit localhost default plus a problem (severity by mode)', () => {
    const dev = resolveHubEnv({})
    assert.equal(dev.url, DEFAULT_HUB_URL)
    assert.equal(dev.source, 'default')
    assert.equal(dev.defaulted, true)
    assert.match(String(dev.problem), /NUXT_PUBLIC_HUB_URL is not set/)
    assert.match(String(dev.problem), /\(development\)$/)

    const prod = resolveHubEnv({}, { isProduction: true })
    assert.equal(prod.defaulted, true)
    assert.ok(!/development/.test(String(prod.problem)), 'production must not label the problem as development')
  })

  test('a missing app id is its own problem (Hub rejects requests without X-App-Id)', () => {
    const r = resolveHubEnv({ NUXT_PUBLIC_HUB_URL: 'https://hub' })
    assert.equal(r.appId, '')
    assert.match(String(r.problem), /NUXT_PUBLIC_HUB_APP_ID is not set/)
    const withLegacyApp = resolveHubEnv({ NUXT_PUBLIC_HUB_URL: 'https://hub', HUB_APP_ID: 'tm-trading_x' })
    assert.equal(withLegacyApp.appId, 'tm-trading_x')
    assert.equal(withLegacyApp.appIdSource, 'HUB_APP_ID')
    assert.equal(withLegacyApp.problem, null)
  })

  test('the keys are declared once, preferred first', () => {
    assert.equal(HUB_URL_KEYS[0], 'NUXT_PUBLIC_HUB_URL')
    assert.equal(HUB_APP_ID_KEYS[0], 'NUXT_PUBLIC_HUB_APP_ID')
  })

  test('the startup report warns in dev and errors in production, always naming the winner', () => {
    const calls: Array<[string, string]> = []
    const logger = {
      warn: (m: string) => calls.push(['warn', m]),
      error: (m: string) => calls.push(['error', m]),
      info: (m: string) => calls.push(['info', m]),
    } as unknown as Pick<Console, 'warn' | 'error' | 'info'>

    hubEnvReport(resolveHubEnv({ NUXT_PUBLIC_HUB_URL: 'https://hub', NUXT_PUBLIC_HUB_APP_ID: 'tm-trading_x' }), { log: logger })
    assert.deepEqual(calls.map(c => c[0]), ['info'], 'a complete config is one info line, no noise')
    assert.match(calls[0][1], /hubUrl=https:\/\/hub \(from NUXT_PUBLIC_HUB_URL\), appId=tm-trading_x/)

    calls.length = 0
    hubEnvReport(resolveHubEnv({}), { isProduction: true, log: logger })
    assert.deepEqual(calls.map(c => c[0]), ['error', 'info'], 'a missing Hub URL in production is an error')
  })
})

describe('one endpoint for login and for every Hub call', () => {
  test('useAuth and useHub share useHubEndpoint — no private localhost fallback', () => {
    for (const file of ['app/composables/useAuth.ts', 'app/composables/useHub.ts']) {
      const src = read(file)
      assert.match(src, /useHubEndpoint\(\)/, `${file} must resolve through the shared helper`)
      assert.ok(!/localhost:4000/.test(src), `${file} must not carry its own Hub fallback`)
    }
    const helper = read('app/utils/hub.ts')
    assert.match(helper, /export function useHubEndpoint/)
    assert.match(helper, /DEFAULT_HUB_URL/, 'the only fallback lives in the shared resolver')
    assert.match(helper, /hubUrlSource/, 'the resolved source is surfaced for diagnostics')
    const shared = read('shared/utils/hubEnv.ts')
    assert.match(shared, /export function resolveHubEnv/)
  })

  test('nuxt.config resolves through the shared resolver and exposes the source', () => {
    const cfg = read('nuxt.config.ts')
    assert.match(cfg, /import \{ hubEnvReport, resolveHubEnv \} from '\.\/shared\/utils\/hubEnv'/)
    assert.match(cfg, /hubEnvReport\(HUB_ENV, \{ isProduction: IS_PRODUCTION \}\)/, 'the chosen source is logged at startup')
    assert.match(cfg, /hubUrl: HUB_ENV\.url/)
    assert.match(cfg, /hubUrlSource: HUB_ENV\.source/)
    assert.ok(!/process\.env\.NUXT_PUBLIC_HUB_URL \|\|/.test(cfg), 'no silent `||` chain in the config')
  })

  test('the admin SDK snippet documents the real variable name', () => {
    const src = read('app/pages/admin-system/docs.vue')
    assert.ok(!/NUXT_PUBLIC_HUB_API_URL/.test(src), 'the snippet must not teach an env name this app does not read')
    assert.match(src, /NUXT_PUBLIC_HUB_URL/)
  })
})
