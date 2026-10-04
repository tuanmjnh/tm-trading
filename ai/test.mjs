#!/usr/bin/env node
// =============================================================================
//  TM TRADING - fixtures for the AI layer (ai/gateway.mjs + ai/agent.mjs), Phase 11.
//  Pure logic + injected fake fetch + temp files: NO real network, NO AI_API_KEY,
//  NO DB reads/writes, and never writes to the repository logs/ai.ndjson.
//  Run: node ai/test.mjs   (wired into `npm test`)
// =============================================================================
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  AIGatewayError, aiConfig, AI_CFG, RateLimiter,
  toOpenAIMessages, toAnthropicMessages, toOpenAITools, toAnthropicTools,
  buildRequest, parseResponse, appendAiLog, chat,
} from './gateway.mjs'
import { TOOLS, TOOL_NAMES, toolSpecs, executeTool, defaultSystem } from './agent.mjs'

let pass = 0
let fail = 0
const section = (t) => console.log(`\n${t}`)
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const tmp = mkdtempSync(join(tmpdir(), 'tm-ai-'))
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const code = (e) => String(e?.code || '')
const caught = (fn) => { try { fn(); return null } catch (e) { return e } }
const caughtAsync = async (fn) => { try { await fn(); return null } catch (e) { return e } }
const at = (v, i) => (Array.isArray(v) ? v[i] : undefined)
/** Read a NDJSON file fail-soft: { rows, bad, exists } — bad = lines JSON.parse rejects. */
function readLog(file) {
  if (!existsSync(file)) return { rows: [], bad: 0, exists: false }
  const rows = []
  let bad = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch { bad++ }
  }
  return { rows, bad, exists: true }
}

// =============================================================================
section('1. AIGatewayError + aiConfig (pure, fake env objects)')

const err1 = new AIGatewayError('ai.test', 'boom', { provider: 'openai', status: 418 })
check('AIGatewayError: name/code/message', err1.name === 'AIGatewayError' && err1.code === 'ai.test' && err1.message === 'boom')
check('AIGatewayError: extra fields merged onto the instance', err1.provider === 'openai' && err1.status === 418)
check('AIGatewayError: is a real Error (instanceof)', err1 instanceof Error)

const d = aiConfig({})
check('cfg default: provider openai + baseUrl + model', d.provider === 'openai' && d.baseUrl === 'https://api.openai.com/v1' && d.model === 'gpt-4o-mini')
check('cfg default: maxTokens 1024 / timeoutMs 60000 / rpm 30', d.maxTokens === 1024 && d.timeoutMs === 60000 && d.rpm === 30)
check('cfg default: temperature 0.3 / lang vi', d.temperature === 0.3 && d.lang === 'vi')
check('cfg default: empty apiKey (real .env is NOT read here)', d.apiKey === '' && d.log === true)
check('cfg default: logFile = <root>/logs/ai.ndjson', d.logFile === join(ROOT, 'logs', 'ai.ndjson'), d.logFile)
check('cfg: frozen -> mutation cannot stick', (() => { try { d.rpm = 999; return d.rpm !== 999 } catch { return true } })() === true)

const o = aiConfig({
  AI_PROVIDER: 'ANTHROPIC', AI_API_KEY: '  sk-test  ', AI_BASE_URL: 'https://x.test/v1///',
  AI_MODEL: '  claude-x  ', AI_MAX_TOKENS: '77', AI_TIMEOUT_MS: '1234', AI_RPM: '7',
  AI_TEMPERATURE: '0.9', AI_LANG: 'en', AI_LOG: '0', AI_LOG_FILE: 'C:/tmp/custom.ndjson',
})
check('cfg override: provider lowercased + apiKey/model trimmed', o.provider === 'anthropic' && o.apiKey === 'sk-test' && o.model === 'claude-x')
check('cfg override: baseUrl trailing slashes stripped', o.baseUrl === 'https://x.test/v1', o.baseUrl)
check('cfg override: numeric fields parsed', o.maxTokens === 77 && o.timeoutMs === 1234 && o.rpm === 7)
check('cfg override: temperature + lang', o.temperature === 0.9 && o.lang === 'en')
check('cfg override: AI_LOG=0 -> false + custom logFile', o.log === false && o.logFile === 'C:/tmp/custom.ndjson')
check('cfg: non-numeric temperature -> 0.3 (never NaN)', aiConfig({ AI_TEMPERATURE: 'hot' }).temperature === 0.3)
check('cfg: AI_TEMPERATURE=0 keeps 0 (not replaced by default)', aiConfig({ AI_TEMPERATURE: '0' }).temperature === 0)
check('cfg: AI_LOG=1 -> true', aiConfig({ AI_LOG: '1' }).log === true)

// Fix lock (a): a numeric env typo must fall back to the default instead of NaN.
// NaN timeoutMs made setTimeout(fn, NaN) fire immediately (every call -> ai.timeout), NaN
// maxTokens sent "max_tokens":null, and NaN rpm silently degraded the limiter to 1/60s.
const garbage = aiConfig({ AI_MAX_TOKENS: 'abc', AI_TIMEOUT_MS: 'abc', AI_RPM: 'abc', AI_TEMPERATURE: 'abc' })
check('cfg: garbage numeric env -> numeric defaults, never NaN', garbage.maxTokens === 1024 && garbage.timeoutMs === 60000 && garbage.rpm === 30 && garbage.temperature === 0.3, JSON.stringify({ maxTokens: garbage.maxTokens, timeoutMs: garbage.timeoutMs, rpm: garbage.rpm, temperature: garbage.temperature }))
check('cfg: every numeric field of a garbage config is finite', [garbage.maxTokens, garbage.timeoutMs, garbage.rpm, garbage.temperature].every(Number.isFinite))
check('cfg: Infinity/NaN strings also fall back', aiConfig({ AI_RPM: 'Infinity', AI_TIMEOUT_MS: 'NaN' }).rpm === 30 && aiConfig({ AI_TIMEOUT_MS: 'NaN' }).timeoutMs === 60000)
check('cfg: empty string still falls back to the default', aiConfig({ AI_RPM: '', AI_MAX_TOKENS: '', AI_TIMEOUT_MS: '', AI_TEMPERATURE: '' }).rpm === 30 && aiConfig({ AI_MAX_TOKENS: '' }).maxTokens === 1024 && aiConfig({ AI_TIMEOUT_MS: '' }).timeoutMs === 60000)
// The trap of an over-eager `x || default` fix: 0 is a LEGAL value and must survive.
check('cfg: 0 is preserved, NOT swallowed by a || fallback (rpm)', aiConfig({ AI_RPM: '0' }).rpm === 0)
check('cfg: 0 is preserved (maxTokens/timeoutMs/temperature)', aiConfig({ AI_MAX_TOKENS: '0' }).maxTokens === 0 && aiConfig({ AI_TIMEOUT_MS: '0' }).timeoutMs === 0 && aiConfig({ AI_TEMPERATURE: '0' }).temperature === 0)
check('AI_CFG (import-time) has a valid shape + non-empty model', typeof AI_CFG.provider === 'string' && AI_CFG.model.length > 0 && Number.isFinite(AI_CFG.rpm))

// =============================================================================
section('2. toOpenAIMessages (system stays INSIDE the array)')

const MSGS = [
  { role: 'system', content: 'SYS-A' },
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'queryDB', args: { collection: 'runs' } }] },
  { role: 'tool', toolCallId: 'c1', content: '{"ok":true}' },
]

const oa = toOpenAIMessages(MSGS)
check('openai: system kept inside the array (not extracted)', oa.length === 4 && oa[0].role === 'system' && oa[0].content === 'SYS-A')
check('openai: user/assistant keep role + content', oa[1].role === 'user' && oa[1].content === 'hello' && oa[2].role === 'assistant' && oa[2].content === null)
check('openai: assistant.tool_calls shape + arguments as JSON string', at(at(oa, 2)?.tool_calls, 0)?.id === 'c1' && at(at(oa, 2)?.tool_calls, 0)?.type === 'function' && at(at(oa, 2)?.tool_calls, 0)?.function?.name === 'queryDB' && at(at(oa, 2)?.tool_calls, 0)?.function?.arguments === '{"collection":"runs"}')
check('openai: role tool -> tool_call_id + string content', oa[3].role === 'tool' && oa[3].tool_call_id === 'c1' && oa[3].content === '{"ok":true}')
const oaEmptyArgs = toOpenAIMessages([{ role: 'assistant', content: 'x', toolCalls: [{ id: 'c2', name: 't' }] }])
check('openai: missing args -> "{}"', at(at(oaEmptyArgs, 0)?.tool_calls, 0)?.function.arguments === '{}')
check('openai: empty/undefined messages -> []', toOpenAIMessages([]).length === 0 && toOpenAIMessages().length === 0 && toOpenAIMessages(null).length === 0)

// =============================================================================
section('3. toAnthropicMessages (system EXTRACTED + tool_result merged)')

const an = toAnthropicMessages(MSGS)
check('anthropic: system pulled out, no system role left inside messages', an.system === 'SYS-A' && an.messages.every((m) => m.role !== 'system'))
check('anthropic: user/assistant kept (3 messages)', an.messages.length === 3 && at(an.messages, 0)?.role === 'user' && at(an.messages, 0)?.content === 'hello')
check('anthropic: empty assistant content -> ONLY the tool_use block', Array.isArray(at(an.messages, 1)?.content) && at(an.messages, 1).content.length === 1 && at(at(an.messages, 1).content, 0)?.type === 'tool_use')
check('anthropic: tool_use block keeps id/name/input', at(at(an.messages, 1).content, 0)?.id === 'c1' && at(at(an.messages, 1).content, 0)?.name === 'queryDB' && at(at(an.messages, 1).content, 0)?.input?.collection === 'runs')
const anText = toAnthropicMessages([{ role: 'assistant', content: 'answer', toolCalls: [{ id: 'c1', name: 'queryDB', args: {} }] }])
check('anthropic: assistant with text -> [text, tool_use] in that order', at(anText.messages, 0)?.content?.length === 2 && at(at(anText.messages, 0).content, 0)?.type === 'text' && at(at(anText.messages, 0).content, 0)?.text === 'answer' && at(at(anText.messages, 0).content, 1)?.type === 'tool_use')
check('anthropic: tool -> user turn with a tool_result block', at(an.messages, 2)?.role === 'user' && at(at(an.messages, 2).content, 0)?.type === 'tool_result' && at(at(an.messages, 2).content, 0)?.tool_use_id === 'c1')
check('anthropic: assistant content empty + no toolCalls -> placeholder block', at(at(toAnthropicMessages([{ role: 'assistant', content: '' }]).messages, 0)?.content, 0)?.text === '(empty)')

const an2 = toAnthropicMessages([
  { role: 'system', content: 'A' }, { role: 'system', content: 'B' },
  { role: 'tool', toolCallId: 't1', content: 'r1' },
  { role: 'tool', toolCallId: 't2', content: 'r2' },
])
check('anthropic: several system messages joined with \\n', an2.system === 'A\nB', JSON.stringify(an2.system))
check('anthropic: 2 consecutive tool_result MERGED into one user turn', an2.messages.length === 1 && at(an2.messages, 0)?.content?.length === 2 && at(at(an2.messages, 0).content, 1)?.tool_use_id === 't2')
check('anthropic: empty/undefined messages -> {system:"", messages:[]}', toAnthropicMessages([]).messages.length === 0 && toAnthropicMessages().messages.length === 0 && toAnthropicMessages(null).system === '')

// =============================================================================
section('4. toOpenAITools / toAnthropicTools (different schema shape)')

const TOOL_FIX = [{ name: 'queryDB', description: 'read data', parameters: { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] } }]
const tOA = toOpenAITools(TOOL_FIX)
const tAN = toAnthropicTools(TOOL_FIX)
check('openai tools: type=function + function.parameters', tOA.length === 1 && at(tOA, 0)?.type === 'function' && at(tOA, 0)?.function?.name === 'queryDB' && at(tOA, 0)?.function?.parameters?.type === 'object')
check('openai tools: NO input_schema', at(tOA, 0)?.input_schema === undefined && at(tOA, 0)?.function?.parameters?.required?.[0] === 'limit')
check('anthropic tools: input_schema (no function/type wrapper)', tAN.length === 1 && at(tAN, 0)?.name === 'queryDB' && at(tAN, 0)?.input_schema?.type === 'object' && at(tAN, 0)?.function === undefined && at(tAN, 0)?.type === undefined)
check('tools empty/null -> []', toOpenAITools([]).length === 0 && toOpenAITools().length === 0 && toAnthropicTools(null).length === 0)

// =============================================================================
section('5. buildRequest (URL + headers per provider)')

const CFG_OA = { provider: 'openai', apiKey: 'sk-abc', baseUrl: 'https://api.test/v1', model: 'gpt-x', maxTokens: 256, temperature: 0.3, timeoutMs: 1000, rpm: 30 }
const CFG_AN = { ...CFG_OA, provider: 'anthropic', baseUrl: 'https://api.anthropic.com' }
const CFG_OLL = { ...CFG_OA, provider: 'ollama', apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1/' }

const rOA = buildRequest({ cfg: CFG_OA, messages: MSGS, tools: TOOL_FIX })
check('openai: url = base + /chat/completions', rOA.url === 'https://api.test/v1/chat/completions', rOA.url)
check('openai: Authorization Bearer (api key)', rOA.headers.authorization === 'Bearer sk-abc' && rOA.headers['x-api-key'] === undefined)
check('openai: content-type json', rOA.headers['content-type'] === 'application/json')
check('openai: body model/messages/max_tokens/temperature', rOA.body.model === 'gpt-x' && Array.isArray(rOA.body.messages) && at(rOA.body.messages, 0)?.role === 'system' && rOA.body.max_tokens === 256 && rOA.body.temperature === 0.3)
check('openai: body.tools uses the function wrapper', at(rOA.body.tools, 0)?.type === 'function' && at(rOA.body.tools, 0)?.function?.name === 'queryDB')

const rAN = buildRequest({ cfg: CFG_AN, messages: MSGS, tools: TOOL_FIX })
check('anthropic: url = base + /v1/messages', rAN.url === 'https://api.anthropic.com/v1/messages', rAN.url)
check('anthropic: x-api-key + anthropic-version', rAN.headers['x-api-key'] === 'sk-abc' && rAN.headers['anthropic-version'] === '2023-06-01')
check('anthropic: NO Authorization Bearer', rAN.headers.authorization === undefined, JSON.stringify(rAN.headers))
check('anthropic: body.system extracted + messages have no system', rAN.body.system === 'SYS-A' && rAN.body.messages.every((m) => m.role !== 'system'))
check('anthropic: body.tools uses input_schema', at(rAN.body.tools, 0)?.input_schema?.type === 'object' && at(rAN.body.tools, 0)?.function === undefined)
check('anthropic: body max_tokens (snake_case) + model', rAN.body.max_tokens === 256 && rAN.body.model === 'gpt-x')

const rAN2 = buildRequest({ cfg: { ...CFG_AN, baseUrl: 'https://api.test/v1/' }, messages: [] })
check('anthropic: baseUrl ending in /v1 does not double /v1', rAN2.url === 'https://api.test/v1/messages', rAN2.url)
check('anthropic: no system -> body has no system key', rAN2.body.system === undefined && !('system' in rAN2.body))

const rOLL = buildRequest({ cfg: CFG_OLL, messages: MSGS })
check('ollama (openai-compatible): no apiKey -> no Authorization', rOLL.headers.authorization === undefined && rOLL.headers['content-type'] === 'application/json')
check('ollama: url strips trailing slash from baseUrl', rOLL.url === 'http://127.0.0.1:11434/v1/chat/completions', rOLL.url)
check('buildRequest: default args fall back to AI_CFG and never throw', typeof buildRequest().url === 'string' && buildRequest().url.length > 0)
check('buildRequest: no tools -> body has no tools key', rOA.body.tools !== undefined && buildRequest({ cfg: CFG_OA, messages: MSGS }).body.tools === undefined)
check('buildRequest: temperature/maxTokens overrides win', buildRequest({ cfg: CFG_OA, messages: MSGS, temperature: 1.5 }).body.temperature === 1.5 && buildRequest({ cfg: CFG_OA, messages: MSGS, maxTokens: 9 }).body.max_tokens === 9)

// =============================================================================
section('6. parseResponse (text + toolCalls + bad-shape)')

const pOA = parseResponse('openai', {
  choices: [{ message: { role: 'assistant', content: 'BTC is trending up', tool_calls: [
    { id: 'call_1', type: 'function', function: { name: 'queryDB', arguments: '{"collection":"runs","limit":5}' } },
    { type: 'function', function: { name: 'getKlines', arguments: '{{{ broken' } },
    { function: { name: 'scanMovers' } },
  ] } }],
  usage: { prompt_tokens: '11', completion_tokens: 22 },
})
check('openai parse: text + 3 tool calls', pOA.text === 'BTC is trending up' && pOA.toolCalls.length === 3)
check('openai parse: arguments JSON -> args object', at(pOA.toolCalls, 0)?.name === 'queryDB' && at(pOA.toolCalls, 0)?.args?.collection === 'runs' && at(pOA.toolCalls, 0)?.args?.limit === 5)
check('openai parse: broken arguments -> {__raw} (no throw)', at(pOA.toolCalls, 1)?.args?.__raw === '{{{ broken')
check('openai parse: missing id -> call_<i>, missing args -> {}', at(pOA.toolCalls, 1)?.id === 'call_1' && at(pOA.toolCalls, 2)?.id === 'call_2' && JSON.stringify(at(pOA.toolCalls, 2)?.args) === '{}')
check('openai parse: usage prompt/completion', pOA.usage.prompt === 11 && pOA.usage.completion === 22)
check('openai parse: missing usage -> 0', parseResponse('openai', { choices: [{ message: { content: 'x' } }] }).usage.prompt === 0)
check('openai parse: content null -> text ""', parseResponse('openai', { choices: [{ message: { content: null } }] }).text === '')
check('openai parse: non-string content -> JSON.stringify', parseResponse('openai', { choices: [{ message: { content: [{ type: 'text', text: 'x' }] } }] }).text === '[{"type":"text","text":"x"}]')

const pAN = parseResponse('anthropic', {
  content: [{ type: 'text', text: 'analysis ' }, { type: 'tool_use', id: 'tu_1', name: 'getKlines', input: { symbol: 'BTCUSDT' } }, { type: 'thinking', thinking: '...' }],
  usage: { input_tokens: 5, output_tokens: 7 },
})
check('anthropic parse: multiple text blocks concatenated', pAN.text === 'analysis ' && pAN.toolCalls.length === 1)
check('anthropic parse: tool_use -> {id,name,args}', at(pAN.toolCalls, 0)?.id === 'tu_1' && at(pAN.toolCalls, 0)?.name === 'getKlines' && at(pAN.toolCalls, 0)?.args?.symbol === 'BTCUSDT')
check('anthropic parse: usage input/output tokens', pAN.usage.prompt === 5 && pAN.usage.completion === 7)
check('anthropic parse: non-object input -> {}', JSON.stringify(parseResponse('anthropic', { content: [{ type: 'tool_use', id: 'i', name: 'n', input: 'x' }] }).toolCalls[0].args) === '{}')

check('bad-shape openai: missing choices[0].message', code(caught(() => parseResponse('openai', { choices: [] }))) === 'ai.bad-shape' && code(caught(() => parseResponse('openai', {}))) === 'ai.bad-shape')
check('bad-shape anthropic: missing content[]', code(caught(() => parseResponse('anthropic', { nope: 1 }))) === 'ai.bad-shape' && code(caught(() => parseResponse('anthropic', null))) === 'ai.bad-shape')
const eApiShape = caught(() => parseResponse('anthropic', { error: { message: 'rate limited', type: 'rate_limit_error' } }))
check('error in body -> ai.api-error + message', code(eApiShape) === 'ai.api-error' && eApiShape.message === 'rate limited' && eApiShape.provider === 'anthropic')
check('string error -> ai.api-error carrying that string', caught(() => parseResponse('openai', { error: 'boom' }))?.message === 'boom')
check('bad-shape: thrown as AIGatewayError (callers can branch)', caught(() => parseResponse('openai', null)) instanceof AIGatewayError)

// =============================================================================
section('7. RateLimiter (sliding window, injected clock)')

const rl = new RateLimiter(3, 60000)
check('limiter: first 3 calls pass (limit honoured)', rl.attempt(1000).ok && rl.attempt(1000).ok && rl.attempt(1000).ok)
const g1 = rl.attempt(1000)
check('limiter: 4th call blocked', g1.ok === false)
check('limiter: retryAfterMs = 60000 (oldest stamp 1000 + 60000)', g1.retryAfterMs === 60000 && g1.retryAfterSec === 60, JSON.stringify(g1))
const g2 = rl.attempt(1000)
check('limiter: still blocked right after + retryAfter shrinks with time', g2.ok === false && g2.retryAfterMs === 60000)
const rlB = new RateLimiter(1, 60000)
check('limiter: window not elapsed (t=59999) still blocked', rlB.attempt(0).ok && rlB.attempt(59999).ok === false)
check('limiter: window elapsed (t=60000) allows again', rlB.attempt(60000).ok === true)

const rl2 = new RateLimiter(2, 60000)
check('limiter: boundary - stamp equal to now-windowMs is dropped (t=60000)', rl2.attempt(0).ok && rl2.attempt(1000).ok && rl2.attempt(60000).ok === true)
const rl3 = new RateLimiter(2, 1000)
check('sliding window: exhaust the window', rl3.attempt(0).ok && rl3.attempt(0).ok)
check('sliding window: blocked before it elapses', rl3.attempt(999).ok === false)
check('sliding window: t=1001 opens again (stamp 0 dropped)', rl3.attempt(1001).ok === true)
const rlNeg = new RateLimiter(0, 0)
check('limiter: limit/window <= 0 clamped to 1/60000', rlNeg.limit === 1 && rlNeg.windowMs === 60000 && rlNeg.attempt(0).ok && rlNeg.attempt(1).ok === false)

// =============================================================================
section('8. chat() with an injected fake fetch (never touches the network)')

const CFG = { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.test/v1', model: 'gpt-x', maxTokens: 100, temperature: 0.3, timeoutMs: 5000, rpm: 30, log: true, logFile: join(tmp, 'cfg-only.ndjson') }
const CFG_NO_KEY = { ...CFG, apiKey: '' }
const CFG_NOLOG = { ...CFG, log: false }
const limiterOk = () => new RateLimiter(1000, 60000)
/** Limiter already at capacity: a fresh RateLimiter(0) clamps to limit 1 and still lets the FIRST call through. */
const limiterFull = (now = 5000) => { const l = new RateLimiter(1, 60000); l.attempt(now); return l }
const fakeRes = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
const okBody = { choices: [{ message: { content: 'OK answer' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }
const neverFetch = async () => { throw new Error('fetch must not be called here') }
/** Snapshot of the REAL audit file: no test in this section may touch it. */
const realLogSnapshot = existsSync(AI_CFG.logFile) ? readFileSync(AI_CFG.logFile, 'utf8') : null

const eNoKey = await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG_NO_KEY, fetchImpl: neverFetch, limiter: limiterOk() }))
check('chat: missing API key -> ai.no-key (blocked BEFORE fetch)', code(eNoKey) === 'ai.no-key' && eNoKey instanceof AIGatewayError)
check('chat: ai.no-key names the provider', String(eNoKey?.message).includes('openai'))

const eLimited = await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, fetchImpl: neverFetch, limiter: limiterFull(), now: () => 5000, logFile: join(tmp, 'limited.ndjson') }))
check('chat: over rate limit -> ai.rate-limited + retryAfterSec', code(eLimited) === 'ai.rate-limited' && eLimited.retryAfterSec === 60)
check('chat: ai.rate-limited carries retryAfterSec (from the limiter)', eLimited.retryAfterSec === 60, JSON.stringify({ retryAfterSec: eLimited.retryAfterSec }))

const logRate = join(tmp, 'rate.ndjson')
await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, fetchImpl: neverFetch, limiter: limiterFull(), now: () => 5000, logFile: logRate }))
const rateLines = readLog(logRate)
check('chat: rate-limited call IS audited', rateLines.rows.length === 1 && rateLines.rows[0]?.ok === false && rateLines.rows[0]?.error === 'rate-limited' && rateLines.bad === 0)
check('chat: audit row of a blocked call has no ms/status', rateLines.rows[0]?.ms === undefined && rateLines.rows[0]?.retryAfterSec === 60)

const reqSeen = {}
const okRes = await chat([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'ask something' }], TOOL_FIX, {
  cfg: CFG, tag: '[ai:test]', limiter: limiterOk(), logFile: join(tmp, 'ok-call.ndjson'),
  fetchImpl: async (url, init) => { reqSeen.url = url; reqSeen.init = init; return fakeRes(okBody) },
})
check('chat OK: returns text + provider/model/ms', okRes.text === 'OK answer' && okRes.provider === 'openai' && okRes.model === 'gpt-x' && Number.isFinite(okRes.ms))
check('chat OK: usage + toolCalls (none -> [])', okRes.usage.prompt === 3 && okRes.usage.completion === 4 && Array.isArray(okRes.toolCalls) && okRes.toolCalls.length === 0)
check('chat OK: POST to the right url with the right headers', reqSeen.url === 'https://api.test/v1/chat/completions' && reqSeen.init?.method === 'POST' && reqSeen.init?.headers?.authorization === 'Bearer sk-test')
check('chat OK: request body carries model + tools', JSON.parse(reqSeen.init?.body)?.model === 'gpt-x' && JSON.parse(reqSeen.init?.body)?.tools?.[0]?.function?.name === 'queryDB')
check('chat OK: passes an AbortController signal to fetch', reqSeen.init?.signal !== undefined)

const logOK = join(tmp, 'ok.ndjson')
await chat([{ role: 'user', content: 'write the audit line' }], [], { cfg: CFG, tag: '[ai:test]', limiter: limiterOk(), logFile: logOK, fetchImpl: async () => fakeRes(okBody) })
const logLines = readLog(logOK)
check('chat OK: writes exactly 1 valid NDJSON audit row', logLines.rows.length === 1 && logLines.bad === 0 && logLines.exists === true)
check('chat OK: audit row has tag/model/ok/ms/usage/ts', logLines.rows[0]?.tag === '[ai:test]' && logLines.rows[0]?.model === 'gpt-x' && logLines.rows[0]?.ok === true && logLines.rows[0]?.usage?.completion === 4 && typeof logLines.rows[0]?.ts === 'string')
check('chat OK: audit row stores prompt + response excerpts', logLines.rows[0]?.prompt === 'write the audit line' && logLines.rows[0]?.response === 'OK answer')

const logTool = join(tmp, 'tool.ndjson')
const toolRes = await chat([{ role: 'user', content: 'call a tool' }], TOOL_FIX, {
  cfg: CFG, limiter: limiterOk(), logFile: logTool,
  fetchImpl: async () => fakeRes({ choices: [{ message: { content: '', tool_calls: [{ id: 'c9', function: { name: 'queryDB', arguments: '{"collection":"trades"}' } }] } }] }),
})
check('chat OK: parses tool calls out of the response', toolRes.toolCalls.length === 1 && at(toolRes.toolCalls, 0)?.name === 'queryDB' && at(toolRes.toolCalls, 0)?.args?.collection === 'trades')
check('chat OK: audit row lists the tool names called', JSON.stringify(readLog(logTool).rows[0]?.toolCalls) === '["queryDB"]' && readLog(logTool).bad === 0)

const eHttp = await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, limiter: limiterOk(), logFile: join(tmp, 'http.ndjson'), fetchImpl: async () => fakeRes({ error: { message: 'server exploded' } }, 500) }))
check('chat: HTTP 500 -> ai.http-error + status 500', code(eHttp) === 'ai.http-error' && eHttp.status === 500)
check('chat: http-error message has the code + server message', String(eHttp?.message).includes('500') && String(eHttp?.message).includes('server exploded'))
const eHttpBad = await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, limiter: limiterOk(), logFile: join(tmp, 'http-bad.ndjson'), fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error('not JSON') } }) }))
check('chat: HTTP error with non-JSON body -> ai.http-error (no parse crash)', code(eHttpBad) === 'ai.http-error' && String(eHttpBad?.message).includes('502'))

const eNet = await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, limiter: limiterOk(), logFile: join(tmp, 'net.ndjson'), fetchImpl: async () => { throw new Error('ENOTFOUND api.test') } }))
check('chat: fetch rejects -> ai.network + original message', code(eNet) === 'ai.network' && String(eNet?.message).includes('ENOTFOUND'))

const eAbort = await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, limiter: limiterOk(), logFile: join(tmp, 'abort.ndjson'), fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e } }))
check('chat: fetch rejects with AbortError -> ai.timeout', code(eAbort) === 'ai.timeout' && String(eAbort?.message).includes('timeout after 5000ms'))

const eShape = await caughtAsync(() => chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, limiter: limiterOk(), logFile: join(tmp, 'shape.ndjson'), fetchImpl: async () => fakeRes({ unexpected: true }) }))
check('chat: HTTP 200 with a wrong shape -> ai.bad-shape', code(eShape) === 'ai.bad-shape')

const logOff = join(tmp, 'off.ndjson')
const resNoLog = await chat([{ role: 'user', content: 'x' }], [], { cfg: CFG_NOLOG, limiter: limiterOk(), logFile: logOff, fetchImpl: async () => fakeRes(okBody) })
check('chat: cfg.log=false -> no audit file written', resNoLog.text === 'OK answer' && existsSync(logOff) === false)

// chat() resolves the audit path as opts.logFile || cfg.logFile (gateway normalizes opts at
// the top of chat). Lock BOTH sides of that precedence AND prove the repository log is never
// touched by accident.
const realLogBefore = existsSync(AI_CFG.logFile) ? readFileSync(AI_CFG.logFile, 'utf8') : null
const logOpts = join(tmp, 'opts-wins.ndjson')
await chat([{ role: 'user', content: 'x' }], [], { cfg: CFG, limiter: limiterOk(), logFile: logOpts, fetchImpl: async () => fakeRes(okBody) })
const realLogAfter = existsSync(AI_CFG.logFile) ? readFileSync(AI_CFG.logFile, 'utf8') : null
check('chat: opts.logFile receives the audit row', readLog(logOpts).rows.length === 1)
check('chat: cfg.logFile does NOT receive it (opts.logFile wins)', existsSync(CFG.logFile) === false)
check('chat: real AI_CFG.logFile stays untouched when opts.logFile is given', realLogBefore === realLogAfter)

// Fix lock (b): with NO opts.logFile, cfg.logFile must be the audit destination.
// Before the fix the row silently went to the shared logs/ai.ndjson instead.
const logCfgOnly = join(tmp, 'cfg-logfile-only.ndjson')
const CFG_LOGFILE = { ...CFG, logFile: logCfgOnly }
await chat([{ role: 'user', content: 'audit to cfg.logFile' }], [], { cfg: CFG_LOGFILE, tag: '[ai:cfglog]', limiter: limiterOk(), fetchImpl: async () => fakeRes(okBody) })
check('chat: cfg.logFile is used when opts.logFile is absent', readLog(logCfgOnly).rows.length === 1 && readLog(logCfgOnly).rows[0]?.tag === '[ai:cfglog]')
check('chat: cfg.logFile path wins even when AI_CFG has its own logFile', (existsSync(AI_CFG.logFile) ? readFileSync(AI_CFG.logFile, 'utf8') : null) === realLogBefore)
const logBoth = join(tmp, 'opts-beats-cfg.ndjson')
await chat([{ role: 'user', content: 'x' }], [], { cfg: CFG_LOGFILE, limiter: limiterOk(), logFile: logBoth, fetchImpl: async () => fakeRes(okBody) })
check('chat: explicit opts.logFile still beats cfg.logFile', readLog(logBoth).rows.length === 1 && readLog(logCfgOnly).rows.length === 1)

const logAn = join(tmp, 'anthropic.ndjson')
const anRes = await chat([{ role: 'system', content: 'S' }, { role: 'user', content: 'x' }], [], {
  cfg: { ...CFG, provider: 'anthropic', baseUrl: 'https://api.anthropic.com' }, limiter: limiterOk(), logFile: logAn,
  fetchImpl: async () => fakeRes({ content: [{ type: 'text', text: 'anthropic answer' }], usage: { input_tokens: 1, output_tokens: 2 } }),
})
check('chat anthropic: returns text + usage for that provider', anRes.text === 'anthropic answer' && anRes.provider === 'anthropic' && anRes.usage.prompt === 1)
check('chat anthropic: its own audit row is valid', readLog(logAn).rows[0]?.provider === 'anthropic' && readLog(logAn).bad === 0)

const ollSeen = {}
const ollRes = await chat([{ role: 'user', content: 'x' }], [], {
  cfg: { ...CFG, provider: 'ollama', apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1' }, limiter: limiterOk(), logFile: join(tmp, 'ollama.ndjson'),
  fetchImpl: async (url, init) => { ollSeen.init = init; return fakeRes(okBody) },
})
check('chat ollama: runs without an API key and sends no Authorization', ollRes.text === 'OK answer' && ollSeen.init?.headers?.authorization === undefined)
// Hard invariant: every chat() call above passed its own logFile, so the repository
// audit file logs/ai.ndjson must be byte-identical to the snapshot taken before them.
check('chat: no call in this section wrote to the real AI_CFG.logFile', (existsSync(AI_CFG.logFile) ? readFileSync(AI_CFG.logFile, 'utf8') : null) === realLogSnapshot)

// =============================================================================
section('9. appendAiLog (temp files, NDJSON)')

const lf = join(tmp, 'manual.ndjson')
check('appendAiLog: first call ok + returns true', appendAiLog({ tag: '[ai:test]', ok: true }, lf) === true)
check('appendAiLog: second call appends (no overwrite)', appendAiLog({ ok: false, error: 'boom' }, lf) === true)
const man = readLog(lf)
check('appendAiLog: 2 rows, each one JSON.parse-able', man.rows.length === 2 && man.bad === 0)
check('appendAiLog: adds an ISO ts', typeof man.rows[0]?.ts === 'string' && !Number.isNaN(Date.parse(man.rows[0].ts)))
check('appendAiLog: keeps the fields of the entry', man.rows[0]?.tag === '[ai:test]' && man.rows[0]?.ok === true && man.rows[1]?.error === 'boom')
check('appendAiLog: nested objects/arrays survive round-trip', appendAiLog({ usage: { prompt: 1 }, toolCalls: ['a'] }, lf) === true && readLog(lf).rows[2]?.usage?.prompt === 1)
// mkdirSync(recursive) creates a missing parent, so an unwritable target must be a path
// whose PARENT is an existing file (ENOTDIR) for the fail-soft branch to be exercised.
check('appendAiLog: fail-soft -> false when the path cannot be written', appendAiLog({ x: 1 }, join(lf, 'x.ndjson')) === false)
const lfNull = join(tmp, 'null-entry.ndjson')
check('appendAiLog: never throws (null entry still logged)', caught(() => appendAiLog(null, lfNull)) === null && readLog(lfNull).rows.length === 1)
check('appendAiLog: explicit file argument is honoured', readLog(lf).rows.length === 3)

// =============================================================================
section('10. agent: TOOL_NAMES (read-only guardrail, 6 tools)')

const EXPECT = ['queryDB', 'getKlines', 'scanMovers', 'methodSignals', 'regimeSnapshot', 'backtestQuick']
check('TOOL_NAMES: exactly 6 tools', TOOL_NAMES.length === 6, TOOL_NAMES.join(','))
check('TOOL_NAMES: exact names + order', JSON.stringify([...TOOL_NAMES]) === JSON.stringify(EXPECT), TOOL_NAMES.join(','))
check('TOOLS: every entry has description + parameters + handler', TOOL_NAMES.every((n) => typeof TOOLS[n]?.description === 'string' && TOOLS[n].description.length > 0 && TOOLS[n].parameters?.type === 'object' && typeof TOOLS[n].handler === 'function'))
check('TOOL_NAMES/TOOLS: frozen (no tool can be added)', Object.isFrozen(TOOL_NAMES) && Object.isFrozen(TOOLS))
check('guardrail: no tool name mentions order/account mutation', TOOL_NAMES.every((n) => !/order|cancel|place|account|withdraw|transfer/i.test(n)))

// =============================================================================
section('11. agent: toolSpecs + defaultSystem')

const specs = toolSpecs()
check('toolSpecs(): 6 specs, each with name/description/parameters (no handler leakage)', specs.length === 6 && specs.every((s) => typeof s.name === 'string' && typeof s.description === 'string' && s.parameters?.type === 'object' && s.handler === undefined))
check('toolSpecs(): names match TOOL_NAMES', JSON.stringify(specs.map((s) => s.name)) === JSON.stringify(EXPECT))
const specFiltered = toolSpecs(['getKlines', 'backtestQuick'])
check('toolSpecs([..]): filters exactly to the requested list', specFiltered.length === 2 && at(specFiltered, 0)?.name === 'getKlines' && at(specFiltered, 1)?.name === 'backtestQuick')
check('toolSpecs([]): empty', toolSpecs([]).length === 0)
check('toolSpecs: unknown name skipped (no throw)', toolSpecs(['does-not-exist']).length === 0 && toolSpecs(['queryDB', 'does-not-exist']).length === 1)
check('toolSpecs: per-tool schema preserved (queryDB.limit.maximum === 50)', at(toolSpecs(['queryDB']), 0)?.parameters?.properties?.limit?.maximum === 50)

const sysDefault = defaultSystem()
const sysEn = defaultSystem('en')
check('defaultSystem(): non-empty string', typeof sysDefault === 'string' && sysDefault.length > 50)
check('defaultSystem(): states the read-only + proposals guardrail', sysDefault.includes('READ-ONLY') && sysDefault.includes('PROPOSALS'))
check('defaultSystem(lang): language injected into the prompt', sysEn.includes('Reply in en') && defaultSystem('fr').includes('Reply in fr'))
check('defaultSystem(lang): defaults to AI_CFG.lang when called with no args', defaultSystem().includes(`Reply in ${AI_CFG.lang}`))
check('defaultSystem(): single line (no newlines)', !sysDefault.includes('\n') && !sysEn.includes('\n'))

// =============================================================================
section('12. agent: executeTool with injected deps')

const unknown = await executeTool('placeOrder', {})
check('executeTool: unknown tool -> {ok:false, error} (does NOT throw)', unknown.ok === false && String(unknown.error).includes('unknown tool'))

const rowsZ = (n) => Array.from({ length: n }, (_, i) => [1_700_000_000_000 + i * 3_600_000, 100 + i, 101 + i, 99 + i, 100.5 + i, 10 + i])
const ZSYM = 'ZZAITESTUSDT'
const ZERR = 'ZZAITESTERRUSDT'
const CACHE_FILES = [join(ROOT, 'data', 'fapi', `${ZSYM}-60.json`), join(ROOT, 'data', 'fapi', `${ZERR}-60.json`)]
const cachesBefore = CACHE_FILES.map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : null))
check('executeTool test setup: fake symbols have no pre-existing cache files', cachesBefore.every((c) => c === null))
const cleanup = () => {
  try {
    CACHE_FILES.forEach((f, i) => {
      if (cachesBefore[i] === null) { if (existsSync(f)) rmSync(f, { force: true }) }
      else writeFileSync(f, cachesBefore[i])
    })
  } catch {}
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
}
process.on('exit', cleanup)

const kRes = await executeTool('getKlines', { symbol: ZSYM.toLowerCase(), tf: '60', limit: 40 }, { fetchImpl: async () => rowsZ(45) })
check('executeTool getKlines: ok + used the injected fetchImpl dep', kRes.ok === true && kRes.data?.symbol === ZSYM && kRes.data?.tf === '60')
// limit 40 of 45 rows -> the OLDEST 5 are dropped, so bar 0 is i=5 (time/close shift with i).
check('executeTool getKlines: compact bars [t,o,h,l,c,v] of the last 40', Array.isArray(kRes.data?.bars) && kRes.data.bars.length === 40 && at(kRes.data.bars, 0)?.length === 6 && at(at(kRes.data.bars, 0), 0) === 1_700_000_000_000 + 5 * 3_600_000 && at(at(kRes.data.bars, 0), 4) === 105.5)
check('executeTool getKlines: limit defaults to 200', (await executeTool('getKlines', { symbol: ZSYM, tf: '60' }, { fetchImpl: async () => rowsZ(250) })).data?.count === 200)

const mRes = await executeTool('methodSignals', { symbol: ZSYM, tf: '60', limit: 60, events: 2 }, { fetchImpl: async () => rowsZ(60) })
check('executeTool methodSignals: ok + every method ran on fake bars', mRes.ok === true && mRes.data?.bars === 60 && mRes.data.methods.length > 0)
check('executeTool methodSignals: each method reports id/lastScore/events (capped)', mRes.data.methods.every((m) => typeof m.id === 'string' && Number.isFinite(m.lastScore) && Array.isArray(m.events)) && mRes.data.methods.every((m) => m.events.length <= 2))

const bRes = await executeTool('backtestQuick', { method: 'vsa', symbol: ZSYM, tf: '60', bars: 100 }, { fetchImpl: async () => rowsZ(100) })
check('executeTool backtestQuick: ok + returns a summary', bRes.ok === true && bRes.data?.method === 'vsa' && bRes.data.summary && typeof bRes.data.summary === 'object')

const qRuns = await executeTool('queryDB', { collection: 'runs', limit: 3 })
check('executeTool queryDB runs: ok + rows array (read-only file read)', qRuns.ok === true && qRuns.data?.collection === 'runs' && Array.isArray(qRuns.data.rows) && qRuns.data.rows.length <= 3)
const qTrades = await executeTool('queryDB', { collection: 'trades', limit: 2 })
check('executeTool queryDB trades: ok + rows array', qTrades.ok === true && qTrades.data?.collection === 'trades' && Array.isArray(qTrades.data.rows))

const qBad = await executeTool('queryDB', { collection: 'orders' })
check('executeTool queryDB: non-whitelisted collection -> ok:false + clear error', qBad.ok === false && String(qBad.error).includes('runs|trades|signals|intel'))
const qKind = await executeTool('queryDB', { collection: 'intel' })
check('executeTool queryDB: intel without kind -> ok:false (never reaches Mongo)', qKind.ok === false && String(qKind.error).includes('requires kind'))

// Fresh symbol on purpose: a cached symbol would be served from cache and the throwing dep would never run.
const errTool = await executeTool('getKlines', { symbol: ZERR, tf: '60' }, { fetchImpl: async () => { throw new Error('dep is down') } })
check('executeTool: throwing dep -> {ok:false, error} (does not propagate)', errTool.ok === false && String(errTool.error).includes('dep is down'))

// =============================================================================
// Leave no trace: fetchKlines writes a cache file under repo data/fapi.
cleanup()

// End-to-end guard: the ENTIRE suite must leave the repository audit file untouched.
check('whole suite: real AI_CFG.logFile is byte-identical to the start of the run', (existsSync(AI_CFG.logFile) ? readFileSync(AI_CFG.logFile, 'utf8') : null) === realLogSnapshot)

// =============================================================================
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} pass, ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
