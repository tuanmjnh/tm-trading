import { aiAgentsStatus } from '../../../utils/aiAgents'

// =============================================================================
//  GET /api/v1/ai/agents — AI agent observability (V3.4 Slice B, read-only).
//
//  There is no persistent agent runtime; this reports what exists: gateway
//  config status (presence flags only, never secrets), the static tool
//  allowlist from ai/agent.mjs, and counts of persisted AI outputs. Token
//  required (D10). Fail-soft: store blips yield zeroed counts, never a 500.
// =============================================================================

export default defineEventHandler(async (event) => {
  return { success: true, data: await aiAgentsStatus(requireOwnerId(event)) }
})
