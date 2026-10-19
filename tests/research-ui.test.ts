import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// =============================================================================
//  §58.9 Slice 5 — AI Research workspace UI contract.
//
//  The pages are thin over the engine; this suite locks the two things a
//  build-time check cannot: every leaf page/composable/type file exists, and the
//  i18n surface is complete AND symmetric across en/vi (a missing vi key renders
//  a raw key to a Vietnamese user). It does not render Vue — that is typecheck's
//  job — it guarantees no user-facing string is left untranslated.
// =============================================================================

const ROOT = process.cwd()
const PAGES = join(ROOT, 'app', 'pages', 'data-research', 'research')

type Json = Record<string, unknown>

function flatten(obj: Json, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Json, key, out)
    else out[key] = v
  }
  return out
}

const en = JSON.parse(readFileSync(join(ROOT, 'i18n', 'locales', 'en.json'), 'utf8')) as Json
const vi = JSON.parse(readFileSync(join(ROOT, 'i18n', 'locales', 'vi.json'), 'utf8')) as Json

const STATUSES = ['all', 'proposed', 'approved', 'running', 'backtested', 'holdout', 'paper_validation', 'accepted', 'rejected']
const ROLES = ['baseline', 'candidate', 'random', 'holdout']
const GATE_KEYS = ['hasArms', 'beatBaseline', 'beatRandom', 'sampleSize', 'holdout', 'noDegeneracy', 'riskPreserved', 'reproducible']
const METRICS = ['winRate', 'profitFactor', 'expectancyR', 'medianR', 'netPct', 'maxDrawdownPct']
const EVIDENCE_KINDS = ['paper-session', 'replay-session', 'backtest-run', 'dataset']
const SET_COLUMNS = ['source', 'kind', 'version', 'trades', 'hash', 'frozen']
const SET_METRICS = ['trades', 'wins', 'losses', 'expectancy', 'totalR', 'net', 'floor', 'rMeasured']
const SET_TRADE = ['key', 'symbol', 'entry', 'exit', 'r', 'reason']
const SET_DETAIL = [
  'title', 'noSet', 'identity', 'setId', 'sourceId', 'sessionId', 'sourceState',
  'instruments', 'timeframes', 'sessionStartedAt', 'sessionStoppedAt', 'createdBy', 'schemaVersion',
  'integrity', 'verified', 'integrityOk', 'integrityFailed', 'sufficiency', 'sample', 'moving',
  'counts', 'dataQuality', 'limitations', 'noLimitations', 'citedBy', 'citedByEmpty', 'trades', 'noTrades', 'openSource', 'openDatasets'
]
const FREEZE_KEYS = [
  'action', 'title', 'desc', 'sourceId', 'sourceIdPlaceholder', 'notes', 'notesPlaceholder',
  'confirm', 'success', 'alreadyFrozen', 'sourceChanged', 'sourceRequired'
]

/** Every research.* key the three pages/composable read (kept explicit on purpose). */
const REQUIRED: string[] = [
  'analyzeTitle', 'analyzeDesc', 'experimentsTitle', 'experimentsDesc',
  'viewResearch', 'viewExperiments', 'backToList', 'load', 'none', 'open', 'createExperiment', 'guardrail',
  'strategyId', 'strategyPlaceholder', 'knownStrategies',
  'mongoDown', 'mongoDownShort',
  'evidenceTitle', 'profileLabel', 'activeVersionLabel', 'versionsLabel',
  'sampleTitle', 'totalSamples', 'minSample', 'sufficient', 'insufficientSample',
  'targetVersion', 'changes', 'evidence', 'evidenceNone', 'risks', 'recommendedTest', 'noTestPlan',
  'proposalsTitle', 'proposalsEmpty', 'proposalsEmptyDesc',
  'experimentsEmpty', 'experimentsEmptyHint',
  'detail.title', 'detail.noExperiment', 'detail.proposalLabel', 'detail.strategyVersionLabel', 'detail.createdLabel',
  'actions.title', 'actions.advanceTo', 'actions.accept', 'actions.reject', 'actions.terminal',
  'history.title',
  'comparison.title', 'comparison.complete', 'comparison.incomplete', 'comparison.metric',
  'comparison.baseline', 'comparison.candidate', 'comparison.delta', 'comparison.empty',
  'arms.title', 'arms.role', 'arms.trades', 'arms.winRate', 'arms.profitFactor', 'arms.expectancy', 'arms.net', 'arms.maxDD', 'arms.notRun',
  'run.symbols', 'run.symbolsPlaceholder', 'run.timeframes', 'run.timeframesPlaceholder', 'run.button', 'run.running',
  'gates.title', 'gates.allPass', 'gates.someFail', 'gates.empty',
  'create.action', 'create.title', 'create.desc', 'create.placeholder', 'create.notObject', 'create.success', 'create.confirm',
  'columns.experiment', 'columns.status', 'columns.hypothesis', 'columns.changes', 'columns.created',
  // §59.15 Slice E — frozen evidence sets + the governed paper-validation launch
  'viewEvidenceSets', 'pips.evidence',
  'sets.title', 'sets.desc', 'sets.guardrail', 'sets.empty', 'sets.emptyHint',
  'sets.kinds.all',
  'sets.rollup.total', 'sets.rollup.insufficient', 'sets.rollup.moving', 'sets.rollup.cited',
  'launch.action', 'launch.hint', 'launch.success',
  'approve.title', 'approve.desc', 'approve.loadingEvidence', 'approve.noEvidence',
  'approve.noEvidenceHint', 'approve.evidenceRequired', 'approve.verifyNote',
  'provenance.title', 'provenance.candidate', 'provenance.baseline', 'provenance.noBaseline',
  'provenance.evidenceSet', 'provenance.noEvidence', 'provenance.paperSessions', 'provenance.noPaperSessions',
  ...EVIDENCE_KINDS.map(k => `sets.kinds.${k}`),
  ...SET_COLUMNS.map(k => `sets.columns.${k}`),
  ...SET_METRICS.map(k => `sets.metrics.${k}`),
  ...SET_TRADE.map(k => `sets.trade.${k}`),
  ...SET_DETAIL.map(k => `sets.detail.${k}`),
  ...FREEZE_KEYS.map(k => `sets.freeze.${k}`),
  ...STATUSES.map(s => `status.${s}`),
  ...ROLES.map(r => `roles.${r}`),
  ...GATE_KEYS.map(k => `gateKeys.${k}`),
  ...METRICS.map(m => `metrics.${m}`)
]

describe('research workspace files exist (§58.9 Slice 5)', () => {
  it('the leaf pages exist', () => {
    assert.ok(existsSync(join(PAGES, 'index.vue')), 'missing research/index.vue')
    assert.ok(existsSync(join(PAGES, 'experiments', 'index.vue')), 'missing research/experiments/index.vue')
    assert.ok(existsSync(join(PAGES, 'experiments', '[id].vue')), 'missing research/experiments/[id].vue')
    assert.ok(existsSync(join(PAGES, 'evidence', 'index.vue')), 'missing research/evidence/index.vue')
    assert.ok(existsSync(join(PAGES, 'evidence', '[id].vue')), 'missing research/evidence/[id].vue')
  })

  it('the research composable + domain types exist', () => {
    assert.ok(existsSync(join(ROOT, 'app', 'composables', 'useResearch.ts')), 'missing useResearch.ts')
    assert.ok(existsSync(join(ROOT, 'types', 'research.ts')), 'missing types/research.ts')
  })
})

describe('research i18n surface (en + vi)', () => {
  for (const [locale, data] of [['en', en], ['vi', vi]] as const) {
    it(`${locale} defines every required research.* key`, () => {
      const flat = flatten((data.research ?? {}) as Json)
      const missing = REQUIRED.filter(k => flat[k] === undefined || flat[k] === '')
      assert.deepEqual(missing, [], `${locale}: missing/empty ${missing.join(', ')}`)
    })
  }

  it('en and vi define exactly the same research.* keys', () => {
    const fe = Object.keys(flatten((en.research ?? {}) as Json)).sort()
    const fv = Object.keys(flatten((vi.research ?? {}) as Json)).sort()
    assert.deepEqual(fe, fv)
  })
})
