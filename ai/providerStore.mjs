// ai/providerStore.mjs
// Phase G / D35 — app-owned AI provider connections. This is the only module
// allowed to decrypt a provider secret. Everything it returns to callers is
// either browser-safe (redacted) or an internal request config that must never
// be serialized to a response or a log.
import {
  AI_PROVIDER_SCHEMA_VERSION,
  budgetStatus,
  capabilitiesFor,
  envConnection,
  fallbackCompatible,
  maskSecret,
  normalizeConnection,
  providerDefinition,
  redactConnection,
  secretFingerprint,
  supports,
  isLocalEndpoint,
  resolveProviderKey,
} from '../engine/aiProviders.mjs'
import { decryptSecret, encryptSecret } from '../engine/aiProviderCrypto.mjs'
import { AiProviderConnection } from '../engine/models/aiProviderConnection.mjs'
import { AiProviderModel } from '../engine/models/aiProviderModel.mjs'
import { AiProviderAudit } from '../engine/models/aiProviderAudit.mjs'

const now = () => Date.now()

function audit(entry) {
  // Audit is best-effort: a failed audit write must not undo a config change.
  return AiProviderAudit.create({ at: now(), ...entry }).catch(() => null)
}

function safeMessage(err) {
  const raw = String(err?.message ?? err ?? 'unknown error')
  return raw
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|afp1_[a-f0-9]+)\b/g, '[redacted]')
    .slice(0, 200)
}

function rowToRedacted(row) {
  const obj = typeof row?.toObject === 'function' ? row.toObject() : row
  const red = redactConnection(obj)
  return { ...red, keyless: Boolean(providerDefinition(obj.provider)?.keyless) }
}

export async function listConnections({ ownerId = null } = {}) {
  const rows = await AiProviderConnection.find({ ownerId }).sort({ enabled: -1, provider: 1, name: 1 }).lean()
  return rows.map(rowToRedacted)
}

export async function getConnection(id, { ownerId = null } = {}) {
  const row = await AiProviderConnection.findOne({ _id: String(id ?? ''), ownerId }).lean()
  return row ? rowToRedacted(row) : null
}

export async function exportConnections({ ownerId = null, includeSecrets = false, env = process.env } = {}) {
  const rows = await AiProviderConnection.find({ ownerId }).sort({ provider: 1, name: 1 }).lean()
  let unreadable = 0
  const connections = rows.map((row) => {
    const out = {
      provider: row.provider,
      name: row.name,
      model: row.model,
      baseUrl: row.baseUrl,
      enabled: row.enabled !== false,
    }
    if (includeSecrets && !providerDefinition(row.provider)?.keyless) {
      try {
        const apiKey = decryptSecret(row.secretEnc, env)
        out.apiKey = apiKey || null
        if (!apiKey) unreadable += 1
      } catch {
        out.apiKey = null
        unreadable += 1
      }
    }
    return out
  })
  if (includeSecrets) await audit({ action: 'export-with-secrets', ownerId, actor: ownerId, ok: true })
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'tm-trading',
    includeSecrets: Boolean(includeSecrets),
    connections,
    unreadable,
  }
}

export async function importConnections(rows = [], { ownerId = null, overwrite = false, actor = null } = {}) {
  const result = { imported: 0, skipped: 0, failed: 0, results: [] }
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeConnection(row, { requireKey: false })
    if (!normalized.ok) {
      result.failed += 1
      result.results.push({ provider: row?.provider ?? null, name: row?.name ?? null, status: 'failed', error: normalized.errors.join('; ') })
      continue
    }
    const c = normalized.connection
    const id = `${ownerId ?? 'null'}:${c.provider}:${c.name}`
    const exists = await AiProviderConnection.exists({ _id: id, ownerId })
    if (exists && !overwrite) {
      result.skipped += 1
      result.results.push({ provider: c.provider, name: c.name, status: 'skipped', error: null })
      continue
    }
    try {
      await upsertConnection({ ...row, ownerId }, { actor })
      result.imported += 1
      result.results.push({ provider: c.provider, name: c.name, status: exists ? 'updated' : 'created', error: null })
    } catch (err) {
      result.failed += 1
      result.results.push({ provider: c.provider, name: c.name, status: 'failed', error: safeMessage(err) })
    }
  }
  return result
}

/**
 * Which of `rows` already exist for this owner, matched by `provider:name` — the
 * same identity `importConnections` uses. Lets the import preview tell the user
 * what would be skipped before anything is written.
 */
export async function existingConnectionKeys({ ownerId = null, rows = [] } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const providers = [...new Set(list.map((r) => String(r?.provider ?? '')).filter(Boolean))]
  if (providers.length === 0) return []
  const want = new Set(list.map((r) => `${String(r?.provider ?? '')}:${String(r?.name ?? '')}`))
  const found = await AiProviderConnection.find({ ownerId, provider: { $in: providers } }).select('provider name').lean()
  return found.map((r) => `${r.provider}:${r.name}`).filter((k) => want.has(k))
}

/** Raw row (includes the envelope) for internal callers that already checked ownership. */
export async function getConnectionRow(id, { ownerId = null } = {}) {
  return AiProviderConnection.findOne({ _id: String(id ?? ''), ownerId }).lean()
}

/** Decrypt a stored envelope server-side — the key NEVER crosses to the client. */
export async function decryptStored(secretEnc, env = process.env) {
  return decryptSecret(secretEnc, env)
}

/**
 * Create or update one connection. When `apiKey` is omitted on an update the
 * stored envelope is preserved, so the UI can edit a model without re-entering
 * the secret. Returns a redacted row only.
 */
export async function upsertConnection(input = {}, { actor = null } = {}) {
  const normalized = normalizeConnection(input, { requireKey: false })
  if (!normalized.ok) {
    const err = new Error(normalized.errors.join('; '))
    err.code = 'ai.invalid-connection'
    err.errors = normalized.errors
    throw err
  }
  const c = normalized.connection
  const ownerId = input.ownerId ?? null
  // `_id` is global, so two owners may not share `openai:default`. Scope the
  // generated id by owner; an explicit id is used as-is and still owner-checked.
  const id = String(input.id ?? '').trim() || (ownerId ? `${ownerId}:${c.id}` : c.id)
  const existing = await AiProviderConnection.findOne({ _id: id, ownerId }).lean()
  const providedKey = String(input.apiKey ?? '').trim()
  const isKeyless = Boolean(providerDefinition(c.provider)?.keyless) || isLocalEndpoint(c.baseUrl) || /freellm|local/i.test(c.provider)
  if (!existing && !c.apiKey && !isKeyless) {
    const err = new Error('apiKey is required')
    err.code = 'ai.invalid-connection'
    throw err
  }
  let secretEnc = existing?.secretEnc ?? null
  let secretMask = existing?.secretMask ?? ''
  let fingerprint = existing?.secretFingerprint ?? null
  if (c.provider === 'ollama' || (isKeyless && !providedKey)) {
    secretEnc = null
    secretMask = ''
    fingerprint = null
  } else if (providedKey) {
    secretEnc = encryptSecret(providedKey)
    secretMask = maskSecret(providedKey)
    fingerprint = secretFingerprint(providedKey)
  } else if (!existing && !isKeyless) {
    const err = new Error('apiKey is required')
    err.code = 'ai.invalid-connection'
    throw err
  }

  const identityChanged =
    Boolean(existing) &&
    (existing.provider !== c.provider || existing.baseUrl !== c.baseUrl || existing.model !== c.model)
  const secretChanged = Boolean(providedKey) || (!existing && Boolean(secretEnc))

  const doc = {
    name: c.name,
    provider: c.provider,
    adapter: c.adapter,
    baseUrl: c.baseUrl,
    model: c.model,
    secretEnc,
    secretMask,
    secretFingerprint: fingerprint,
    enabled: c.enabled,
    capabilities: c.capabilities,
    privacy: c.privacy,
    ownerId: input.ownerId ?? existing?.ownerId ?? null,
    schemaVersion: AI_PROVIDER_SCHEMA_VERSION,
    ...(identityChanged || secretChanged
      ? { status: 'untested', lastError: null, lastErrorCode: null, lastTestedAt: null, testLatencyMs: null }
      : {}),
  }

  const saved = await AiProviderConnection.findByIdAndUpdate(
    id,
    { $set: doc, $setOnInsert: { _id: id } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()
  await audit({
    action: existing ? 'update' : 'create',
    connectionId: id,
    provider: c.provider,
    actor,
    ok: true,
  })
  return rowToRedacted(saved)
}

export async function deleteConnection(id, { actor = null, ownerId = null } = {}) {
  const row = await AiProviderConnection.findOneAndDelete({ _id: String(id ?? ''), ownerId }).lean()
  if (!row) return false
  // Cascade: the connection's model catalogue is meaningless without it.
  await AiProviderModel.deleteMany({ connectionId: row._id }).catch(() => null)
  await audit({ action: 'delete', connectionId: row._id, provider: row.provider, actor, ok: true })
  return true
}

// =============================================================================
//  TM Hub relay sync (shared AI, app holds no key). The hub's catalog endpoint
//  lists usable (own + granted) AI connections; each becomes a local row with
//  provider='hub' that the gateway proxies through the relay. Secrets never
//  leave the hub — only this app's X-App-Secret authorizes the relay.
// =============================================================================

/** Relay env config (null when any of the three vars is missing). */
export function hubRelayEnv(env = process.env) {
  const url = String(env.NUXT_PUBLIC_HUB_URL ?? env.HUB_URL ?? '').trim().replace(/\/+$/, '')
  const appId = String(env.NUXT_PUBLIC_HUB_APP_ID ?? '').trim()
  const secret = String(env.NUXT_HUB_APP_SECRET ?? '').trim()
  if (!url || !appId || !secret) return null
  return { url, appId, secret }
}

/** Local request config for a hub row (null when the relay env is incomplete). */
export function hubCandidate(row, env = process.env) {
  const relay = hubRelayEnv(env)
  if (!relay || !String(row?.hubConnectionId ?? '').trim()) return null
  return { ...relay, hubConnectionId: String(row.hubConnectionId) }
}

function normalizeHubModels(hub) {
  return (Array.isArray(hub?.models) ? hub.models : [])
    .map((m) => (m && typeof m === 'object'
      ? {
        model: String(m.modelId ?? '').trim(),
        displayName: String(m.displayName ?? '').trim().slice(0, 128) || null,
        isPrimary: m.isPrimary === true,
      }
      : null))
    .filter((m) => m && m.model)
}

/**
 * Mirror the hub catalog into local `provider='hub'` rows. Idempotent: existing
 * rows keep the user's locally chosen model and enable state; hub rows that
 * disappear from the relay (revoked grant or centrally disabled) are disabled
 * locally, never deleted — history and the audit trail survive.
 */
export async function upsertHubCatalog(hubRows = [], { ownerId = null, actor = null, deps = null } = {}) {
  const C = deps?.connection ?? AiProviderConnection
  const result = { created: 0, updated: 0, disabled: 0, modelsAdded: 0, skipped: 0, errors: [] }
  if (!ownerId) return { ok: false, code: 'bad_input', ...result }
  const list = Array.isArray(hubRows) ? hubRows : []
  const seenHubIds = new Set()
  for (const hub of list) {
    const hubConnectionId = String(hub?.connectionId ?? '').trim()
    if (!hubConnectionId) {
      result.skipped += 1
      continue
    }
    seenHubIds.add(hubConnectionId)
    const localId = `${ownerId}:hub:${hubConnectionId}`
    const existing = await C.findOne({ _id: localId }).lean()
    const catalogModels = normalizeHubModels(hub)
    const fallbackModel = catalogModels.find((m) => m.isPrimary)?.model ?? catalogModels[0]?.model ?? ''
    // First sync adopts the hub primary; later syncs preserve the local choice
    // (a one-click model switch must not be silently reverted by a re-sync).
    const model = (existing?.model || String(hub?.model ?? '').trim() || fallbackModel).trim()
    if (!model) {
      result.skipped += 1
      result.errors.push({ connectionId: hubConnectionId, message: 'no model available for this hub connection' })
      continue
    }
    const hubDef = providerDefinition('hub')
    const doc = {
      name: String(hub?.name ?? '').trim().slice(0, 80) || hubConnectionId,
      provider: 'hub',
      adapter: 'hub_relay',
      baseUrl: '',
      model,
      secretEnc: null,
      secretMask: '',
      secretFingerprint: null,
      capabilities: { ...hubDef?.capabilities },
      privacy: hubDef?.privacy ?? 'hub',
      status: 'untested',
      lastError: null,
      lastErrorCode: null,
      lastTestedAt: null,
      testLatencyMs: null,
      hubConnectionId,
      hubProvider: String(hub?.provider ?? '').trim() || null,
      hubSyncedAt: now(),
      ownerId,
      schemaVersion: AI_PROVIDER_SCHEMA_VERSION,
    }
    await C.findByIdAndUpdate(
      localId,
      { $set: doc, $setOnInsert: { _id: localId, enabled: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).catch((e) => {
      result.errors.push({ connectionId: hubConnectionId, message: safeMessage(e) })
      return null
    })
    if (existing) result.updated += 1
    else result.created += 1
    if (catalogModels.length) {
      const res = await upsertModels({
        ownerId,
        connectionId: localId,
        models: catalogModels,
        source: 'discovered',
        deps: { model: deps?.model ?? AiProviderModel, connection: C },
      }).catch(() => null)
      if (res?.ok) result.modelsAdded += res.added ?? 0
    }
  }
  // Hub rows the relay no longer grants are switched off locally (reversible).
  const localHubRows = await C.find({ ownerId, provider: 'hub' }).select('_id hubConnectionId').lean()
  for (const row of localHubRows) {
    if (!row.hubConnectionId || seenHubIds.has(String(row.hubConnectionId))) continue
    await C.updateOne({ _id: row._id }, { $set: { enabled: false, hubSyncedAt: now() } })
    result.disabled += 1
  }
  await audit({
    action: 'hub-sync',
    connectionId: null,
    provider: 'hub',
    actor,
    ok: true,
    detail: `created=${result.created} updated=${result.updated} disabled=${result.disabled}`,
  })
  return { ok: true, connections: list.length, ...result }
}

/**
 * Pull the relay catalog from tm-hub and mirror it locally. Requires the three
 * relay env vars; failures return stable codes instead of throwing.
 */
export async function syncHubCatalog({
  ownerId = null,
  actor = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  deps = null,
} = {}) {
  if (!ownerId) return { ok: false, code: 'bad_input' }
  const relay = hubRelayEnv(env)
  if (!relay) return { ok: false, code: 'hub_not_configured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 15_000))
  let body = null
  try {
    const res = await fetchImpl(`${relay.url}/api/v1/apps/${relay.appId}/ai/relay/catalog`, {
      method: 'GET',
      headers: { accept: 'application/json', 'x-app-id': relay.appId, 'x-app-secret': relay.secret },
      signal: controller.signal,
    })
    const text = await res.text()
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    if (!res.ok) {
      return { ok: false, code: 'hub_error', error: String(body?.message ?? '').trim() || `HTTP ${res.status}`, status: res.status }
    }
    const connections = body?.data?.connections
    if (!Array.isArray(connections)) return { ok: false, code: 'hub_bad_shape' }
    const up = await upsertHubCatalog(connections, { ownerId, actor, deps })
    return { ok: true, connections: connections.length, ...up }
  } catch (e) {
    const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message ?? ''))
    return { ok: false, code: aborted ? 'hub_timeout' : 'hub_network', error: safeMessage(e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Health check for a hub row: the relay must still grant this connection. */
async function testHubConnection(row, { fetchImpl = globalThis.fetch, timeoutMs = 10_000, actor = null, persist = true, env = process.env } = {}) {
  const started = now()
  const relay = hubCandidate(row, env)
  let result
  if (!relay) {
    result = { ok: false, status: 0, latencyMs: 0, models: [], code: 'hub_not_configured', error: 'relay env is not configured (NUXT_HUB_APP_SECRET required)' }
  } else {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 10_000))
    try {
      const res = await fetchImpl(`${relay.url}/api/v1/apps/${relay.appId}/ai/relay/catalog`, {
        method: 'GET',
        headers: { accept: 'application/json', 'x-app-id': relay.appId, 'x-app-secret': relay.secret },
        signal: controller.signal,
      })
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = null }
      const connections = Array.isArray(body?.data?.connections) ? body.data.connections : []
      const found = connections.some((c) => String(c?.connectionId ?? '') === String(row.hubConnectionId))
      result = res.ok && found
        ? { ok: true, status: res.status, latencyMs: now() - started, models: [] }
        : { ok: false, status: res.status, latencyMs: now() - started, models: [], code: found ? 'ai.http-error' : 'ai.http-404', error: found ? 'relay unavailable' : 'connection is no longer granted by TM Hub' }
    } catch (e) {
      const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message ?? ''))
      result = { ok: false, status: 0, latencyMs: now() - started, models: [], code: aborted ? 'ai.timeout' : 'ai.network', error: safeMessage(e) }
    } finally {
      clearTimeout(timer)
    }
  }
  return finish(row, result, { actor, persist })
}

// =============================================================================
//  Model catalogue (Phase G.5) — many saved models per connection; the bot's
//  active model is `connection.model`, switched by `setPrimaryModel` in one
//  click. Mirrors tm-hub R147's ai_models, app-owned per D35.
// =============================================================================

const modelIdFor = (connectionId, model) => `${String(connectionId)}::${String(model)}`

/** Verify the connection belongs to this owner (tenancy §61.3) before model ops. */
async function ownsConnection(connectionId, ownerId, connection = AiProviderConnection) {
  if (!ownerId) return false
  return Boolean(await connection.exists({ _id: String(connectionId ?? ''), ownerId }))
}

/** The connection's saved model rows, primary first, then alphabetical. */
export async function listModels({ ownerId = null, connectionId = null, deps = null } = {}) {
  const M = deps?.model ?? AiProviderModel
  if (!ownerId || !connectionId) return []
  return M.find({ ownerId, connectionId })
    .sort({ isPrimary: -1, model: 1 })
    .limit(500)
    .lean()
}

/**
 * Bulk-save models (from discovery or manual entry). Idempotent (D3):
 * existing rows are left untouched ($setOnInsert), so re-running a discovery
 * never resets per-model enablement.
 */
export async function upsertModels({ ownerId = null, connectionId = null, models = [], source = 'discovered', deps = null } = {}) {
  const M = deps?.model ?? AiProviderModel
  const C = deps?.connection ?? AiProviderConnection
  if (!ownerId || !connectionId) return { ok: false, code: 'bad_input', added: 0 }
  if (!await ownsConnection(connectionId, ownerId, C)) return { ok: false, code: 'connection_not_found', added: 0 }
  // Accept plain strings (["gpt-4o"]) or entries ({model, displayName}). A row
  // keeps its original shape once inserted ($setOnInsert), so a later sync with
  // a different display name never overwrites a row the user may have edited.
  const seen = new Set()
  const clean = []
  for (const m of Array.isArray(models) ? models : []) {
    const entry = (m && typeof m === 'object') ? m : null
    const model = String(entry?.model ?? entry?.modelId ?? m ?? '').trim()
    if (!model || seen.has(model)) continue
    const displayName = String(entry?.displayName ?? '').trim().slice(0, 128) || null
    seen.add(model)
    clean.push({ model, displayName })
  }
  if (clean.length === 0) return { ok: true, added: 0, total: 0 }
  const ops = clean.map(({ model, displayName }) => ({
    updateOne: {
      filter: { _id: modelIdFor(connectionId, model) },
      update: {
        $setOnInsert: {
          _id: modelIdFor(connectionId, model),
          connectionId: String(connectionId),
          ownerId,
          model,
          ...(displayName ? { displayName } : {}),
          isEnabled: true,
          isPrimary: false,
          source: source === 'manual' ? 'manual' : 'discovered',
          schemaVersion: AI_PROVIDER_SCHEMA_VERSION,
        },
      },
      upsert: true,
    },
  }))
  const res = await M.bulkWrite(ops, { ordered: false }).catch(() => null)
  if (!res) return { ok: false, code: 'store_error', added: 0 }
  return { ok: true, added: res.upsertedCount || 0, total: clean.length }
}

export async function setModelEnabled({ ownerId = null, connectionId = null, model = '', isEnabled = true, deps = null } = {}) {
  const M = deps?.model ?? AiProviderModel
  const C = deps?.connection ?? AiProviderConnection
  if (!ownerId || !connectionId || !String(model).trim()) return null
  if (!await ownsConnection(connectionId, ownerId, C)) return null
  return M.findOneAndUpdate(
    { _id: modelIdFor(connectionId, model), ownerId, connectionId },
    { $set: { isEnabled: Boolean(isEnabled) } },
    { new: true },
  ).lean()
}

/**
 * Switch the bot's active model: demote the old primary, promote `model` and
 * write it into `connection.model` — every consumer (gateway, assistant,
 * session analysis) resolves through the connection, so the switch is live on
 * the next request with zero redeploys. A model change invalidates the last
 * health result (same identity rule as upsertConnection).
 */
export async function setPrimaryModel({ ownerId = null, connectionId = null, model = '', actor = null, deps = null } = {}) {
  const M = deps?.model ?? AiProviderModel
  const C = deps?.connection ?? AiProviderConnection
  const modelClean = String(model ?? '').trim()
  if (!ownerId || !connectionId || !modelClean) return null
  if (!await ownsConnection(connectionId, ownerId, C)) return null

  // Demote the current primary first — the partial unique index allows exactly
  // one isPrimary per connection, so promote strictly after demote.
  await M.updateMany(
    { connectionId: String(connectionId), isPrimary: true, model: { $ne: modelClean } },
    { $set: { isPrimary: false } },
  )
  const row = await M.findOneAndUpdate(
    { _id: modelIdFor(connectionId, modelClean), ownerId, connectionId: String(connectionId) },
    {
      $set: { isPrimary: true, isEnabled: true, connectionId: String(connectionId), ownerId, model: modelClean },
      $setOnInsert: { source: 'manual', schemaVersion: AI_PROVIDER_SCHEMA_VERSION },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()

  const connection = await C.findOneAndUpdate(
    { _id: String(connectionId), ownerId },
    {
      $set: {
        model: modelClean,
        status: 'untested',
        lastError: null,
        lastErrorCode: null,
        lastTestedAt: null,
        testLatencyMs: null,
      },
    },
    { new: true },
  ).lean()
  if (!connection) return null
  await audit({
    action: 'set-primary-model',
    connectionId: String(connectionId),
    provider: connection.provider,
    actor,
    ok: true,
    detail: modelClean,
  })
  return { model: rowToRedacted(connection), catalogRow: row }
}

/**
 * Unset the primary marker on one catalogue row ("turn off" the primary badge).
 * The bot's active model string (`connection.model`) is deliberately left
 * untouched — clearing the badge must not change what the bot uses; pick
 * another primary to switch. Idempotent.
 */
export async function unsetPrimaryModel({ ownerId = null, connectionId = null, model = '', actor = null, deps = null } = {}) {
  const M = deps?.model ?? AiProviderModel
  const C = deps?.connection ?? AiProviderConnection
  const modelClean = String(model ?? '').trim()
  if (!ownerId || !connectionId || !modelClean) return null
  if (!await ownsConnection(connectionId, ownerId, C)) return null

  const row = await M.findOneAndUpdate(
    { _id: modelIdFor(connectionId, modelClean), ownerId, connectionId: String(connectionId) },
    { $set: { isPrimary: false } },
    { new: true },
  ).lean()
  if (!row) return null
  const connection = await C.findOne({ _id: String(connectionId), ownerId }).lean()
  await audit({
    action: 'unset-primary-model',
    connectionId: String(connectionId),
    provider: connection?.provider ?? null,
    actor,
    ok: true,
    detail: modelClean,
  })
  return { model: row.model }
}

/**
 * Remove one catalogue row. The connection's active model string is NEVER
 * touched here — deleting a saved model only forgets it from the address book;
 * the primary model keeps working even if its row is gone.
 */
export async function deleteModel({ ownerId = null, connectionId = null, model = '', deps = null } = {}) {
  const M = deps?.model ?? AiProviderModel
  const C = deps?.connection ?? AiProviderConnection
  if (!ownerId || !connectionId || !String(model).trim()) return false
  if (!await ownsConnection(connectionId, ownerId, C)) return false
  const removed = await M.findOneAndDelete({
    _id: modelIdFor(connectionId, model),
    ownerId,
    connectionId,
  }).lean()
  return Boolean(removed)
}

export async function setEnabled(id, enabled, { actor = null, ownerId = null } = {}) {
  // Preserve the last health result. A connection that failed stays visibly
  // failed until it is tested again — toggling enable/disable must not silently
  // reset it to "untested". The UI renders the disabled state from `enabled`.
  const row = await AiProviderConnection.findOneAndUpdate(
    { _id: String(id ?? ''), ownerId },
    { $set: { enabled: Boolean(enabled) } },
    { new: true },
  ).lean()
  if (!row) return null
  await audit({
    action: enabled ? 'enable' : 'disable',
    connectionId: row._id,
    provider: row.provider,
    actor,
    ok: true,
  })
  return rowToRedacted(row)
}

function modelsUrl(conn) {
  return `${String(conn.baseUrl).replace(/\/+$/, '')}/models`
}

function authHeaders(conn, apiKey) {
  if (conn.adapter === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  }
  if (conn.adapter === 'ollama' && !apiKey) return {}
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
}

function classify(status) {
  if (status === 401 || status === 403) return 'ai.invalid-key'
  if (status === 429) return 'ai.rate-limited'
  if (status >= 500) return 'ai.provider-unavailable'
  return 'ai.http-error'
}

function parseModels(body) {
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
  return data
    .map((m) => String(m?.id ?? m?.name ?? m?.model ?? '').trim())
    .filter(Boolean)
    .slice(0, 200)
}

/**
 * Reachability + credential check against the provider's model list. This is a
 * health test, not an inference test: it proves the endpoint and key are valid
 * and that the configured model is advertised. Capabilities remain *declared*
 * until a request actually exercises them.
 */
export async function testConnection(idOrConn, { fetchImpl = globalThis.fetch, timeoutMs = 10_000, actor = null, persist = true } = {}) {
  const isRow = typeof idOrConn === 'object' && idOrConn !== null
  const row = isRow ? idOrConn : await AiProviderConnection.findById(String(idOrConn ?? '')).lean()
  if (!row) {
    const err = new Error('connection not found')
    err.code = 'ai.connection-not-found'
    throw err
  }
  const keyless = Boolean(providerDefinition(row.provider)?.keyless) || isLocalEndpoint(row.baseUrl) || /freellm|local/i.test(row.provider)
  // Hub rows hold no key: health = "the relay still grants this connection".
  if (row.provider === 'hub') return testHubConnection(row, { fetchImpl, timeoutMs, actor, persist })
  let apiKey = ''
  try {
    apiKey = row.apiKey || (row.secretEnc ? decryptSecret(row.secretEnc) : '')
  } catch (e) {
    apiKey = ''
  }
  if (!keyless && !apiKey) {
    return finish(row, { ok: false, status: 0, latencyMs: 0, models: [], code: 'ai.no-key', error: 'apiKey is not configured' }, { actor, persist })
  }

  const started = now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 10_000))
  let result
  try {
    let res = await fetchImpl(modelsUrl(row), {
      method: 'GET',
      headers: { accept: 'application/json', ...authHeaders(row, apiKey) },
      signal: controller.signal,
    })
    if (!res.ok && res.status === 404) {
      const base = String(row.baseUrl || '').replace(/\/+$/, '')
      const altBase = base.endsWith('/v1') ? base.replace(/\/v1$/, '') : `${base}/v1`
      try {
        const altRes = await fetchImpl(`${altBase}/models`, {
          method: 'GET',
          headers: { accept: 'application/json', ...authHeaders(row, apiKey) },
          signal: controller.signal,
        })
        if (altRes.ok) res = altRes
      } catch { }
    }
    const latencyMs = now() - started
    const text = await res.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    if (!res.ok) {
      if (isLocalEndpoint(row.baseUrl) && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
        result = { ok: true, status: 200, latencyMs, models: [], code: 'ok', warning: 'Local endpoint registered (satellite client tests directly)' }
      } else {
        result = { ok: false, status: res.status, latencyMs, models: [], code: classify(res.status), error: `HTTP ${res.status}` }
      }
    } else {
      const models = parseModels(body)
      const wanted = String(row.model).toLowerCase()
      const modelFound = models.some((m) => m.toLowerCase() === wanted) || models.some((m) => m.toLowerCase().includes(wanted))
      result = {
        ok: true,
        status: res.status,
        latencyMs,
        models,
        modelFound,
        warning: modelFound ? null : 'configured model was not advertised by the provider',
      }
    }
  } catch (e) {
    const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message ?? ''))
    if (isLocalEndpoint(row.baseUrl) && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
      result = { ok: true, status: 200, latencyMs: now() - started, models: [], code: 'ok', warning: 'Local endpoint registered (satellite client tests directly)' }
    } else {
      result = {
        ok: false,
        status: 0,
        latencyMs: now() - started,
        models: [],
        code: aborted ? 'ai.timeout' : 'ai.network',
        error: safeMessage(e),
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return finish(row, result, { actor, persist })
}

async function finish(row, result, { actor, persist }) {
  const checkedAt = now()
  const out = {
    ok: Boolean(result.ok),
    status: Number(result.status) || 0,
    latencyMs: Number(result.latencyMs) || 0,
    models: result.models ?? [],
    modelFound: result.modelFound ?? null,
    warning: result.warning ?? null,
    code: result.ok ? null : result.code ?? 'ai.http-error',
    error: result.ok ? null : safeMessage(result.error ?? result.code),
    checkedAt,
  }
  if (persist) {
    await AiProviderConnection.findByIdAndUpdate(row._id, {
      $set: {
        status: out.ok ? 'ok' : 'error',
        lastTestedAt: checkedAt,
        lastError: out.error,
        lastErrorCode: out.code,
        testLatencyMs: out.latencyMs,
      },
    }).catch(() => null)
    await audit({
      action: 'test',
      connectionId: String(row._id),
      provider: row.provider,
      actor,
      ok: out.ok,
      code: out.code,
      detail: out.error,
    })
  }
  return out
}

/**
 * Discover the model list for credentials that are NOT yet saved. The key is
 * encrypted only to satisfy the health-test path and is never persisted
 * (`persist: false`), so the caller gets the advertised model ids without
 * touching the collection.
 */
export async function discoverModelsForInput(input = {}, { env = process.env, fetchImpl, timeoutMs } = {}) {
  const key = resolveProviderKey(input.provider, input.baseUrl) ?? String(input.provider ?? '').trim().toLowerCase()
  const def = providerDefinition(key)
  if (!def) {
    const err = new Error(`unknown provider: ${key}`)
    err.code = 'ai.invalid-connection'
    throw err
  }
  const apiKey = String(input.apiKey ?? '').trim()
  const baseUrl = (String(input.baseUrl ?? '').trim() || def.baseUrl || '').replace(/\/+$/, '')
  if (!baseUrl) {
    const err = new Error('baseUrl is required for this provider')
    err.code = 'ai.invalid-connection'
    throw err
  }
  const row = {
    _id: 'discover-temp',
    provider: def.key,
    model: String(input.model ?? '').trim(),
    baseUrl,
    apiKey,
    secretEnc: apiKey ? encryptSecret(apiKey, env) : null,
    secretMask: '',
    secretFingerprint: null,
  }
  const result = await testConnection(row, { persist: false, fetchImpl, timeoutMs })
  return { ok: result.ok, models: result.models, code: result.code, error: result.error }
}

/**
 * Internal request candidates. The `apiKey` field is for the gateway only; the
 * API layer must never return this shape.
 */
export async function resolveProviderCandidates({ id = null, ownerId = null, required = ['chat'], includeEnv = true, env = process.env } = {}) {
  const rows = id
    ? [await AiProviderConnection.findOne({ _id: String(id), ownerId }).lean()].filter(Boolean)
    : await AiProviderConnection.find({ enabled: true, ownerId }).lean()
  rows.sort((a, b) => {
    const rank = (r) => (r.status === 'ok' ? 0 : r.status === 'untested' ? 1 : 2)
    return rank(a) - rank(b) || Number(b.lastTestedAt ?? 0) - Number(a.lastTestedAt ?? 0)
  })
  const candidates = []
  for (const row of rows) {
    if (row.enabled === false) continue
    if (!supports(row.provider, required)) continue
    let apiKey = ''
    if (!providerDefinition(row.provider)?.keyless && !isLocalEndpoint(row.baseUrl) && !/freellm|local/i.test(row.provider)) {
      try { apiKey = decryptSecret(row.secretEnc, env) } catch { continue }
      if (!apiKey) continue
    }
    // Hub rows ship the relay identity with them; a row without complete env
    // config (or hub linkage) is silently indistinguishable from a dead one —
    // resolveAiProvider surfaces "no provider" either way.
    let relay = null
    if (row.provider === 'hub') {
      relay = hubCandidate(row, env)
      if (!relay) continue
    }
    candidates.push({
      id: String(row._id),
      name: row.name,
      provider: row.provider,
      adapter: row.adapter,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey,
      enabled: true,
      capabilities: row.capabilities,
      ...(relay ? {
        hubConnectionId: relay.hubConnectionId,
        relayUrl: relay.url,
        relayAppId: relay.appId,
        relaySecret: relay.secret,
      } : {}),
      source: 'store',
    })
  }
  if (candidates.length === 0 && includeEnv) {
    const fallback = envConnection(env)
    if (fallback && supports(fallback.provider, required)) candidates.push(fallback)
  }
  if (candidates.length > 1) {
    const primary = candidates[0]
    const compatible = candidates.filter((c) => c === primary || fallbackCompatible(primary, c, required))
    return compatible
  }
  return candidates
}

export async function resolveProviderConfig(opts = {}) {
  const list = await resolveProviderCandidates(opts)
  return list[0] ?? null
}

/** Budget counters live on the connection row; usage is recorded by the caller. */
export async function recordUsage(id, { tokens = 0, usd = 0 } = {}) {
  if (!id || id === 'env') return null
  const inc = {}
  if (Number(tokens) > 0) inc['budgets.usedTokens'] = Number(tokens)
  if (Number(usd) > 0) inc['budgets.usedUsd'] = Number(usd)
  if (Object.keys(inc).length === 0) return null
  return AiProviderConnection.findByIdAndUpdate(String(id), { $inc: inc }, { new: true }).lean()
}

export async function budgetFor(id) {
  const row = await AiProviderConnection.findById(String(id ?? '')).lean()
  if (!row) return null
  return budgetStatus(row.budgets ?? {}, row.budgets ?? {})
}

export { envConnection, providerDefinition, isLocalEndpoint }

