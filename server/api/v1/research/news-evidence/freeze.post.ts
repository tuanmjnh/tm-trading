// POST /api/v1/research/news-evidence/freeze — freeze a PIT-cut news evidence
// set (V3.5 §60 Slice E). Body: { group, symbols[], horizon, purpose,
// lookbackHours, asOfMs }. Deterministic id — refreeze is a no-op.
import { freezeNewsEvidenceSet } from '~~/server/utils/newsEvidence'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  return freezeNewsEvidenceSet({
    ownerId: requireOwnerId(event),
    group: body.group ? String(body.group) : undefined,
    symbols: Array.isArray(body.symbols) ? body.symbols.map(String) : undefined,
    horizon: body.horizon ? String(body.horizon) : undefined,
    purpose: body.purpose ? String(body.purpose) : undefined,
    lookbackHours: Number.isFinite(Number(body.lookbackHours)) ? Number(body.lookbackHours) : undefined,
    asOfMs: Number.isFinite(Number(body.asOfMs)) ? Number(body.asOfMs) : undefined,
  })
})
