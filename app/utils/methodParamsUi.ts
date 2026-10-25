/**
 * Bot launch — method parameter form metadata.
 *
 * Every engine method carries its OWN defaults (GET /api/v1/methods), so the
 * form is generated: known keys get an i18n label + an optional description
 * (the ⓘ info icon), unknown keys fall back to the raw key with a generic
 * number/boolean editor. Keys are grouped into signal / risk / cost sections.
 */

export type BotParamType = 'number' | 'boolean' | 'text'
export type BotParamGroup = 'signal' | 'risk' | 'cost'

export interface BotParamMeta {
  /** i18n key under strategyLab.bots.params.<key>.label — missing → raw key. */
  labelKey?: string
  /** i18n key under strategyLab.bots.params.<key>.desc — shown via the ⓘ icon
   *  ONLY when `special` is set (curated, non-obvious params). */
  descKey?: string
  special?: boolean
  type?: BotParamType
}

/** Params with a special meaning worth describing (drives the ⓘ icon). */
const META: Record<string, BotParamMeta> = {
  // --- shared risk / cost ---
  atrLen: { labelKey: 'atrLen', descKey: 'atrLen', type: 'number' },
  slBuf: { labelKey: 'slBuf', descKey: 'slBuf', type: 'number' },
  rrFb: { labelKey: 'rrFb', descKey: 'rrFb', type: 'number' },
  minRR: { labelKey: 'minRR', descKey: 'minRR', type: 'number' },
  slMinAtr: { labelKey: 'slMinAtr', descKey: 'slMinAtr', type: 'number' },
  slMaxAtr: { labelKey: 'slMaxAtr', descKey: 'slMaxAtr', type: 'number' },
  rP: { labelKey: 'rP', descKey: 'rP', type: 'number' },
  feePct: { labelKey: 'feePct', descKey: 'feePct', type: 'number' },
  slipPct: { labelKey: 'slipPct', descKey: 'slipPct', type: 'number' },
  // --- orderflow ---
  volLen: { labelKey: 'volLen', descKey: 'volLen', type: 'number' },
  spikeMult: { labelKey: 'spikeMult', descKey: 'spikeMult', type: 'number' },
  deltaTh: { labelKey: 'deltaTh', descKey: 'deltaTh', special: true, type: 'number' },
  divOn: { labelKey: 'divOn', type: 'boolean' },
  divLen: { labelKey: 'divLen', descKey: 'divLen', type: 'number' },
  // --- wonderwhales ---
  mode: { labelKey: 'wwMode', descKey: 'wwMode', type: 'text' },
  psarStart: { labelKey: 'psarStart', descKey: 'psarStart', type: 'number' },
  psarInc: { labelKey: 'psarInc', descKey: 'psarInc', type: 'number' },
  psarMax: { labelKey: 'psarMax', descKey: 'psarMax', type: 'number' },
  fast: { labelKey: 'fast', descKey: 'fast', type: 'number' },
  slow: { labelKey: 'slow', descKey: 'slow', type: 'number' },
  minAtrPct: { labelKey: 'minAtrPct', descKey: 'minAtrPct', special: true, type: 'number' },
  // --- trend / price action / sweep shared signal toggles ---
  pullOn: { labelKey: 'pullOn', type: 'boolean' },
  brkOn: { labelKey: 'brkOn', type: 'boolean' },
  rngOn: { labelKey: 'rngOn', type: 'boolean' },
  engOn: { labelKey: 'engOn', type: 'boolean' },
  insOn: { labelKey: 'insOn', type: 'boolean' },
  bosOn: { labelKey: 'bosOn', type: 'boolean' },
  entryMode: { labelKey: 'entryMode', descKey: 'entryMode', special: true, type: 'text' }
}

const RISK_KEYS = new Set(['slBuf', 'rrFb', 'minRR', 'slMinAtr', 'slMaxAtr', 'rP'])
const COST_KEYS = new Set(['feePct', 'slipPct'])

export interface BotParamItem {
  key: string
  type: BotParamType
  meta?: BotParamMeta
}

export interface BotParamSection {
  group: BotParamGroup
  items: BotParamItem[]
}

function typeOf(value: unknown): BotParamType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'text'
}

/** Split a method's defaults into ordered form sections. */
export function botParamSections(defaults: Record<string, unknown> = {}): BotParamSection[] {
  const signal: BotParamItem[] = []
  const risk: BotParamItem[] = []
  const cost: BotParamItem[] = []
  for (const [key, value] of Object.entries(defaults)) {
    const meta = META[key]
    const item: BotParamItem = { key, type: meta?.type ?? typeOf(value), meta }
    if (COST_KEYS.has(key)) cost.push(item)
    else if (RISK_KEYS.has(key)) risk.push(item)
    else signal.push(item)
  }
  const sections: BotParamSection[] = []
  if (signal.length) sections.push({ group: 'signal', items: signal })
  if (risk.length) sections.push({ group: 'risk', items: risk })
  if (cost.length) sections.push({ group: 'cost', items: cost })
  return sections
}
