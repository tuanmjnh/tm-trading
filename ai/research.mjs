// ai/research.mjs
// AI Research Layer (roadmap §27): builds the AI dataset from executed trades
// and turns LLM output into validated proposals.
//
// PURE core — no provider, no IO, no clock. The dataset builder is fed hydrated
// docs (TradeContext + Snapshots); the proposal validator normalizes LLM text
// into §27.3 schema. Everything here is testable offline.
//
// Guardrail (D7): proposals are DATA only. Nothing here can change production
// state — the human + exec/risk.mjs remain the only executable route.
//
// CLI: node ai/research.mjs --validate '{"proposalId":"p1",...}'
//       node ai/research.mjs --parse '<llm text>'

import { buildAiTradeRecord, hydrateAiDataset } from './dataset.mjs'
import { validateProposal, parseProposalsText } from './proposal.mjs'

export { buildAiTradeRecord, hydrateAiDataset } from './dataset.mjs'
export { validateProposal, parseProposalsText, PROPOSAL_SCHEMA_VERSION } from './proposal.mjs'

/**
 * Build the AI dataset from a list of hydrated TradeContext docs.
 * Fail-soft: a missing model keeps snapshotless records.
 */
export async function buildDataset({ tradeContexts, models } = {}) {
  return hydrateAiDataset({ tradeContexts: tradeContexts || [], models: models || {} })
}

/** Run the CLI. */
export async function main(argv = process.argv.slice(2)) {
  const args = argv.filter((a) => !a.startsWith('--'))
  if (argv.includes('--validate')) {
    const res = validateProposal(JSON.parse(args[0] || '{}'))
    console.log(JSON.stringify(res, null, 2))
    return res
  }
  if (argv.includes('--parse')) {
    const res = parseProposalsText(args[0] || '')
    console.log(JSON.stringify(res, null, 2))
    return res
  }
  console.error('usage: node ai/research.mjs --validate "<json>" | --parse "<text>"')
  return null
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) main()