#!/usr/bin/env node
// =============================================================================
//  TM TRADING — DRILL CONTROL PLANE STAND-IN
//
//  A separate, short-lived process that enqueues one command through the same
//  inbox the Operations API uses. The drill uses it to prove that restarting the
//  control plane does not disturb a running worker.
//
//  usage: node tools/drills/fixtures/enqueue-command.mjs <dir> <operationId> <serviceId> [action]
// =============================================================================

import { enqueueCommand, normaliseCommand } from '../../../services/commandInbox.mjs'

const [dir, operationId, serviceId, action = 'run-once'] = process.argv.slice(2)

if (!dir || !operationId || !serviceId) {
  console.error('usage: node tools/drills/fixtures/enqueue-command.mjs <dir> <operationId> <serviceId> [action]')
  process.exit(2)
}

const command = normaliseCommand({
  operationId,
  serviceId,
  action,
  actor: 'drill-api',
  idempotencyKey: `drill-api:${operationId}`,
})

enqueueCommand(command, { dir })
console.log(operationId)