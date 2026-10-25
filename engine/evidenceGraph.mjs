// engine/evidenceGraph.mjs
// The LINKS between a session's evidence and everything a reader would need to
// reconstruct it (roadmap Phase F): journal rows, news packets, experiments and
// related backtest/session sets.
//
// Pure on purpose: callers hydrate the records (Mongo, run series) and this
// module decides what the graph SAYS. The digest is deterministic text carrying
// record ids, because an AI analysis that cannot name the rows it read is not
// evidence — it is prose.

export const EVIDENCE_LINK_SCHEMA_VERSION = 'evidence-links.v1'

const clean = (v) => {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

const ids = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(clean).filter(Boolean))].sort()

const fmtN = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '-')

const fmtTs = (v) => {
  const n = v instanceof Date ? v.getTime() : Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : '-'
}

const idOf = (row, ...fields) => {
  for (const f of fields) {
    const v = clean(row?.[f])
    if (v) return v
  }
  return ''
}

/** Every record id the graph cites, grouped by kind. */
export function bundleCitations(bundle = {}) {
  const keys = bundle?.keys ?? {}
  return {
    evidenceSetId: clean(bundle?.setId) || null,
    sessionId: clean(bundle?.sessionId) || null,
    kind: clean(bundle?.kind) || null,
    orderKeys: ids(keys.orderKeys),
    fillKeys: ids(keys.fillKeys),
    positionKeys: ids(keys.positionKeys),
    journalKeys: ids(keys.journalKeys),
    datasetIds: ids(bundle?.dataQuality?.datasets),
  }
}

/**
 * A one-line-answer summary of what the graph actually holds — counts, not
 * prose. `missing` names the links that do not exist, so an absent journal is
 * visible as a gap instead of looking like a session that simply had no trades.
 */
export function linkSummary({ bundle = null, journal = [], news = [], experiments = [], relatedSets = [] } = {}) {
  const citations = bundleCitations(bundle ?? {})
  const journalKeys = ids(journal.map((r) => r?.key ?? r?.journalKey))
  const newsIds = ids(news.map((r) => idOf(r, 'setId', '_id')))
  const experimentIds = ids(experiments.map((r) => idOf(r, 'experimentId', '_id')))
  const relatedIds = ids(relatedSets.map((r) => idOf(r, 'setId', '_id')))

  const missing = []
  if (journalKeys.length === 0) missing.push('journal')
  if (newsIds.length === 0) missing.push('news')
  if (experimentIds.length === 0) missing.push('experiment')
  if (citations.evidenceSetId && relatedIds.length === 0) missing.push('related-sets')
  if (!citations.evidenceSetId) missing.push('evidence-set')

  return {
    schema: EVIDENCE_LINK_SCHEMA_VERSION,
    counts: {
      orders: citations.orderKeys.length,
      fills: citations.fillKeys.length,
      trades: Array.isArray(bundle?.trades) ? bundle.trades.length : 0,
      journal: journalKeys.length,
      news: newsIds.length,
      experiments: experimentIds.length,
      relatedSets: relatedIds.length,
    },
    missing,
    citations: {
      ...citations,
      journalKeys,
      newsSetIds: newsIds,
      experimentIds,
      relatedSetIds: relatedIds,
    },
  }
}

/**
 * Limitations the LINKS contribute. Kept separate from the bundle's own
 * limitations so a reader can tell "the run was too small" (source) apart from
 * "nothing points at the journal" (linkage).
 */
export function graphLimitations({ bundle = null, journal = [], news = [], experiments = [], relatedSets = [] } = {}) {
  const out = []
  if (!bundle) out.push('no evidence bundle — the session has no frozen set and could not be previewed')
  else if (bundle.frozen !== true) out.push('this graph is a LIVE PREVIEW — the evidence set is not frozen yet')
  if (journal.length === 0) out.push('no journal rows are linked to this session — outcome analysis cannot use trade notes/regimes')
  if (news.length === 0) out.push('no news evidence set is linked to this session or its experiment')
  if (experiments.length === 0) out.push('no experiment cites this evidence yet')
  if (relatedSets.length === 0) out.push('no related backtest/session evidence shares this identity')
  return out
}

const sortRows = (rows, keyOf) => [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
  const ka = keyOf(a)
  const kb = keyOf(b)
  return ka < kb ? -1 : ka > kb ? 1 : 0
})

/**
 * Deterministic, ID-carrying digest of the graph for an AI prompt. The same
 * facts always produce the same text (sorted, ISO timestamps, fixed decimals),
 * so a proposal generated from it can be reproduced from the digest alone.
 */
export function graphDigest({ session = null, bundle = null, orders: orderRows = [], fills: fillRows = [], journal = [], news = [], experiments = [], relatedSets = [], pit = null } = {}) {
  const lines = ['evidence links ' + EVIDENCE_LINK_SCHEMA_VERSION]
  const links = linkSummary({ bundle, journal, news, experiments, relatedSets })
  const sid = clean(bundle?.sessionId ?? session?.sessionId ?? session?._id) || '-'
  const state = clean(session?.state ?? bundle?.state) || 'unknown'
  const sealed = bundle?.sealed === true ? 'yes' : 'no'

  lines.push(`session ${sid} kind=${clean(bundle?.kind ?? session?.kind) || '-'} state=${state} sealed=${sealed}`)
  if (bundle) {
    lines.push(`evidence ${clean(bundle.setId) || '-'} hash=${clean(bundle.hash) || 'unfrozen'} frozen=${bundle.frozen === true ? 'yes' : 'no'}`)
    const m = bundle.manifest ?? null
    lines.push(
      `identity engine=${clean(m?.engine?.version) || '-'} strategy=${clean(bundle.strategyVersionId ?? m?.strategy?.versionId) || '-'}` +
      ` params=${clean(m?.strategy?.paramsHash) || '-'} data=${clean(m?.data?.dataHash ?? m?.dataHash) || '-'}`
    )
    lines.push(
      `window ${fmtTs(bundle?.pointInTime?.sessionStartedAt)}..${fmtTs(bundle?.pointInTime?.sessionStoppedAt)}` +
      ` trades=${fmtN(bundle?.metrics?.trades, 0)} rMeasured=${fmtN(bundle?.metrics?.rMeasured, 0)}` +
      ` sufficient=${bundle?.metrics?.sufficient === true ? 'yes' : 'no'}`
    )
    const orders = sortRows(orderRows, (o) => idOf(o, 'clientOrderId', '_id'))
    for (const o of orders) {
      lines.push(`order ${idOf(o, 'clientOrderId', '_id')} status=${clean(o.status) || '-'} symbol=${clean(o.symbol) || '-'} side=${clean(o.side) || '-'}`)
    }
    for (const f of sortRows(fillRows, (f) => idOf(f, 'fillId', '_id'))) {
      lines.push(`fill ${idOf(f, 'fillId', '_id')} qty=${fmtN(f.qty, 4)} price=${fmtN(f.price, 4)} fee=${fmtN(f.fee, 4)}`)
    }
    const trades = sortRows(bundle.trades, (t) => clean(t.key))
    for (const t of trades) {
      lines.push(
        `trade ${clean(t.key) || '-'} ${clean(t.symbol) || '-'} dir=${t.dir ?? '-'}` +
        ` entry=${fmtTs(t.entryTime)} exit=${fmtTs(t.exitTime)} r=${fmtN(t.rMultiple)} pnl=${fmtN(t.pnlAbs)} result=${clean(t.result) || '-'}`
      )
    }
  }
  for (const j of sortRows(journal, (r) => idOf(r, 'key', 'journalKey'))) {
    lines.push(
      `journal ${idOf(j, 'key', 'journalKey')} ${clean(j.symbol) || '-'} result=${clean(j.result) || '-'}` +
      ` r=${fmtN(j.rMultiple)} pnl=${fmtN(j.pnlAbs)} entry=${fmtTs(j.entryTime)} exit=${fmtTs(j.exitTime)}`
    )
  }
  for (const n of sortRows(news, (r) => idOf(r, 'setId', '_id'))) {
    lines.push(
      `news ${idOf(n, 'setId', '_id')} purpose=${clean(n.purpose) || '-'} asOf=${fmtTs(n.asOf)}` +
      ` symbols=${ids(n.symbols).join(',') || '-'} items=${Array.isArray(n.itemIds) ? n.itemIds.length : 0}`
    )
  }
  for (const e of sortRows(experiments, (r) => idOf(r, 'experimentId', '_id'))) {
    lines.push(
      `experiment ${idOf(e, 'experimentId', '_id')} status=${clean(e.status) || '-'}` +
      ` candidate=${clean(e.strategyVersionId) || '-'} baseline=${clean(e.baselineVersionId) || '-'}` +
      ` evidence=${clean(e.evidenceSetId) || '-'}`
    )
  }
  for (const r of sortRows(relatedSets, (x) => idOf(x, 'setId', '_id'))) {
    lines.push(`related ${idOf(r, 'setId', '_id')} kind=${clean(r.kind) || '-'} trades=${fmtN(r?.metrics?.trades, 0)}`)
  }
  const limits = [...(Array.isArray(bundle?.limitations) ? bundle.limitations : []), ...graphLimitations({ bundle, journal, news, experiments, relatedSets })]
  for (const l of limits) lines.push(`limit ${l}`)
  if (pit && typeof pit === 'object') {
    const codes = (Array.isArray(pit.violations) ? pit.violations : []).map((v) => String(v?.code ?? '')).filter(Boolean)
    lines.push(`pit ok=${pit.ok === true ? 'yes' : 'no'}${codes.length ? ` codes=${[...new Set(codes)].join(',')}` : ''}`)
  }
  lines.push(`missing ${links.missing.join(',') || 'none'}`)
  return lines.join('\n')
}

/**
 * Allowlist of record ids a generated analysis may cite. Anything outside this
 * set did not come from the evidence and must be rejected, not stored.
 */
export function graphIds({ bundle = null, journal = [], news = [], experiments = [], relatedSets = [] } = {}) {
  const links = linkSummary({ bundle, journal, news, experiments, relatedSets })
  return ids([
    links.citations.sessionId,
    links.citations.evidenceSetId,
    ...links.citations.orderKeys,
    ...links.citations.fillKeys,
    ...links.citations.positionKeys,
    ...links.citations.journalKeys,
    ...links.citations.datasetIds,
    ...links.citations.newsSetIds,
    ...links.citations.experimentIds,
    ...links.citations.relatedSetIds,
  ])
}
