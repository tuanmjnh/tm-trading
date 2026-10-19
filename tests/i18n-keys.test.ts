import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// =============================================================================
//  i18n literal-key contract (AGENTS.md: "All user-facing strings MUST be
//  defined in BOTH i18n/locales/en.json and i18n/locales/vi.json").
//
//  A page calling t('inbox.download') with no such key renders the RAW KEY to
//  the user, and a key that exists in only one locale silently degrades for the
//  other language. Neither failure shows up in a build or in vue-tsc, so this
//  suite re-derives them from the source: every literal t('…') in the app must
//  resolve to a non-empty string in BOTH locales.
//
//  Dynamic keys (t(`status.${s}`), t(key)) cannot be checked statically — the
//  suites that own those namespaces (research-ui, nav-i18n) pin the closed sets
//  of values they are built from instead.
// =============================================================================

const ROOT = process.cwd()
type Json = Record<string, unknown>

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['node_modules', '.nuxt', '.output', 'dist'].includes(entry.name)) continue
      walk(join(dir, entry.name), out)
    } else if (/\.(vue|ts)$/.test(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

const readLocale = (name: string): Json =>
  JSON.parse(readFileSync(join(ROOT, 'i18n', 'locales', `${name}.json`), 'utf8')) as Json

const leafKeys = (obj: Json, prefix = '', out: string[] = []): string[] => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) leafKeys(v as Json, key, out)
    else out.push(key)
  }
  return out
}

const resolve = (data: Json, key: string): unknown =>
  key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Json)[part] : undefined), data)

const en = readLocale('en')
const vi = readLocale('vi')

// Literal t('…') only: template literals and variable arguments are covered by
// the closed-set suites of their own namespaces.
const LITERAL_KEY = /\bt\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g

interface Use { key: string; file: string; line: number }

const uses: Use[] = []
for (const file of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'shared'))]) {
  const src = readFileSync(file, 'utf8')
  const re = new RegExp(LITERAL_KEY.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    uses.push({ key: m[1], file: file.replace(/\\/g, '/'), line: src.slice(0, m.index).split('\n').length })
  }
}

const missing = uses.filter((u) => {
  const e = resolve(en, u.key)
  const v = resolve(vi, u.key)
  return typeof e !== 'string' || e === '' || typeof v !== 'string' || v === ''
})

describe('i18n literal keys resolve in both locales', () => {
  it('the scan actually found the app source (a silent no-match would pass)', () => {
    assert.ok(uses.length > 500, `expected hundreds of t() uses, found ${uses.length}`)
    assert.ok(uses.some((u) => u.file.includes('/pages/')), 'no page matched the scan')
  })

  it('every literal t() key is a non-empty string in en AND vi', () => {
    const unique = [...new Set(missing.map((u) => u.key))].sort()
    const detail = missing.slice(0, 20).map((u) => `${u.key} (${u.file}:${u.line})`).join('\n')
    assert.deepEqual(unique, [], `keys missing or empty in a locale:\n${detail}`)
  })
})

describe('en/vi locale parity', () => {
  const enLeafs = leafKeys(en).sort()
  const viLeafs = leafKeys(vi).sort()

  it('both locales parse to the same leaf-key set', () => {
    assert.deepEqual(
      enLeafs.filter((k) => !viLeafs.includes(k)),
      [],
      'keys present in en.json but not vi.json'
    )
    assert.deepEqual(
      viLeafs.filter((k) => !enLeafs.includes(k)),
      [],
      'keys present in vi.json but not en.json'
    )
  })

  it('no leaf is empty and none is left as its raw key', () => {
    const bad: string[] = []
    for (const [name, data] of [['en', en], ['vi', vi]] as const) {
      for (const key of leafKeys(data)) {
        const value = resolve(data, key)
        if (typeof value !== 'string') continue
        if (value.trim() === '') bad.push(`${name}:${key} (empty)`)
        if (value === key || value === `${name}.${key}`) bad.push(`${name}:${key} (raw key)`)
      }
    }
    assert.deepEqual(bad, [], `untranslated leaves: ${bad.slice(0, 20).join(', ')}`)
  })
})
