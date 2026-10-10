// ai/proposal.mjs
// AI Experiment Proposal validator (roadmap §27.3): validates and normalizes
// structured proposals produced by the AI research layer.
//
// Schema (§27.3):
// {
//   proposalId: string,
//   strategyVersionId?: string|null,
//   hypothesis: string,
//   changes: Array<{ parameter: string, from: unknown, to: unknown }>,
//   evidence: Array<{ metric: string, value: number, sampleSize: number }>,
//   risks: string[],
//   recommendedTest: { symbols?: string[], timeframes?: string[] }
// }
//
// PURE, fail-soft (returns `{ok:false, errors}` for invalid proposals, never throws).

export const PROPOSAL_SCHEMA_VERSION = 'proposal.v1'

const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/**
 * Validate and normalize a proposal object against §27.3 schema.
 * @returns {{ok:boolean, proposal?:object, errors?:string[]}}
 */
export function validateProposal(input) {
  const errors = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['proposal must be an object'] }
  }

  const proposalId = str(input.proposalId)
  if (!proposalId) errors.push('proposalId is required')

  const hypothesis = str(input.hypothesis)
  if (!hypothesis) errors.push('hypothesis is required')

  const changes = []
  if (Array.isArray(input.changes)) {
    for (let i = 0; i < input.changes.length; i++) {
      const c = input.changes[i]
      if (!c || typeof c !== 'object') { errors.push(`changes[${i}] must be an object`); continue }
      const parameter = str(c.parameter)
      if (!parameter) errors.push(`changes[${i}].parameter is required`)
      else changes.push({ parameter, from: c.from ?? null, to: c.to ?? null })
    }
  }

  const evidence = []
  if (Array.isArray(input.evidence)) {
    for (let i = 0; i < input.evidence.length; i++) {
      const e = input.evidence[i]
      if (!e || typeof e !== 'object') { errors.push(`evidence[${i}] must be an object`); continue }
      const metric = str(e.metric)
      const val = Number(e.value)
      const sample = Number(e.sampleSize)
      if (!metric) errors.push(`evidence[${i}].metric is required`)
      if (!Number.isFinite(val)) errors.push(`evidence[${i}].value must be a finite number`)
      if (!Number.isInteger(sample) || sample < 0) errors.push(`evidence[${i}].sampleSize must be a non-negative integer`)
      if (metric && Number.isFinite(val) && Number.isInteger(sample) && sample >= 0) {
        evidence.push({ metric, value: val, sampleSize: sample })
      }
    }
  }

  const risks = Array.isArray(input.risks) ? input.risks.map(str).filter(Boolean) : []

  const rec = input.recommendedTest && typeof input.recommendedTest === 'object' ? input.recommendedTest : {}
  const recommendedTest = {
    symbols: Array.isArray(rec.symbols) ? rec.symbols.map(str).filter(Boolean) : [],
    timeframes: Array.isArray(rec.timeframes) ? rec.timeframes.map(str).filter(Boolean) : [],
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    proposal: {
      proposalId,
      strategyVersionId: str(input.strategyVersionId) ?? null,
      hypothesis,
      changes,
      evidence,
      risks,
      recommendedTest,
      schemaVersion: PROPOSAL_SCHEMA_VERSION,
    },
  }
}

/**
 * Parse an LLM response text into validated proposals (handles markdown code blocks).
 * @returns {{proposals:object[], errors:string[]}}
 */
export function parseProposalsText(text) {
  if (!text || typeof text !== 'string') return { proposals: [], errors: ['input text is empty'] }
  let cleaned = text.trim()
  if (cleaned.includes('```')) {
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (match) cleaned = match[1].trim()
  }

  let parsed = null
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    return { proposals: [], errors: [`JSON parse error: ${e?.message || e}`] }
  }

  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.proposals) ? parsed.proposals : [parsed]
  const proposals = []
  const errors = []

  for (let i = 0; i < list.length; i++) {
    const res = validateProposal(list[i])
    if (res.ok) proposals.push(res.proposal)
    else errors.push(`item[${i}]: ${res.errors.join(', ')}`)
  }

  return { proposals, errors }
}