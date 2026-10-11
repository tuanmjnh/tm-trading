<script setup lang="ts">
import type { IntelData, IntelZone, IntelFlow, IntelNewsItem } from '~~/types/intel'
import { getErrorMessage } from '~/shared/utils/errors'

// =============================================================================
//  Market Intel — dedicated full-page view of the SAME read-only payload the
//  dashboard summarises (`GET /api/v1/intel`, Phase 8/9/10). Nothing is
//  recalculated here (D1): every cell is formatted from what services stored.
// =============================================================================
const { t } = useI18n()
const notify = useNotify()
const { title, description } = useAdminPageChrome({
  titleKey: 'intel.title',
  descKey: 'intel.desc'
})
const intelApi = useIntel()

const intel = ref<IntelData | null>(null)
const isLoading = ref(false)

async function load() {
  isLoading.value = true
  try {
    intel.value = await intelApi.get()
  } catch (err) {
    intel.value = null
    notify.error(t('intel.title'), getErrorMessage(err, key => t(key)))
  } finally {
    isLoading.value = false
  }
}

/** ISO -> "YYYY-MM-DD HH:mm UTC" (never machine timezone — D2). */
function fmtUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

const fmtPct = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—'
const netColor = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-error' : 'text-muted')
const fmtOi = (usd: number | null) => (usd == null ? '—' : `$${(usd / 1e6).toFixed(1)}M`)
const svcAge = (sec: number) => `${Math.round(sec / 60)}m`
const fmtPrice = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'

const seasonLabel = (s: string) =>
  s === 'alt' ? t('regime.seasonAlt') : s === 'btc' ? t('regime.seasonBtc') : t('regime.seasonNeutral')
const seasonColor = (s: string): 'success' | 'warning' | 'neutral' =>
  s === 'alt' ? 'success' : s === 'btc' ? 'warning' : 'neutral'

const flagLabel = (f: string): string => {
  if (f === 'fear-extreme') return t('regime.flagFear')
  if (f === 'greed-extreme') return t('regime.flagGreed')
  if (f === 'unlock-48h') return t('regime.flagUnlock')
  if (f.startsWith('supply-drift:')) return t('regime.flagSupply', { symbol: f.slice('supply-drift:'.length) })
  return f
}

function fmtPx(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1000) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(4)
}

const topEst = (z: IntelZone, side: 'long' | 'short') => z.est.filter(e => e.side === side).slice(0, 3)

const fmtScore = (v: number) => {
  if (!Number.isFinite(v)) return '—'
  const r = Math.round(v * 100) / 100
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}`
}
const confScoreClass = (v: number) => (v >= 0.15 ? 'text-success' : v <= -0.15 ? 'text-error' : 'text-muted')
const confPartClass = (v: number) =>
  v > 0 ? 'text-success bg-success/10' : v < 0 ? 'text-error bg-error/10' : 'text-dimmed bg-default/50'

const flowDirColor = (d: IntelFlow['dir']): 'success' | 'error' | 'warning' | 'neutral' =>
  d === 'buy' ? 'success' : d === 'sell' ? 'error' : d === 'vol' ? 'warning' : 'neutral'
const newsLevelColor = (l: IntelNewsItem['level']) => (l === 'high' ? 'error' : 'warning')
const newsDirColor = (d: IntelNewsItem['dir']): 'success' | 'error' | 'neutral' =>
  d === 'pos' ? 'success' : d === 'neg' ? 'error' : 'neutral'
const moverFlagColor = (b: boolean) => (b ? 'success' : 'neutral')

const kFmt = (v: number) =>
  !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.round(v).toLocaleString('en-US')

onMounted(load)

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: load }
]))
mobileBar.registerInfo(computed(() => ({
  count: (intel.value?.movers?.length ?? 0) + (intel.value?.funding?.length ?? 0),
  hasMore: false,
  loading: isLoading.value
})))

useHead({ title })
</script>

<template>
  <BasePage id="intel" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="intel?.mongo === 'down'"
          :label="t('intel.mongoDown')"
          color="warning"
          variant="subtle"
          size="xs"
        />
        <UBadge
          v-if="intel?.generatedAt"
          :label="fmtUtc(intel.generatedAt)"
          color="neutral"
          variant="subtle"
          size="xs"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="isLoading"
          @click="load"
        />
      </div>
    </template>

    <div class="flex flex-col w-full gap-4 pb-24 lg:pb-6">
      <!-- Services heartbeat (D9) -->
      <section class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('intel.services') }}</span>
          <UBadge
            v-if="intel && intel.services.filter(s => s.overdue).length"
            :label="`${intel.services.filter(s => s.overdue).length} ${t('intel.overdue')}`"
            color="error"
            variant="subtle"
            size="xs"
          />
        </div>
        <p v-if="!intel?.services?.length" class="text-[11px] text-dimmed">{{ t('intel.noServices') }}</p>
        <div v-else class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="s in intel.services"
            :key="s.name"
            :label="s.overdue ? `${s.name} · ${t('intel.overdue')} ${svcAge(s.overdueSec)}` : `${s.name} · ${svcAge(s.intervalSec)}`"
            :color="s.overdue ? 'error' : 'success'"
            variant="subtle"
            size="xs"
          />
        </div>
      </section>

      <!-- Regime (Phase 9) -->
      <section v-if="intel?.regime" class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('regime.title') }}</span>
            <UBadge :label="seasonLabel(intel.regime.season)" :color="seasonColor(intel.regime.season)" variant="subtle" size="xs" />
          </div>
          <span v-if="intel.regime.ts" class="text-[10px] text-dimmed font-mono">{{ fmtUtc(intel.regime.ts) }}</span>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="rounded-lg bg-elevated/50 p-3">
            <p class="text-[10px] text-muted uppercase tracking-wide">ASI 90d</p>
            <p class="text-lg font-bold font-mono text-highlighted">{{ intel.regime.asi?.d90 ?? '—' }}</p>
            <p class="text-[10px] text-dimmed font-mono">30 {{ intel.regime.asi?.d30 ?? '—' }} · 365 {{ intel.regime.asi?.d365 ?? '—' }}</p>
          </div>
          <div class="rounded-lg bg-elevated/50 p-3">
            <p class="text-[10px] text-muted uppercase tracking-wide">Fear &amp; Greed</p>
            <p
              class="text-lg font-bold font-mono"
              :class="intel.regime.fng ? (intel.regime.fng.value <= 25 ? 'text-error' : intel.regime.fng.value >= 75 ? 'text-success' : 'text-highlighted') : 'text-highlighted'"
            >{{ intel.regime.fng?.value ?? '—' }}</p>
            <p class="text-[10px] text-dimmed truncate">{{ intel.regime.fng?.classification || '—' }}</p>
          </div>
          <div class="rounded-lg bg-elevated/50 p-3">
            <p class="text-[10px] text-muted uppercase tracking-wide">{{ t('regime.btcDom') }}</p>
            <p class="text-lg font-bold font-mono text-highlighted">{{ fmtPct(intel.regime.btcDom, 1) }}</p>
            <p class="text-[10px] text-dimmed font-mono truncate">ETH {{ fmtPct(intel.regime.ethDom, 1) }}</p>
          </div>
          <div class="rounded-lg bg-elevated/50 p-3">
            <p class="text-[10px] text-muted uppercase tracking-wide">{{ t('regime.mcap') }}</p>
            <p class="text-lg font-bold font-mono" :class="netColor(intel.regime.mcapChg24h ?? 0)">{{ fmtPct(intel.regime.mcapChg24h, 2) }}</p>
            <p class="text-[10px] text-dimmed truncate">{{ t('regime.flags') }} · {{ intel.regime.flags.length }}</p>
          </div>
        </div>

        <div v-if="intel.regime.flags.length || intel.regime.unlocks48h.length" class="flex flex-col gap-2">
          <div class="flex flex-wrap gap-1.5">
            <UBadge v-for="f in intel.regime.flags" :key="f" :label="flagLabel(f)" color="warning" variant="subtle" size="xs" />
            <UBadge
              v-for="u in intel.regime.unlocks48h"
              :key="`${u.symbol}-${u.date}`"
              :label="`${u.symbol} · ${u.date}`"
              color="info"
              variant="subtle"
              size="xs"
            />
          </div>
        </div>

        <div v-if="intel.regime.sweep.length" class="rounded-lg bg-elevated/50 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-[10px] uppercase tracking-wider text-muted">
                <th class="text-left px-3 py-2">{{ t('intel.colSymbol') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colRate') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colOi') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colReasons') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colBlockers') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in intel.regime.sweep" :key="s.symbol" class="border-b border-default/50 last:border-0">
                <td class="px-3 py-1.5 text-xs font-semibold text-highlighted">{{ s.symbol }}</td>
                <td class="px-3 py-1.5 text-xs" :class="s.ok ? 'text-success' : 'text-error'">{{ s.ok ? 'OK' : 'NO' }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-muted">{{ s.rate == null ? '—' : `${(s.rate * 100).toFixed(3)}%` }}</td>
                <td class="px-3 py-1.5 text-[11px] text-dimmed">{{ s.reasons.join(' · ') || '—' }}</td>
                <td class="px-3 py-1.5 text-[11px] text-error/80">{{ s.blockers.join(' · ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Movers -->
      <section class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('intel.movers') }}</span>
        <p v-if="!intel?.movers?.length" class="text-[11px] text-dimmed">{{ t('intel.empty') }}</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-[10px] uppercase tracking-wider text-muted">
                <th class="text-left px-3 py-2">{{ t('intel.colSymbol') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colPct24h') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colChg4h') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colVolume') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colPrice') }}</th>
                <th class="text-right px-3 py-2">ATR%</th>
                <th class="text-left px-3 py-2">{{ t('intel.colBreakout') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in intel.movers" :key="m.symbol" class="border-b border-default/50 last:border-0">
                <td class="px-3 py-1.5 text-xs font-semibold text-highlighted">{{ m.symbol }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="netColor(m.pct24h)">{{ fmtPct(m.pct24h) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="netColor(m.chg4h)">{{ fmtPct(m.chg4h) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ kFmt(m.quoteVolume) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-highlighted">{{ fmtPrice(m.lastPrice) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ fmtPct(m.atrPct) }}</td>
                <td class="px-3 py-1.5"><UBadge :label="m.breakout ? t('intel.yes') : t('intel.no')" :color="moverFlagColor(m.breakout)" variant="subtle" size="xs" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Money flow -->
      <section class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('intel.flows') }}</span>
        <p v-if="!intel?.flows?.length" class="text-[11px] text-dimmed">{{ t('intel.empty') }}</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-[10px] uppercase tracking-wider text-muted">
                <th class="text-left px-3 py-2">{{ t('intel.colSymbol') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colDir') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colReasons') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colVolRatio') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colTaker') }}</th>
                <th class="text-right px-3 py-2">CMF</th>
                <th class="text-right px-3 py-2">{{ t('intel.colScore') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in intel.flows" :key="f.symbol" class="border-b border-default/50 last:border-0">
                <td class="px-3 py-1.5 text-xs font-semibold text-highlighted">{{ f.symbol }}</td>
                <td class="px-3 py-1.5"><UBadge :label="t(`intel.dir_${f.dir}`)" :color="flowDirColor(f.dir)" variant="subtle" size="xs" /></td>
                <td class="px-3 py-1.5 text-[11px] text-dimmed truncate max-w-56">{{ f.reasons.join(' · ') || '—' }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ f.volRatio.toFixed(2) }}x</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ fmtPct(f.takerRatio, 1) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="netColor(f.cmf)">{{ f.cmf.toFixed(3) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="confScoreClass(f.score)">{{ fmtScore(f.score) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Accumulation -->
      <section class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('intel.accums') }}</span>
        <p v-if="!intel?.accums?.length" class="text-[11px] text-dimmed">{{ t('intel.empty') }}</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-[10px] uppercase tracking-wider text-muted">
                <th class="text-left px-3 py-2">{{ t('intel.colSymbol') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colReasons') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colRange') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colChg48h') }}</th>
                <th class="text-right px-3 py-2">OBV</th>
                <th class="text-right px-3 py-2">{{ t('intel.colVolRatio') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colPct24h') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in intel.accums" :key="a.symbol" class="border-b border-default/50 last:border-0">
                <td class="px-3 py-1.5 text-xs font-semibold text-highlighted">{{ a.symbol }}</td>
                <td class="px-3 py-1.5 text-[11px] text-dimmed truncate max-w-56">{{ a.reasons.join(' · ') || '—' }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ fmtPct(a.rangePct) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="netColor(a.priceChg48)">{{ fmtPct(a.priceChg48) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ a.obvNorm.toFixed(2) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ a.volRatio.toFixed(2) }}x</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="netColor(a.pct24h)">{{ fmtPct(a.pct24h) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Funding -->
      <section class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('intel.funding') }}</span>
        <p v-if="!intel?.funding?.length" class="text-[11px] text-dimmed">{{ t('intel.empty') }}</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-[10px] uppercase tracking-wider text-muted">
                <th class="text-left px-3 py-2">{{ t('intel.colSymbol') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colRate') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colPrice') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colOi') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colNext') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="fd in intel.funding" :key="fd.symbol" class="border-b border-default/50 last:border-0">
                <td class="px-3 py-1.5 text-xs font-semibold text-highlighted">{{ fd.symbol }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="netColor(fd.rate)">{{ (fd.rate * 100).toFixed(4) }}%</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-highlighted">{{ fmtPrice(fd.price) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right text-muted">{{ fmtOi(fd.oiNotionalUsd) }}</td>
                <td class="px-3 py-1.5 text-[11px] text-dimmed">{{ Number.isFinite(fd.nextFundingTime) && fd.nextFundingTime > 0 ? fmtUtc(new Date(fd.nextFundingTime).toISOString()) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Liquidation zones -->
      <section v-if="intel?.zones?.length" class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-3">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('regime.zones') }}</span>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div v-for="z in intel.zones" :key="z.symbol" class="rounded-lg bg-elevated/50 p-3 flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-highlighted">{{ z.symbol }}</span>
              <span class="text-[11px] font-mono text-muted">mark {{ fmtPx(z.markPx) }}</span>
            </div>
            <div class="flex flex-wrap gap-1.5 text-[10px] text-dimmed">
              <span v-if="z.oiUsd != null" class="font-mono">OI {{ fmtOi(z.oiUsd) }}</span>
              <span v-if="z.lsRatio != null" class="font-mono">L/S {{ z.lsRatio.toFixed(2) }}</span>
              <span class="font-mono">{{ fmtUtc(z.ts) }}</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <p class="text-[10px] uppercase tracking-wide text-error/80">{{ t('regime.zoneLong') }}</p>
                <p v-if="!topEst(z, 'long').length" class="text-[11px] text-dimmed">—</p>
                <p v-for="(e, i) in topEst(z, 'long')" :key="i" class="text-[11px] font-mono text-dimmed">
                  {{ e.lev }}x @ {{ fmtPx(e.price) }} · {{ fmtPct(e.pct) }} · {{ fmtOi(e.usd) }}
                </p>
              </div>
              <div>
                <p class="text-[10px] uppercase tracking-wide text-success/80">{{ t('regime.zoneShort') }}</p>
                <p v-if="!topEst(z, 'short').length" class="text-[11px] text-dimmed">—</p>
                <p v-for="(e, i) in topEst(z, 'short')" :key="i" class="text-[11px] font-mono text-dimmed">
                  {{ e.lev }}x @ {{ fmtPx(e.price) }} · {{ fmtPct(e.pct) }} · {{ fmtOi(e.usd) }}
                </p>
              </div>
            </div>
            <div v-if="z.actual.length" class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="(a, i) in z.actual.slice(0, 4)"
                :key="i"
                :label="`${a.side} · ${fmtPx(a.price)} · ${fmtOi(a.usd)}`"
                :color="a.side === 'long' ? 'error' : 'success'"
                variant="subtle"
                size="xs"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- Confluence (Phase 10) -->
      <section v-if="intel?.confluence?.length" class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('confluence.title') }}</span>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-default text-[10px] uppercase tracking-wider text-muted">
                <th class="text-left px-3 py-2">#</th>
                <th class="text-left px-3 py-2">{{ t('intel.colSymbol') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colScore') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colMethod') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colRegime') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colFunding') }}</th>
                <th class="text-right px-3 py-2">{{ t('intel.colZone') }}</th>
                <th class="text-left px-3 py-2">{{ t('intel.colTs') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in intel.confluence" :key="c.symbol" class="border-b border-default/50 last:border-0">
                <td class="px-3 py-1.5 text-xs text-dimmed">{{ c.rank }}</td>
                <td class="px-3 py-1.5 text-xs font-semibold text-highlighted">
                  {{ c.symbol }}
                  <span class="text-[10px] text-dimmed font-mono ml-1">{{ c.tf }}</span>
                </td>
                <td class="px-3 py-1.5 text-sm font-mono font-bold text-right" :class="confScoreClass(c.score)">{{ fmtScore(c.score) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="confPartClass(c.parts.method)">{{ fmtScore(c.parts.method) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="confPartClass(c.parts.regime)">{{ fmtScore(c.parts.regime) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="confPartClass(c.parts.funding)">{{ fmtScore(c.parts.funding) }}</td>
                <td class="px-3 py-1.5 text-xs font-mono text-right" :class="confPartClass(c.parts.zone)">{{ fmtScore(c.parts.zone) }}</td>
                <td class="px-3 py-1.5 text-[11px] text-dimmed">{{ fmtUtc(c.ts) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- News -->
      <section v-if="intel?.news?.length" class="rounded-lg bg-default ring ring-default p-4 flex flex-col gap-2">
        <span class="text-[10px] text-muted uppercase tracking-wider">{{ t('intel.news') }}</span>
        <ul class="flex flex-col divide-y divide-default/50">
          <li v-for="(n, i) in intel.news" :key="i" class="py-2 flex flex-col gap-1">
            <div class="flex items-start justify-between gap-3">
              <a
                :href="n.link"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs font-medium text-highlighted hover:underline min-w-0"
              >{{ n.title }}</a>
              <div class="flex items-center gap-1.5 shrink-0">
                <UBadge :label="t(`intel.level_${n.level}`)" :color="newsLevelColor(n.level)" variant="subtle" size="xs" />
                <UBadge :label="t(`intel.dir_${n.dir}`)" :color="newsDirColor(n.dir)" variant="subtle" size="xs" />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[10px] text-dimmed">
              <span class="uppercase tracking-wide">{{ n.source }}</span>
              <span class="font-mono">{{ fmtUtc(n.ts) }}</span>
              <span v-if="n.tags.length" class="truncate">{{ n.tags.join(' · ') }}</span>
            </div>
            <p v-if="n.excerpt" class="text-[11px] text-muted line-clamp-2">{{ n.excerpt }}</p>
          </li>
        </ul>
      </section>

      <!-- Empty state: services not run yet -->
      <AdminEmptyState
        v-if="!intel || (!intel.movers.length && !intel.regime && !intel.news.length && !intel.confluence.length)"
        :title="t('intel.empty')"
        :description="t('intel.emptyHint')"
        icon="i-lucide-gauge"
      />
    </div>
  </BasePage>
</template>
