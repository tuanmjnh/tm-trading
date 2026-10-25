import { readBody } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tfLabel } from '~~/app/utils/timeframe'
import { botProfileModel, botRuntimeStore, strategyProfileModel, strategyService } from '../../../utils/engineModel'
import { loadMethodRegistry } from '../../../utils/methods'

// The engine .mjs modules infer destructured-default types (`ownerId = null`),
// which rejects plain strings — callers use a loose structural type instead
// (same pattern as server/utils/aiProviders.ts).
interface StrategySvcLoose {
  listVersions(strategyId: string, opts?: { ownerId?: string | null, limit?: number }): Promise<Array<{ version?: string, strategyVersionId?: string }>>
  createVersion(input: Record<string, unknown>): Promise<{ ok?: boolean, code?: string, version?: { strategyVersionId?: string | null } | null }>
}
interface RuntimeLoose {
  createInstanceFromProfile(input: Record<string, unknown>): Promise<{ ok?: boolean, instanceId?: string, created?: boolean, state?: string, code?: string }>
  enqueueCommand(input: Record<string, unknown>): Promise<{ ok?: boolean, duplicate?: boolean }>
}

interface VersionModule {
  /** Raw stable-stringify sha256 — NO schema validation (canonicalParams only
   *  accepts the engine-wide backtest schema; method params are free-form). */
  hashOf(value: unknown): string
}

let versionP: Promise<VersionModule> | null = null
function engineVersion(): Promise<VersionModule> {
  versionP ??= import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'engine', 'version.mjs')).href) as Promise<VersionModule>
  return versionP
}

// =============================================================================
//  POST /api/v1/bots/launch — UI one-shot bot launcher (roadmap §57.4/§61).
//
//  Body: { method, symbol, timeframe?, account?, params? }
//
//  Wires the full chain from a pine-derived METHOD to a RUNNING paper bot:
//    strategy version (immutable, methodVersions={[method]:1}) ->
//    strategy profile (per owner+method pointer) ->
//    bot profile (operational config, LIVE_PAPER) ->
//    bot instance (createInstanceFromProfile) ->
//    durable `start` command (applied by the owner's supervisor worker).
//
//  Nothing here bypasses the runtime rules: the HTTP layer only writes the
//  durable rows; state transitions still belong to the worker (one executor).
// =============================================================================

const TIMEFRAMES = new Set(['1', '5', '15', '30', '60', '240', 'D'])
const ID_SAFE = /[^a-z0-9-]+/g

export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  }

  const method = String(body.method ?? '').trim()
  const symbol = String(body.symbol ?? '').trim().toUpperCase()
  const timeframe = String(body.timeframe ?? '15').trim()
  const account = typeof body.account === 'string' && body.account.trim() ? body.account.trim() : 'paper-main'
  // Optional display name; empty -> auto-generated from the launch config.
  const customName = String(body.name ?? '').trim().slice(0, 80)
  const displayName = customName
    || `${method} · ${symbol} ${tfLabel(timeframe)}${account !== 'paper-main' ? ` · ${account}` : ''}`
  const params = (body.params && typeof body.params === 'object' && !Array.isArray(body.params))
    ? body.params as Record<string, unknown>
    : {}

  // Per-bot stop management (breakeven / ATR trailing) — validated, stored on
  // the bot profile and handed to the paper executor via the instance.
  const rawExec = (body.execution && typeof body.execution === 'object' && !Array.isArray(body.execution))
    ? body.execution as Record<string, unknown>
    : {}
  const num = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  const execution = {
    slBreakevenOn: rawExec.slBreakevenOn === true,
    slTriggerR: num(rawExec.slTriggerR, 1),
    slTrailOn: rawExec.slTrailOn === true,
    slTrailAtrMult: num(rawExec.slTrailAtrMult, 1.5),
    slTrailAtrLen: num(rawExec.slTrailAtrLen, 14),
  }

  if (!method || !symbol) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'method and symbol are required' })
  }
  if (!TIMEFRAMES.has(timeframe)) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: `timeframe must be one of ${[...TIMEFRAMES].join(', ')}` })
  }

  // 1) Method must exist in the engine registry (single source, D1).
  const registry = await loadMethodRegistry()
  const def = registry.find(m => m.id === method)
  if (!def) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: `unknown method "${method}"` })
  }

  const { StrategyProfile } = { StrategyProfile: await strategyProfileModel() }
  const BotProfile = await botProfileModel()
  if (!StrategyProfile || !BotProfile) {
    throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })
  }

  const now = Date.now()
  const strategyId = `bot-${method}`
  const symbolSan = symbol.toLowerCase().replace(ID_SAFE, '-')

  try {
    // 2) Strategy profile (pointer) — one per owner+method, reuse when present.
    const profileId = `${strategyId}`.slice(0, 60)
    let sProfile = await StrategyProfile.findOne({ profileId, ownerId }).lean()
    if (!sProfile) {
      sProfile = await StrategyProfile.create({
        _id: `${ownerId}:${profileId}`,
        profileId,
        ownerId,
        name: `${method} — UI launch`,
        status: 'active',
        strategyVersionId: null,
        instruments: [symbol],
        timeframes: [timeframe],
        createdAt: now,
        schemaVersion: 'strategyProfile.v1',
      })
    } else if (!sProfile.instruments?.includes(symbol)) {
      await StrategyProfile.updateOne({ _id: sProfile._id }, { $addToSet: { instruments: symbol } })
    }

    // 3) Immutable strategy version — new params = new version (D1/D3).
    //    paramsHash here is the raw config hash (hashOf): the strategy's
    //    parameters are METHOD params (free-form), not the engine-wide
    //    backtest PARAM_SCHEMA — canonicalParams() would reject them.
    const mergedParams: Record<string, unknown> = { ...(def.defaults ?? {}), ...params }
    const svc = await strategyService() as unknown as StrategySvcLoose
    const { hashOf } = await engineVersion()
    const configHash = hashOf({ method, symbol, timeframe, params: mergedParams, execution })
    const existing = await svc.listVersions(profileId, { ownerId, limit: 100 })
    const minor = existing.length
      ? existing.map(v => Number(String(v.version ?? '0.0.0').split('.')[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0) + 1
      : 1
    const version = `0.${minor}.0`
    const created = await svc.createVersion({
      ownerId,
      strategyId: profileId,
      version,
      paramsHash: configHash,
      methodVersions: { [method]: '1' },
      parameters: mergedParams,
      supersedes: existing[0]?.strategyVersionId ?? null,
      createdBy: 'ui',
      now,
    })
    if (!created?.ok) {
      throw createError({ statusCode: 500, statusMessage: 'error.strategy_version', message: String(created?.code ?? 'create failed') })
    }

    // 4) Bot profile — operational config (mode/instruments/risk).
    // Identity = method + symbol + timeframe + ACCOUNT: each paper account is
    // its own order book (one active bot per account), so parallel bots need a
    // profile per combo — a shared id would silently overwrite the previous bot.
    const accountSan = account.toLowerCase().replace(ID_SAFE, '-').slice(0, 24) || 'paper-main'
    const botProfileId = `bot-${method}-${symbolSan}-${timeframe.toLowerCase()}-${accountSan}`.slice(0, 80)
    const effHash = configHash
    const botProfile = await BotProfile.findOneAndUpdate(
      { profileId: botProfileId, ownerId },
      {
        $set: {
          name: displayName,
          description: `Launched from the UI on ${new Date(now).toISOString()}`,
          strategyVersionId: (created as { version?: { strategyVersionId?: string } }).version?.strategyVersionId ?? null,
          mode: 'LIVE_PAPER',
          enabled: true,
          status: 'enabled',
          instruments: [symbol],
          timeframes: [timeframe],
          simulatedAccountId: account,
          paramOverrides: mergedParams,
    execution,
          effectiveParamsHash: effHash,
          createdBy: 'ui',
          schemaVersion: 'botProfile.v1',
        },
        $setOnInsert: {
          _id: `${ownerId}:${botProfileId}`,
          profileId: botProfileId,
          ownerId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean()

    // Disabled profile = launch blocked (the enable toggle in the UI exists
    // exactly to prevent accidental launches from a parked config).
    if (botProfile && botProfile.enabled === false) {
      throw createError({ statusCode: 409, statusMessage: 'error.profile_disabled', message: 'This bot profile is disabled — enable it first' })
    }

    // 5) Instance + durable start command (the worker applies it).
    const runtime = await botRuntimeStore() as unknown as RuntimeLoose
    const inst = await runtime.createInstanceFromProfile({
      ownerId,
      profileId: botProfileId,
      accountId: account,
      createdBy: 'ui',
      now,
    })
    if (!inst?.ok || !inst.instanceId) {
      throw createError({ statusCode: 500, statusMessage: 'error.bot_instance', message: String(inst?.code ?? 'instance create failed') })
    }
    const cmd = await runtime.enqueueCommand({
      ownerId,
      instanceId: inst.instanceId,
      type: 'start',
      commandId: `cmd_start_${inst.instanceId}_${now.toString(36)}`,
      botProfileId,
      accountId: account,
    })

    return {
      success: true,
      data: {
        instanceId: inst.instanceId,
        created: inst.created === true,
        state: inst.state ?? 'queued',
        botProfileId,
        strategyProfileId: profileId,
        strategyVersionId: created.version?.strategyVersionId ?? null,
        commandEnqueued: cmd?.ok === true,
        workerHint: 'Run `npm run bot:worker -- --owner <ownerId>` (or BOT_OWNER_ID) so the supervisor applies the start command.',
      },
    }
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode) throw err
    throw createError({ statusCode: 500, statusMessage: 'error.bot_launch', message: String((err as Error)?.message ?? err).slice(0, 300) })
  }
})
