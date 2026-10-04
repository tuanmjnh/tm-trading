import type { ExportFormat, ExportJob } from '~~/server/types/export'
import type { HeaderActionChild } from '~/components/base/HeaderActions.vue'

/**
 * Download filename for export job: always prefixed with module
 * (e.g. `configs-...`) and extension matching format (csv/json/xlsx).
 * `options.filename` (if provided) is used as base name.
 */
export function buildExportFilename(job: ExportJob): string {
  const raw = job.options?.filename?.trim() || `${job.module}-export-${job.id.slice(0, 8)}`
  const base = raw.replace(/\.(csv|json|xlsx)$/i, '')
  const prefixed = base.startsWith(`${job.module}-`) ? base : `${job.module}-${base}`
  return `${prefixed}.${job.format}`
}

/** Shared Export CSV / Export JSON submenu for header ellipsis and mobile actions. */
export function buildExportChildren(
  t: (key: string) => string,
  run: (format: ExportFormat) => void
): HeaderActionChild[] {
  return [
    { key: 'export-csv', icon: 'i-lucide-file-spreadsheet', label: t('admin.export.toCsv'), onSelect: () => run('csv') },
    { key: 'export-json', icon: 'i-lucide-file-json', label: t('admin.export.toJson'), onSelect: () => run('json') }
  ]
}

/**
 * Quick per-module export from module pages:
 * starts an inline export job (pending -> processing -> completed)
 * and downloads the file immediately when it completes.
 */
export function useModuleExport() {
  const { t } = useI18n()
  const notify = useNotify()
  const { hubFetch } = useHub()

  const exporting = ref(false)

  async function downloadJob(job: ExportJob): Promise<void> {
    const blob = await hubFetch<Blob>(
      `/api/v1/apps/${encodeURIComponent(job.appId)}/export/jobs/${encodeURIComponent(job.id)}/download`,
      { responseType: 'blob' }
    )
    const filename = buildExportFilename(job)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function exportModule(appId: string, module: string, format: ExportFormat = 'csv'): Promise<void> {
    if (!appId) {
      notify.error(t('admin.export.startFailed'))
      return
    }
    exporting.value = true
    try {
      const res = await hubFetch<{ success: boolean, data: ExportJob }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/modules/${encodeURIComponent(module)}/export`,
        { method: 'POST', body: { options: { format, scope: 'all' } } }
      )
      const job = res.data
      if (job && (job.status === 'completed' || job.status === 'pending')) {
        if (job.status === 'completed') {
          await downloadJob(job)
        }
        notify.success(t('admin.export.started', { records: job.totalRecords }))
      }
      else {
        notify.error(t('admin.export.startFailed'))
      }
    }
    catch (err: unknown) {
      notify.error(getErrorMessage(err, key => t(key)))
    }
    finally {
      exporting.value = false
    }
  }

  return { exporting, exportModule }
}
