import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// =============================================================================
//  OPERATIONS READ MODEL LOADER (V4.2 §17.9)
//
//  The Operations API is a thin shell: it loads two service modules and hands
//  them to `buildOperationsView()`. The modules live in `services/`, which Nitro
//  cannot statically bundle from `server/`, so they are imported through an
//  absolute file URL with `@vite-ignore` — exactly the pattern
//  `server/utils/intel.ts` uses for `services/heartbeat.mjs`.
//
//  Read-only by design. Mutations are supervisor operations, never direct writes
//  here (A2/A3: the supervisor is the single writer of service state).
// =============================================================================

type ViewMod = typeof import('../../services/operationsView.mjs')
type StoreMod = typeof import('../../services/supervisorStore.mjs')
type InboxMod = typeof import('../../services/commandInbox.mjs')
type RegistryMod = typeof import('../../services/registry.mjs')

let viewModPromise: Promise<ViewMod> | null = null
let storeModPromise: Promise<StoreMod> | null = null
let inboxModPromise: Promise<InboxMod> | null = null
let registryModPromise: Promise<RegistryMod> | null = null

/** Only generated ids are safe as inbox filenames. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

function registryMod(): Promise<RegistryMod> {
  if (!registryModPromise) {
    const file = pathToFileURL(join(process.cwd(), 'services', 'registry.mjs')).href
    registryModPromise = import(/* @vite-ignore */ file) as Promise<RegistryMod>
  }
  return registryModPromise
}

/** One registry definition, or null when the id is unknown. */
export async function loadServiceDefinition(serviceId: string): Promise<any> {
  const registry = await registryMod()
  return registry.getServiceDefinition(serviceId) ?? null
}

/**
 * Services that can be asked to run exactly one cycle.
 *
 * The supervisor owns this decision in practice; this is the same predicate the
 * `run-all-once` endpoint needs to enqueue a batch: real code (`planned: false`),
 * hosted by no other process (`supervised !== false`) and advertising `run-once`.
 */
export async function listRunOnceServices(): Promise<Array<{ serviceId: string }>> {
  const registry = await registryMod()
  return registry.SERVICES
    .filter((definition: any) =>
      !definition.planned
      && definition.supervised !== false
      && (definition.supports ?? []).includes('run-once'),
    )
    .map((definition: any) => ({ serviceId: definition.id }))
}

function viewMod(): Promise<ViewMod> {
  if (!viewModPromise) {
    const file = pathToFileURL(join(process.cwd(), 'services', 'operationsView.mjs')).href
    viewModPromise = import(/* @vite-ignore */ file) as Promise<ViewMod>
  }
  return viewModPromise
}

function storeMod(): Promise<StoreMod> {
  if (!storeModPromise) {
    const file = pathToFileURL(join(process.cwd(), 'services', 'supervisorStore.mjs')).href
    storeModPromise = import(/* @vite-ignore */ file) as Promise<StoreMod>
  }
  return storeModPromise
}

function inboxMod(): Promise<InboxMod> {
  if (!inboxModPromise) {
    const file = pathToFileURL(join(process.cwd(), 'services', 'commandInbox.mjs')).href
    inboxModPromise = import(/* @vite-ignore */ file) as Promise<InboxMod>
  }
  return inboxModPromise
}

/**
 * Enqueue a control command for the supervisor (option b).
 *
 * The API never writes service state; it drops a command file that the
 * supervisor consumes on its next tick. The caller mints `operationId` so the
 * screen can poll for it before the supervisor has looked at the inbox.
 */
export async function enqueueServiceCommand(input: {
  operationId: string
  serviceId: string
  action: string
  actor: string
  idempotencyKey: string
  scopeKey?: string
  reason?: string | null
}): Promise<{ operationId: string, file: string }> {
  const inbox = await inboxMod()
  const dir = process.env.TM_SUPERVISOR_COMMANDS || inbox.COMMANDS_DIR
  const command = inbox.normaliseCommand({
    operationId: input.operationId,
    serviceId: input.serviceId,
    action: input.action,
    actor: input.actor,
    idempotencyKey: input.idempotencyKey,
    scopeKey: input.scopeKey ?? 'system',
    reason: input.reason ?? null,
  })
  const file = inbox.enqueueCommand(command, { dir })
  return { operationId: command.operationId, file }
}

/**
 * The Operations view: the registry merged with the last supervisor snapshot.
 *
 * A missing or unreadable supervisor state file is not an error — it means the
 * supervisor has not run yet, so the view falls back to registry-only rows with
 * `registered: false` and `observed: 'UNKNOWN'`.
 */
export async function loadOperationsView(now: number = Date.now()): Promise<any> {
  const [view, store, inbox] = await Promise.all([viewMod(), storeMod(), inboxMod()])

  let snapshot: unknown = null
  try {
    const file = process.env.TM_SUPERVISOR_STATE || store.SUPERVISOR_STATE_FILE
    snapshot = store.readSupervisorSnapshot(file)
  } catch {
    snapshot = null
  }

  let pendingOperations: unknown[] = []
  try {
    const dir = process.env.TM_SUPERVISOR_COMMANDS || inbox.COMMANDS_DIR
    pendingOperations = inbox.pendingOperations({ dir, now })
  } catch {
    pendingOperations = []
  }

  // Dead-letter count (§17.13 "dead-letter count"). A read of the directory, not
  // a parse, so it cannot make the status screen slow.
  let deadLetterCount = 0
  try {
    const dir = process.env.TM_SUPERVISOR_COMMANDS || inbox.COMMANDS_DIR
    deadLetterCount = inbox.quarantineCount({ dir })
  } catch {
    deadLetterCount = 0
  }

  return view.buildOperationsView({
    snapshot: snapshot as never,
    pendingOperations: pendingOperations as never,
    deadLetterCount,
    now,
  })
}

/**
 * One operation, from the supervisor's record or the inbox.
 *
 * The async contract (§17.7) lets a screen poll an `operationId` it was just
 * given. It may live in the inbox (not yet consumed) or in the supervisor's
 * store (accepted and advancing); both answer the same shape.
 */
export async function loadServiceOperation(operationId: string, now: number = Date.now()): Promise<{ operation: any, pending: boolean } | null> {
  if (typeof operationId !== 'string' || !SAFE_ID.test(operationId)) return null
  const [store, inbox] = await Promise.all([storeMod(), inboxMod()])

  try {
    const file = process.env.TM_SUPERVISOR_STATE || store.SUPERVISOR_STATE_FILE
    const snapshot = store.readSupervisorSnapshot(file)
    const found = (snapshot.operations ?? []).find((operation: any) => operation?.operationId === operationId)
    if (found) return { operation: found, pending: found.pending === true }
  } catch {
    // fall through to the inbox
  }

  try {
    const dir = process.env.TM_SUPERVISOR_COMMANDS || inbox.COMMANDS_DIR
    const pending = inbox.pendingOperations({ dir, now }).find((operation: any) => operation.operationId === operationId)
    if (pending) return { operation: pending, pending: true }
  } catch {
    // an unreadable inbox is "no such operation", not a 500
  }

  return null
}
