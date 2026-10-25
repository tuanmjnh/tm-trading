import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { askModuleAssistant, buildMarketEventContext, buildNewsItemContext, buildOutlookContext, buildProviderContext, buildSessionContext, buildSignalContext } from '../server/utils/moduleAssistant'

// =============================================================================
//  Phase H (§61.12) — read-only contextual assistant.
//
//  The contract under test is tenancy + grounding, not the prose: the bundle is
//  built from an OWNER-SCOPED read (a foreign id is a 404, never another user's
//  data), the H4 tools are owner-scoped reads gated by the A0 allowlist (the
//  owner is injected by the server, never chosen by the model), and the
//  guardrail prompt requires citations and fact/inference labels.
// =============================================================================

type Row = Record<string, any>

const sessionOf = (over: Row = {}): Row => ({
  _id: 'ses_1',
  sessionId: 'ses_1',
  kind: 'paper',
  ownerId: 'alice',
  state: 'running',
  accountId: 'default',
  instruments: ['BTCUSDT'],
  timeframes: ['60'],
  strategyVersionId: 'sv_1',
  botProfileId: null,
  startedAt: 1_000,
  stoppedAt: null,
  lastEventAt: 2_000,
  counts: { orders: 2, fills: 2, positions: 1 },
  timeline: [
    { t: 1_000, kind: 'created', message: 'queued' },
    { t: 2_000, kind: 'state', message: 'running' },
  ],
  ...over,
})

const deps = (over: Row = {}): Row => ({
  loadSession: async (id: string, ownerId?: string | null) => (id === 'ses_1' && ownerId === 'alice' ? sessionOf() : null),
  chat: async () => ({ text: 'The session is running.', model: 'm1', provider: 'test' }),
  now: () => 1_790_000_000_000,
  ...over,
})

const caught = async (p: Promise<unknown>) => {
  try {
    await p
    return null
  } catch (e) {
    return e as Row
  }
}

describe('buildSessionContext', () => {
  test('compact bundle: scope, id, refs and no owner/secret leakage', () => {
    const b = buildSessionContext(sessionOf(), 1_790_000_000_000)
    assert.equal(b.scope, 'session')
    assert.equal(b.session.id, 'ses_1')
    assert.equal(b.session.state, 'running')
    assert.deepEqual(b.session.instruments, ['BTCUSDT'])
    assert.equal(b.generatedAt, new Date(1_790_000_000_000).toISOString())
    assert.deepEqual(b.refs, [{ kind: 'session', id: 'ses_1' }])
    // The bundle must never carry the owner id or secrets downstream.
    assert.equal('ownerId' in b.session, false)
    assert.equal(JSON.stringify(b).includes('alice'), false)
  })

  test('caps the timeline and defaults counts', () => {
    const long = sessionOf({ timeline: Array.from({ length: 30 }, (_, i) => ({ t: i, kind: 'note', message: `e${i}` })), counts: undefined })
    const b = buildSessionContext(long)
    assert.equal(b.session.recentTimeline.length, 10)
    assert.deepEqual(b.session.counts, { orders: 0, fills: 0, positions: 0 })
  })

  test('rejects a non-object session', () => {
    assert.throws(() => buildSessionContext(null as unknown as Row), (e: Row) => e.statusCode === 404 && e.statusMessage === 'session_not_found')
  })
})

describe('askModuleAssistant', () => {
  test('answers from an owner-scoped bundle and echoes refs/model', async () => {
    const res = await askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1', question: 'What is the state?' }, deps())
    assert.equal(res.answer, 'The session is running.')
    assert.equal(res.model, 'm1')
    assert.equal(res.provider, 'test')
    assert.deepEqual(res.scope, { type: 'session', sessionId: 'ses_1' })
    assert.deepEqual(res.refs, [{ kind: 'session', id: 'ses_1' }])
  })

  test('another owner asking the same id gets 404 (no cross-tenant read)', async () => {
    const err = await caught(askModuleAssistant({ ownerId: 'mallory', sessionId: 'ses_1', question: 'state?' }, deps()))
    assert.equal(err?.statusCode, 404)
    assert.equal(err?.statusMessage, 'session_not_found')
  })

  test('an unknown session id is 404', async () => {
    const err = await caught(askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_x', question: 'state?' }, deps()))
    assert.equal(err?.statusCode, 404)
  })

  test('missing scope / question are 400', async () => {
    assert.equal((await caught(askModuleAssistant({ ownerId: 'alice', question: 'x' }, deps())))?.statusMessage, 'invalid_scope')
    assert.equal((await caught(askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1' }, deps())))?.statusMessage, 'invalid_question')
    assert.equal((await caught(askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1', question: '   ' }, deps())))?.statusMessage, 'invalid_question')
  })

  test('an over-long question is rejected', async () => {
    const err = await caught(askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1', question: 'x'.repeat(2001) }, deps()))
    assert.equal(err?.statusMessage, 'invalid_question')
  })

  test('the model gets the A0 owner-scoped tool specs, the guardrail prompt and the bundle in the user turn', async () => {
    let seen: Row | null = null
    const spy = async (messages: Row[], tools: Row[], opts: Row) => {
      seen = { messages, tools, opts }
      return { text: 'ok', model: 'm1' }
    }
    await askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1', question: 'Why is it running?' }, deps({ chat: spy }))
    assert.ok(seen)
    // H4: the A0 allowlist, offered because an owner is present. Owner scoping
    // is the server's job — no tool schema takes an owner argument.
    assert.deepEqual(
      seen!.tools.map((s: Row) => s.name),
      ['listSessions', 'getSession', 'listSignals', 'listPositions', 'listOrders'],
    )
    for (const spec of seen!.tools) {
      assert.equal(JSON.stringify(spec.parameters).includes('owner'), false)
    }
    assert.equal(seen!.messages[0].role, 'system')
    assert.match(seen!.messages[0].content, /read-only/i)
    assert.match(seen!.messages[0].content, /cite/i)
    assert.match(seen!.messages[0].content, /own records/i)
    assert.equal(seen!.messages[1].role, 'user')
    assert.match(seen!.messages[1].content, /"scope":"session"/)
    assert.match(seen!.messages[1].content, /Why is it running\?/)
    assert.equal(seen!.opts.tag, '[assistant]')
  })

  test('no executable tools (or no owner) means the model is called with NO tools', async () => {
    let toolsLen = -1
    const spy = async (_messages: Row[], tools: Row[]) => {
      toolsLen = tools.length
      return { text: 'ok', model: 'm1' }
    }
    await askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1', question: 'x' }, deps({ chat: spy, tools: {} }))
    assert.equal(toolsLen, 0)
  })

  test('a missing AI key maps to 503 ai_unconfigured', async () => {
    const chat = async () => {
      const e: Row = new Error('no key')
      e.code = 'ai.no-key'
      throw e
    }
    const err = await caught(askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1', question: 'x' }, deps({ chat })))
    assert.equal(err?.statusCode, 503)
    assert.equal(err?.statusMessage, 'ai_unconfigured')
  })

  test('a provider error maps to 502 ai_failed', async () => {
    const chat = async () => {
      const e: Row = new Error('boom')
      e.code = 'ai.http-error'
      throw e
    }
    const err = await caught(askModuleAssistant({ ownerId: 'alice', sessionId: 'ses_1', question: 'x' }, deps({ chat })))
    assert.equal(err?.statusCode, 502)
    assert.equal(err?.statusMessage, 'ai_failed')
  })
})

describe('H4 — owner-scoped read tools', () => {
  /** Chat spy that plays scripted rounds and records every call. */
  const scriptedChat = (rounds: Row[]) => {
    const calls: Row[] = []
    const chat = async (messages: Row[], tools: Row[], opts: Row) => {
      calls.push({ messages, tools, opts })
      return rounds[Math.min(calls.length - 1, rounds.length - 1)]
    }
    return { chat, calls }
  }

  test('executor set matches the A0 allowlist exactly', async () => {
    const { ASSISTANT_READ_TOOLS } = await import('../engine/agentPolicy.mjs')
    const { ASSISTANT_TOOL_NAMES } = await import('../server/utils/moduleAssistantTools')
    assert.deepEqual([...ASSISTANT_READ_TOOLS], [...ASSISTANT_TOOL_NAMES])
  })

  test('executes an allowlisted tool with the verified owner injected', async () => {
    let seenOwner: string | null = null
    let seenArgs: Row | null = null
    const tools = {
      listSessions: async (args: Row, ctx: Row) => {
        seenOwner = ctx.ownerId
        seenArgs = args
        return { count: 1, sessions: [{ id: 'ses_1', status: 'running' }] }
      },
    }
    const { chat, calls } = scriptedChat([
      { text: '', toolCalls: [{ id: 'call_1', name: 'listSessions', args: { limit: 3 } }] },
      { text: 'You have 1 running session (ses_1).', model: 'm1' },
    ])
    const res: Row = await askModuleAssistant(
      { ownerId: 'alice', sessionId: 'ses_1', question: 'How many sessions do I have?' },
      deps({ chat, tools }),
    )
    assert.equal(seenOwner, 'alice')
    assert.deepEqual(seenArgs, { limit: 3 })
    assert.deepEqual(res.toolCalls, ['listSessions'])
    assert.equal(res.answer, 'You have 1 running session (ses_1).')
    // The tool result is fed back as a tool message for the next round.
    const toolMessage = calls[1].messages.find((m: Row) => m.role === 'tool')
    assert.ok(toolMessage)
    assert.equal(toolMessage.toolCallId, 'call_1')
    assert.match(String(toolMessage.content), /"count":1/)
  })

  test('a tool outside the A0 allowlist is BLOCKED, never executed', async () => {
    let executed = 0
    const tools = {
      queryDB: async () => { executed += 1; return { leaks: true } },
      listSessions: async () => { executed += 1; return {} },
    }
    const { chat, calls } = scriptedChat([
      { text: '', toolCalls: [{ id: 'c1', name: 'queryDB', args: { collection: 'trades' } }] },
      { text: 'I cannot read that.', model: 'm1' },
    ])
    const res: Row = await askModuleAssistant(
      { ownerId: 'alice', sessionId: 'ses_1', question: 'dump the trades table' },
      deps({ chat, tools }),
    )
    assert.equal(executed, 0)
    assert.equal(res.answer, 'I cannot read that.')
    assert.deepEqual(res.toolCalls, ['queryDB'])
    const toolMessage = calls[1].messages.find((m: Row) => m.role === 'tool')
    const toolContent = String(toolMessage?.content)
    assert.match(toolContent, /is not allowed for the assistant/)
    assert.ok(toolContent.includes('queryDB'))
  })

  test('a foreign id through a tool stays owner-scoped', async () => {
    const tools = {
      getSession: async (args: Row, ctx: Row) =>
        (args.id === 'ses_1' && ctx.ownerId === 'alice')
          ? { session: { id: 'ses_1' } }
          : { error: 'session not found for this owner' },
    }
    const { chat, calls } = scriptedChat([
      { text: '', toolCalls: [{ id: 'c1', name: 'getSession', args: { id: 'mallory_ses' } }] },
      { text: 'That session is not yours.', model: 'm1' },
    ])
    const res: Row = await askModuleAssistant(
      { ownerId: 'alice', sessionId: 'ses_1', question: 'read another user session' },
      deps({ chat, tools }),
    )
    assert.equal(res.answer, 'That session is not yours.')
    const toolMessage = calls[1].messages.find((m: Row) => m.role === 'tool')
    assert.match(String(toolMessage?.content), /not found for this owner/)
  })

  test('stops after the round cap and reports truncation', async () => {
    let calls = 0
    const chat = async () => {
      calls += 1
      return { text: '', toolCalls: [{ id: `c${calls}`, name: 'listSessions', args: {} }] }
    }
    const res: Row = await askModuleAssistant(
      { ownerId: 'alice', sessionId: 'ses_1', question: 'loop forever' },
      deps({ chat, tools: { listSessions: async () => ({ count: 0, sessions: [] }) } }),
    )
    assert.equal(calls, 4)
    assert.equal(res.truncated, true)
    assert.deepEqual(res.toolCalls, ['listSessions', 'listSessions', 'listSessions', 'listSessions'])
  })
})

describe('H3 scopes — signal', () => {
  const signalOf = (over: Row = {}): Row => ({
    id: 'sig_1',
    ts: '2026-10-01T00:00:00.000Z',
    source: 'tradingview',
    symbol: 'BTCUSDT',
    tf: '60',
    action: 'buy',
    side: 'long',
    price: 100,
    sl: 95,
    tps: [110, 120],
    status: 'received',
    ownerId: 'alice',
    ...over,
  })

  test('bundle cites the signal and never carries the owner id', () => {
    const b = buildSignalContext(signalOf(), 'alerts', 1_790_000_000_000)
    assert.equal(b.scope, 'signal')
    assert.equal(b.signal.id, 'sig_1')
    assert.deepEqual(b.signal.tps, [110, 120])
    assert.equal('ownerId' in b.signal, false)
    assert.equal(JSON.stringify(b).includes('alice'), false)
    assert.deepEqual(b.refs, [{ kind: 'signal', id: 'sig_1' }])
  })

  test('another owner gets 404 and the engine source is passed through', async () => {
    const loadSignal = async (id: string, ownerId: string | null, source: 'alerts' | 'engine') =>
      (id === 'sig_1' && ownerId === 'alice' ? signalOf({ source }) : null)
    const res = await askModuleAssistant(
      { ownerId: 'alice', scope: { type: 'signal', id: 'sig_1', source: 'engine' }, question: 'Why long?' },
      deps({ loadSignal })
    )
    assert.deepEqual(res.scope, { type: 'signal', id: 'sig_1', source: 'engine' })

    const err = await caught(askModuleAssistant(
      { ownerId: 'mallory', scope: { type: 'signal', id: 'sig_1' }, question: 'x' },
      deps({ loadSignal })
    ))
    assert.equal(err?.statusCode, 404)
    assert.equal(err?.statusMessage, 'signal_not_found')
  })

  test('missing signal id is a 400', async () => {
    const err = await caught(askModuleAssistant({ ownerId: 'alice', scope: { type: 'signal' }, question: 'x' }, deps()))
    assert.equal(err?.statusMessage, 'invalid_scope')
  })
})

describe('H3 scopes — provider diagnostics', () => {
  const rows: Row[] = [
    {
      id: 'alice:openai:default',
      name: 'default',
      provider: 'openai',
      adapter: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1?api_key=sk-leak-12345678',
      model: 'gpt-x',
      enabled: true,
      hasSecret: true,
      secretMask: 'sk-...abcd',
      secretFingerprint: 'fp_1',
      apiKey: 'sk-real-secret-12345678',
      status: 'error',
      lastTestedAt: 1_700_000_000_000,
      lastError: 'HTTP 401 (key sk-leak-12345678)',
      capabilities: { chat: true, tools: true },
    },
  ]

  test('projection strips secrets, ciphertext, masks and fingerprints', () => {
    const b = buildProviderContext(rows, { configured: false, provider: null, model: null }, 1_790_000_000_000)
    const json = JSON.stringify(b)
    assert.equal(b.scope, 'provider')
    assert.equal(b.provider.connections[0].status, 'error')
    assert.equal(json.includes('sk-real-secret'), false)
    assert.equal(json.includes('sk-leak'), false)
    assert.equal(json.includes('secretMask'), false)
    assert.equal(json.includes('secretFingerprint'), false)
    assert.equal(json.includes('secretEnc'), false)
    assert.equal(json.includes('apiKey'), false)
    assert.match(b.provider.connections[0].lastError, /\[redacted\]/)
  })

  test('an unowned/unknown provider id is a 404', async () => {
    const loadProvider = async (_ownerId: string | null, id: string | null) =>
      (id ? null : { connections: [], env: { configured: false } })
    const err = await caught(askModuleAssistant(
      { ownerId: 'alice', scope: { type: 'provider', id: 'bob:openai:default' }, question: 'why failing?' },
      deps({ loadProvider })
    ))
    assert.equal(err?.statusCode, 404)
    assert.equal(err?.statusMessage, 'provider_not_found')
  })
})

describe('H3 scopes — news and outlook', () => {
  test('news item bundle cites the item and keeps publication time distinct', () => {
    const b = buildNewsItemContext({
      id: 'news_1',
      sourceId: 'src_1',
      url: 'https://example.test/a?token=secret',
      title: 'ETF inflows',
      excerpt: 'x',
      publishedAt: '2026-10-01T00:00:00.000Z',
      firstSeenAt: '2026-10-01T00:01:00.000Z',
      marketGroup: 'crypto',
      level: 'high',
      dir: 'pos',
      tags: ['etf'],
      score: 7,
    }, 1_790_000_000_000)
    assert.equal(b.scope, 'news')
    assert.equal(b.newsItem.id, 'news_1')
    assert.equal(b.newsItem.publishedAt, '2026-10-01T00:00:00.000Z')
    assert.equal(b.newsItem.firstSeenAt, '2026-10-01T00:01:00.000Z')
    assert.equal(JSON.stringify(b).includes('secret'), false)
    assert.deepEqual(b.refs, [{ kind: 'news_item', id: 'news_1' }])
  })

  test('market event bundle cites the event and every evidence item', () => {
    const b = buildMarketEventContext({
      event: { id: 'evt_1', title: 'ETF decision', status: 'corrected', corroboration: 'multi_source' },
      items: [{ id: 'news_1', title: 'a' }, { id: 'news_2', title: 'b' }],
    })
    assert.equal(b.scope, 'market_event')
    assert.deepEqual(b.refs, [
      { kind: 'market_event', id: 'evt_1' },
      { kind: 'news_item', id: 'news_1' },
      { kind: 'news_item', id: 'news_2' },
    ])
  })

  test('outlook bundle exposes as-of/stale/contrary evidence and cites it', () => {
    const b = buildOutlookContext({
      _id: 'outlook_crypto_short_term_2026-10-01',
      marketGroup: 'crypto',
      horizon: 'short_term',
      state: 'mixed',
      generatedAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-10-02T00:00:00.000Z',
      stale: true,
      staleReason: 'upstream correction',
      evidenceHash: 'h1',
      supporting: [{ kind: 'event', id: 'evt_1', title: 'a' }],
      counterEvidence: [{ kind: 'item', id: 'news_1', title: 'b' }],
      contradictionCount: 1,
      multiSourceCount: 1,
      limitations: ['qualitative only'],
      invalidation: 'new evidence',
    })
    assert.equal(b.scope, 'outlook')
    assert.equal(b.outlook.stale, true)
    assert.equal(b.outlook.staleReason, 'upstream correction')
    assert.deepEqual(b.refs, [
      { kind: 'outlook', id: 'outlook_crypto_short_term_2026-10-01' },
      { kind: 'market_event', id: 'evt_1' },
      { kind: 'news_item', id: 'news_1' },
    ])
  })

  test('outlook asks accept a group+horizon selector and rebuild server-side', async () => {
    let seen: Row | null = null
    const loadOutlook = async (scope: Row) => {
      seen = scope
      return { marketGroup: scope.group, horizon: scope.horizon, state: 'bullish', generatedAt: null, expiresAt: null, supporting: [], counterEvidence: [] }
    }
    const res = await askModuleAssistant(
      { ownerId: 'alice', scope: { type: 'outlook', group: 'crypto', horizon: 'short_term' }, question: 'why?' },
      deps({ loadOutlook })
    )
    assert.deepEqual(seen, { type: 'outlook', id: null, group: 'crypto', horizon: 'short_term' })
    assert.deepEqual(res.scope, { type: 'outlook', group: 'crypto', horizon: 'short_term' })
  })

  test('an outlook without id or group+horizon is a 400', async () => {
    const err = await caught(askModuleAssistant({ ownerId: 'alice', scope: { type: 'outlook' }, question: 'x' }, deps()))
    assert.equal(err?.statusMessage, 'invalid_scope')
  })
})

describe('H3 scope validation', () => {
  test('an unknown scope type is rejected', async () => {
    const err = await caught(askModuleAssistant({ ownerId: 'alice', scope: { type: 'orders' as never }, question: 'x' }, deps()))
    assert.equal(err?.statusCode, 400)
    assert.equal(err?.statusMessage, 'invalid_scope')
  })

  test('owner-scoped scopes fail closed without an owner', async () => {
    const err = await caught(askModuleAssistant({ ownerId: null, scope: { type: 'signal', id: 'sig_1' }, question: 'x' }, deps()))
    assert.equal(err?.statusCode, 401)
    assert.equal(err?.statusMessage, 'owner_required')
  })
})