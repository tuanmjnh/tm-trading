import { MODULE_DEFINITIONS, SYSTEM_CAPABILITIES } from './permissions'

export interface RolePermissionEntry {
  module: string
  actions: string[]
}

const MAX_ENTRIES = 100
const MAX_ACTIONS_PER_MODULE = 100

function invalid(message: string): never {
  throw createError({ statusCode: 400, statusMessage: 'error.invalidPermissions', message })
}

/** Only system app (hub) may contain platform module permissions (ARCHITECTURE §2.4). */
export function assertPlatformModuleAllowed(appId: string): void {
  const hubAppId = String(useRuntimeConfig().public.hubAppId || '')
  if (appId !== hubAppId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'error.forbidden',
      message: 'platform.* permissions can only exist in the system application'
    })
  }
}

/**
 * Validate + sanitize body.permissions of roles API (POST/PUT).
 *
 * roles.permissions (JSONB [{module, actions}]) are mapped directly to JWT
 * capability `module.action` (auth/service.ts) - without filtering, callers with
 * roles.manage could escalate and grant platform.* capabilities to their role
 * (privilege escalation, ARCHITECTURE §2.4).
 *
 * Rules:
 * - Entry must be {module: string, actions: string[]}.
 * - module '*' is allowed only as full-access marker (root enforced at caller).
 * - module must belong to MODULE_DEFINITIONS catalog; actions must be '*' or
 *   valid `module.action` capability in SYSTEM_CAPABILITIES.
 * - module 'platform' is restricted to system app (hubAppId).
 */
export function sanitizeRolePermissions(input: unknown, opts: { appId: string }): RolePermissionEntry[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) invalid('permissions must be an array')
  if (input.length > MAX_ENTRIES) invalid(`permissions exceeds ${MAX_ENTRIES} entries`)

  const hubAppId = String(useRuntimeConfig().public.hubAppId || '')
  const knownModules = new Set(MODULE_DEFINITIONS.map(m => m.key))
  const knownCapabilities = new Set<string>(SYSTEM_CAPABILITIES)
  const out: RolePermissionEntry[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      invalid('each permission entry must be an object {module, actions}')
    }
    const entry = raw as Record<string, unknown>
    const module = typeof entry.module === 'string' ? entry.module.trim() : ''
    const actions = entry.actions

    if (!module) invalid('permission entry.module is required')
    if (!Array.isArray(actions) || actions.some(a => typeof a !== 'string')) {
      invalid(`permission entry.actions for module "${module}" must be a string array`)
    }
    if (actions.length > MAX_ACTIONS_PER_MODULE) {
      invalid(`too many actions for module "${module}"`)
    }

    // Full-access marker — only reachable when caller already enforced root.
    if (module === '*') {
      out.push({ module: '*', actions: ['*'] })
      continue
    }

    if (module === 'platform' && opts.appId !== hubAppId) {
      invalid('platform.* permissions can only be granted in the system application')
    }

    if (!knownModules.has(module)) {
      invalid(`unknown permission module: ${module}`)
    }

    const cleanActions: string[] = []
    for (const action of actions as string[]) {
      const a = action.trim()
      if (!a) invalid(`empty action in module "${module}"`)
      if (a === '*') {
        cleanActions.push('*')
        continue
      }
      const capability = `${module}.${a}`
      if (!knownCapabilities.has(capability as any)) {
        invalid(`unknown permission action: ${capability}`)
      }
      cleanActions.push(a)
    }

    out.push({ module, actions: cleanActions })
  }

  return out
}
