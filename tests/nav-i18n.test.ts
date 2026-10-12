import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// =============================================================================
//  §58.9 Slice 6 — navigation placement + polish.
//
//  The V3.3 sidebar is driven entirely by Hub route records whose `label` is a
//  `nav.*` i18n key; `useNavMenu.translateRouteLabel` falls back to the raw key
//  when a translation is missing, so a gap renders literal `nav.xxx` to the user.
//  This suite locks the sidebar label surface: every target-IA group/leaf label
//  (§58.2) resolves in BOTH locales, and en/vi define exactly the same keys.
//  It also proves the secondary Tools/Utilities group stayed translated after the
//  shared-core placement moved Media/Inbox/Notifications/Connections/Import/Queues.
// =============================================================================

const ROOT = process.cwd()

type Json = Record<string, unknown>

function parse(locale: string): Json {
  return JSON.parse(readFileSync(join(ROOT, 'i18n', 'locales', `${locale}.json`), 'utf8')) as Json
}

const en = parse('en')
const vi = parse('vi')

/** Every `nav.*` label the §58.2 target IA seeds (groups + leaves), minus the home key. */
const TARGET_IA_NAV_LABELS = [
  // groups
  'markets', 'trading', 'strategy_lab', 'test_center', 'data_research',
  'alerts_notifications', 'shared_resources', 'admin_system', 'tools',
  // 2. Markets
  'market_intel', 'market_explorer', 'scanner', 'news_calendar',
  // 3. Trading
  'trade_terminal', 'signals', 'paper', 'orders', 'positions', 'accounts',
  // 4. Strategy Lab
  'strategies', 'indicators', 'methods', 'bot_profiles', 'bot_instances',
  // 5. Test Center
  'new_test', 'historical_runs', 'forward_tests', 'replay_training', 'compare_validation',
  // 6. Data & Research
  'data_center', 'datasets', 'market_recordings', 'data_quality', 'data_lineage',
  'ai_research', 'experiments', 'journal',
  // 7. Alerts & Notifications
  'alert_rules', 'notification_history', 'inbox',
  // 8. Shared Resources
  'media', 'import', 'connections', 'queues',
  // 9. Administration & System
  'users', 'roles', 'permissions', 'routes', 'configs',
  'market_data_sources', 'health', 'logs', 'profile', 'docs', 'settings',
  // Secondary Tools
  'utilities_text', 'utilities_icons', 'utilities_encode', 'utilities_random', 'utilities_editor'
] as const

const navOf = (data: Json): Record<string, unknown> => (data.nav ?? {}) as Record<string, unknown>

describe('navigation i18n surface (§58.9 Slice 6)', () => {
  for (const [locale, data] of [['en', en], ['vi', vi]] as const) {
    it(`${locale} translates every target-IA nav label`, () => {
      const nav = navOf(data)
      const missing = TARGET_IA_NAV_LABELS.filter((k) => {
        const v = nav[k]
        return typeof v !== 'string' || v.trim() === ''
      })
      assert.deepEqual(missing, [], `${locale}: missing/empty nav.* ${missing.join(', ')}`)
    })
  }

  it('en and vi define exactly the same nav.* keys', () => {
    const fe = Object.keys(navOf(en)).sort()
    const fv = Object.keys(navOf(vi)).sort()
    assert.deepEqual(fe, fv)
  })

  it('no nav.* value is left as its raw key (untranslated fallback)', () => {
    for (const [locale, data] of [['en', en], ['vi', vi]] as const) {
      const nav = navOf(data)
      const raw = Object.entries(nav)
        .filter(([k, v]) => typeof v === 'string' && (v === k || v === `nav.${k}`))
        .map(([k]) => `${locale}:${k}`)
      assert.deepEqual(raw, [], `raw/untranslated nav keys: ${raw.join(', ')}`)
    }
  })
})
