import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SERVICES } from '../services/registry.mjs'
import { READINESS_RULE_IDS } from '../services/readiness.mjs'

// =============================================================================
//  Operations i18n closed sets (V4.2 §17.9).
//
//  The service table renders almost everything through DYNAMIC keys
//  (t(`operations.services.state.${observed}`)), which the repository-wide
//  literal-key suite cannot see. That suite would happily pass while a service
//  shows the raw key `operations.services.labels.signals` to the user.
//
//  So this suite pins the closed sets instead: every value the API can return
//  must have a label in BOTH locales, and the audit/phase vocabulary is derived
//  from the supervisor source itself so it cannot drift from the code.
// =============================================================================

const ROOT = process.cwd()
const BASE = 'operations.services'

type Json = Record<string, unknown>

const readLocale = (name: string): Json =>
  JSON.parse(readFileSync(join(ROOT, 'i18n', 'locales', `${name}.json`), 'utf8')) as Json

const resolve = (data: Json, key: string): unknown =>
  key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Json)[part] : undefined), data)

const hasKey = (data: Json, key: string): boolean => {
  const value = resolve(data, key)
  return typeof value === 'string' && value.trim().length > 0
}

const en = readLocale('en')
const vi = readLocale('vi')

function scan(file: string, pattern: RegExp): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8')
  const out: string[] = []
  const re = new RegExp(pattern.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) out.push(match[1])
  return out
}

// Derived from the supervisor source: the audit actions and phases it can
// actually emit. A new phase in the code fails here until it is translated.
//
// The scan is deliberately anchored to the two ways an audit row is written
// (`audit('...')` and `store.appendAudit({ ... action: '...' })`). A naked
// `action: 'start'` elsewhere in the file is a command *request* field, not an
// audit action — its vocabulary is `ACTION_VALUES` below — and treating it as
// an audit action would demand a translation for something nobody renders.
const AUDIT_ACTIONS = [...new Set([
  ...scan('services/supervisor.mjs', /\baudit\('([a-z0-9-]+)'/),
  ...scan('services/supervisor.mjs', /appendAudit\(\{[\s\S]{0,400}?action:\s*'([a-z0-9-]+)'/),
])].sort()

const PHASES = [...new Set([
  ...scan('services/supervisor.mjs', /phase = '([a-z-]+)'/),
  ...scan('services/supervisor.mjs', /phase:\s*'([a-z-]+)'/),
])].sort()

const STATE_VALUES = ['UNKNOWN', 'STARTING', 'READY', 'DEGRADED', 'STOPPING', 'STOPPED', 'FAILED']
const HEALTH_VALUES = ['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']
const DESIRED_VALUES = ['RUNNING', 'STOPPED']
const ACTION_VALUES = ['start', 'stop', 'restart', 'reset', 'probe', 'run-once']
const OPERATION_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCONFIRMED']

function requiredKeys(): string[] {
  const keys: string[] = []
  const push = (suffix: string, values: readonly string[]) => {
    for (const value of values) keys.push(`${BASE}.${suffix}.${value}`)
  }

  push('labels', SERVICES.map(service => service.id))
  push('category', [...new Set(SERVICES.map(service => service.category))])
  push('scope', [...new Set(SERVICES.map(service => service.scope))])
  push('mode', [...new Set(SERVICES.map(service => service.executionMode))])
  push('state', STATE_VALUES)
  push('health', HEALTH_VALUES)
  push('desired', DESIRED_VALUES)
  push('actions', ACTION_VALUES)
  push('operationState', OPERATION_STATES)
  push('rules', READINESS_RULE_IDS)
  push('phase', PHASES)
  push('audit', AUDIT_ACTIONS)

  return keys
}

describe('operations i18n closed sets', () => {
  test('the scan found real vocabulary (a silent no-match would pass)', () => {
    assert.ok(AUDIT_ACTIONS.length >= 9, `expected audit actions, got ${AUDIT_ACTIONS.length}`)
    assert.ok(PHASES.length >= 8, `expected phases, got ${PHASES.length}`)
    assert.ok(SERVICES.length >= 20)
  })

  test('every dynamic operations key exists in en AND vi', () => {
    const keys = requiredKeys()
    const missing = keys.filter(key => !hasKey(en, key) || !hasKey(vi, key))
    assert.deepEqual(missing, [], `missing/empty operations i18n keys:\n${missing.join('\n')}`)
  })

  test('en and vi expose the same operations.services leaf set', () => {
    const leaf = (obj: unknown, prefix = '', out: string[] = []): string[] => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
      for (const [key, value] of Object.entries(obj as Json)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object' && !Array.isArray(value)) leaf(value, path, out)
        else out.push(path)
      }
      return out
    }
    const enLeafs = leaf(resolve(en, BASE)).sort()
    const viLeafs = leaf(resolve(vi, BASE)).sort()
    assert.deepEqual(enLeafs.filter(k => !viLeafs.includes(k)), [], 'keys only in en')
    assert.deepEqual(viLeafs.filter(k => !enLeafs.includes(k)), [], 'keys only in vi')
  })
})
