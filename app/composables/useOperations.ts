import type {
  OperationsView,
  OperationsViewResponse,
  ServiceCommandAccepted,
  ServiceCommandResponse,
  ServiceOperationResponse,
} from '#shared/types/operations'

// =============================================================================
//  Operations control plane API (V4.2 §17.7–§17.9).
//
//  Read model + command endpoints. A command returns `202 Accepted` with an
//  `operationId`; the caller polls `operation()` until the state is terminal.
//  The UI must never treat acceptance as completion (hard rule 1).
// =============================================================================

export const useOperations = () => {
  /** The full Operations view: registry + supervisor snapshot + pending commands. */
  async function view(): Promise<OperationsView> {
    const res = await $fetch<OperationsViewResponse>('/api/v1/operations/services')
    if (!res.data) throw new Error('operations.loadFailed')
    return res.data
  }

  /** One operation, from the supervisor record or the inbox (not yet consumed). */
  async function operation(operationId: string) {
    const res = await $fetch<ServiceOperationResponse>(
      `/api/v1/operations/operations/${encodeURIComponent(operationId)}`,
    )
    if (!res.data) throw new Error('operations.operationMissing')
    return res.data
  }

  /** Enqueue a control command. Returns the acceptance envelope, not a result. */
  async function command(
    serviceId: string,
    action: string,
    body: { idempotencyKey?: string, scopeKey?: string, reason?: string } = {},
  ): Promise<ServiceCommandAccepted> {
    const res = await $fetch<ServiceCommandResponse>(
      `/api/v1/operations/services/${encodeURIComponent(serviceId)}/${encodeURIComponent(action)}`,
      { method: 'POST', body },
    )
    if (!res.data) throw new Error('operations.commandRejected')
    return res.data
  }

  return { view, operation, command }
}
