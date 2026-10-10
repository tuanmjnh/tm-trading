/**
 * PROCESS-GUARD — resilience against stray promise rejections crashing the server.
 *
 * Background: the dev harness (`nuxt dev`) is run with `--no-fork` — in non-forked
 * mode @nuxt/cli registers NO `process.once('unhandledRejection', restart)`, so a
 * WebSocket client disconnecting abruptly (tab close / hard reload → residual
 * `read ECONNRESET` inside the server's stream machinery) never restarts the dev
 * server (~8s ERR_CONNECTION_REFUSED for everyone). See server/utils/market-*.ts.
 *
 * This plugin still owns a logging guard for BOTH dev and prod:
 *   - socket-teardown rejections (ECONNRESET/EPIPE/...): warn + keep serving.
 *   - genuine rejections                          : log loudly; in a forked worker
 *     (process.send present) forward `dev:rejection` so Nuxt can act on real bugs.
 *   - uncaughtException                           : log; crash-on-error in prod only.
 * Installed once per process (survives Nitro dev reloads via a global symbol).
 */
const kInstalled = Symbol.for('tm-trading:process-guard:installed')

/** Network teardown artifacts that must never be fatal to the server. */
export function isSocketTeardown(reason: unknown): boolean {
  const msg = reason instanceof Error ? reason.message : String(reason ?? '')
  return /ECONNRESET|EPIPE|ECONNABORTED|ECONNREFUSED|ETIMEDOUT|socket hang up|aborted/i.test(msg)
}

export default defineNitroPlugin(() => {
  const proc = process as unknown as { [kInstalled]?: boolean }
  if (proc[kInstalled]) return
  proc[kInstalled] = true

  const isDev = import.meta.dev
  const tag = `[process-guard${isDev ? ':dev' : ':prod'}]`

  console.log(`${tag} installed (pid=${process.pid}, dev=${isDev})`)

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason ?? '')
    if (isSocketTeardown(reason)) {
      console.warn(`${tag} ignored socket-teardown rejection: ${msg}`)
      return
    }
    console.error(`${tag} unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`)
    if (typeof process.send === 'function') {
      try { process.send({ type: 'nuxt:internal:dev:rejection', message: msg }) } catch { /* parent gone */ }
    }
  })

  process.on('uncaughtException', (err) => {
    console.error(`${tag} uncaughtException${isDev ? ' — kept server alive' : ''}: ${err instanceof Error ? err.stack : String(err)}`)
    if (!isDev) process.exit(1)
  })
})