/**
 * Type declarations for `engine/methods/index.mjs` when imported from
 * TypeScript (app components). TS resolves `index.d.mts` for the
 * `./index.mjs` specifier. Keep in sync with index.mjs exports.
 */

export interface MethodMeta {
  id: string
  name: string
  defaults: Record<string, unknown>
  analyze?: (...args: unknown[]) => unknown
  [key: string]: unknown
}

export declare const INTERFACE_VERSION: number
export declare const METHOD_CONTRACT: Readonly<{
  version: number
  required: string[]
  optional: string[]
}>

export declare function validateMethod(m: unknown): { ok: boolean, errors: string[] }
export declare function registerMethod(m: MethodMeta): MethodMeta
export declare function getMethod(id: string): MethodMeta
/** Registered method ids, sorted. Empty until `all.mjs` (or a plugin) runs. */
export declare function listMethods(): string[]
export declare function _resetRegistryForTest(): void
