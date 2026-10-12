# TM Trading — UI Design System (Obsidian Apex)

Status: **canonical** — the single source of truth for the dashboard's visual tokens.

Visual authority for `app/` (the Nuxt 4 dashboard). Functional authority stays with the
roadmap (`docs/tm-trading-roadmap-v3.3.md` §57/§58); this document only defines how the
already-built screens *look*, never what they *do*.

Source: the Stitch template `private/stitch_tm_trading_ui_template/` ("Obsidian Apex").
The template shipped three partly-conflicting palettes (Design.md frontmatter M3 tokens,
Design.md prose layers, and the per-screen Tailwind config). They are **reconciled here**
into one token set:

- Foundation/surfaces take the Design.md prose "Obsidian" layer ramp.
- Brand accent is the electric blue `#2b7fff` from the prose + screens.
- Financial signals use **green / red** (per the screen mockups), not the prose's
  blue / rose: positive & long = green, negative & short = red.
- Radius is 4px (`0.25rem`), fonts are Inter (UI) + JetBrains Mono (data).

`private/` is git-ignored, so this file is the only committed copy of the decisions.

## Foundation layers (surfaces)

Tonal layering with 1px borders; **no drop shadows** on surfaces.

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#080c14` | viewport root / inactive gutter |
| `panel` | `#0b111e` | dock container, table header, rail background |
| `elevated` | `#0e1726` | dock header, toolbars, widget frames |
| `card` | `#131d31` | active module, order forms, depth containers |
| `popover` | `#17233a` | dropdowns, modals, floating inspectors |
| `hover` | `#223452` | interactive row hover, secondary hover |
| `border` | `#1e2d4a` | structural 1px separators |
| `border-subtle` | `#152238` | internal row rules / cell splits |
| `focus` | `#38bdf8` | input / pane active outline |

Overlay shadows (floating menus only):
`0 8px 24px -4px rgba(0,0,0,.6), 0 2px 6px -1px rgba(0,0,0,.4)`.

## Text

| Token | Hex | Role |
|---|---|---|
| `text-primary` | `#f1f5f9` | values, active labels, headings |
| `text-secondary` | `#94a3b8` | labels, column headers, inactive |
| `text-dim` | `#64748b` | timestamps, axis legends, disabled |
| `text-highlighted` | `#f8fafc` | strongest emphasis |

## Brand & signals

| Token | Hex | Semantic key | Role |
|---|---|---|---|
| `brand` | `#2b7fff` | `primary` | CTAs, active nav, links, focus chrome |
| `brand-hover` | `#1d64e0` | — | long/buy button hover, active press |
| `telemetry` | `#38bdf8` | `secondary` / `info` | crosshair, selected tabs, live pips |
| `positive` | `#10b981` | `success` | positive PnL, bids, long/buy fills |
| `negative` | `#ef4444` | `error` | negative PnL, asks, short/sell fills |
| `warning` | `#f59e0b` | `warning` | leverage / slippage / maintenance |
| `algo` | `#8b5cf6` | — | ML signals, research/algo chips |

Muted signal fills for depth bars: `rgba(43,127,255,.12)` (bid) /
`rgba(239,68,68,.12)` (ask).

## Typography

Dual-engine protocol. Loaded automatically by `@nuxt/fonts` (bundled with `@nuxt/ui`).

- **Inter** — `--font-sans`: navigation, controls, dialog titles, forms, narrative.
- **JetBrains Mono** — `--font-mono`: every tabular number, price, size, log line,
  timestamp, address, leverage multiplier. Tabular lining on, so values never jitter.

| Style | Font | Size / Line | Weight | Tracking |
|---|---|---|---|---|
| headline-xl | Inter | 2rem / 2.5rem | 600 | -0.025em |
| headline-lg | Inter | 1.5rem / 2rem | 600 | -0.02em |
| headline-md | Inter | 1.125rem / 1.5rem | 600 | -0.015em |
| headline-sm | Inter | 0.875rem / 1.25rem | 600 | -0.01em |
| body-lg | Inter | 0.875rem / 1.375rem | 400 | — |
| body-md | Inter | 0.8125rem / 1.25rem | 400 | — |
| body-sm | Inter | 0.75rem / 1.125rem | 400 | — |
| label-data-lg | JetBrains Mono | 0.875rem / 1.25rem | 500 | -0.02em |
| label-data-md | JetBrains Mono | 0.75rem / 1rem | 500 | -0.01em |
| label-data-sm | JetBrains Mono | 0.6875rem / 0.875rem | 400 | — |
| label-micro | JetBrains Mono | 0.625rem / 0.75rem | 500 | 0.02em (uppercase) |

## Radius & spacing

- Radius: base controls `0.25rem`; chips/pills `0.125rem`–`0.25rem`; modals `0.375rem`.
  Full/rounded shapes are **forbidden** for primary controls (width conservation).
- Grid: 4px / 8px micro-grid. High-density rows: `2px` vertical, `4px` horizontal padding.
- Dock panes snap with 1px dividers, not empty gutters.

## Component recipes

- **Execution buttons** (Buy/Long & Sell/Short): height `36px` (`28px` in micro tables),
  Inter 600, white text. Long = `positive` fill, hover `#059669`. Short = `negative`
  fill, hover `#dc2626`. Active press `scale(0.98)`.
- **Secondary control**: `popover` background, `1px solid border`, `text-primary`;
  hover `hover`.
- **Ghost/tool button**: transparent, `text-secondary`; hover `text-primary` +
  `rgba(30,45,74,.4)`.
- **Algo chip**: bg `rgba(99,102,241,.12)`, border `rgba(139,92,246,.3)`, text `algo`,
  mono 11px.
- **Live pip**: 4px dot `brand` with `box-shadow: 0 0 6px #2b7fff` + uppercase `label-micro`.
- **Left dock rail**: expanded 240px / collapsed 56px, `150ms cubic-bezier(.4,0,.2,1)`.
  Background `panel`, right border `border`. Active item: bg `card`, left border
  `2px solid brand`, `text-primary`. Inactive: `text-secondary`, hover bg `card`.
- **Numeric input**: bg `elevated`, border `border`, `text-primary`, mono. Focus border
  `focus` (1px, no halo). Suffix unit label `text-dim`, mono.
- **Table header**: bg `panel`, `text-dim`, uppercase, Inter 600, 11px,
  border-bottom `border`. Row zebra `transparent` / `rgba(14,23,38,.5)`; hover `popover`.
- **Depth bar**: bids right-to-left `rgba(43,127,255,.08)`; asks `rgba(239,68,68,.08)`.

## Token → Nuxt UI v4 mapping

Implementation lives in `app/assets/css/main.css` + `app/app.config.ts`.

**Dark-first**: the app defaults to dark mode (`colorMode.preference = 'dark'` in
`nuxt.config.ts`) to match the Obsidian workspace; the overt obsidian token overrides live
under `.dark`. Light mode keeps Nuxt UI defaults and is not a design target yet.


| Design token | Nuxt UI v4 |
|---|---|
| brand | `ui.colors.primary = 'brand'` (custom scale in `@theme`) |
| telemetry | `secondary` / `info` = `'sky'` |
| positive | `success` = `'emerald'` |
| negative | `error` = `'red'` |
| warning | `warning` = `'amber'` |
| neutral surfaces | `ui.colors.neutral = 'slate'` + `.dark` overrides below |
| canvas | `.dark { --ui-bg }` |
| panel (table header / rail) | `.dark { --ui-bg-muted }` |
| card / elevated window | `.dark { --ui-bg-elevated }` |
| popover / hover surface | `.dark { --ui-bg-accented }` |
| border / border-subtle | `.dark { --ui-border }` / `--ui-border-muted` |
| hover border | `.dark { --ui-border-accented }` |
| text-primary / secondary / dim | `.dark { --ui-text }` / `--ui-text-muted` / `--ui-text-dimmed` |
| radius | `:root { --ui-radius: 0.25rem }` |
| Inter | `@theme { --font-sans }` |
| JetBrains Mono | `@theme { --font-mono }` |

Always use semantic utility classes (`text-muted`, `bg-elevated`, `border-default`,
`font-mono`, …) — never raw Tailwind palette colours.

## Screen ↔ route map (29 mockups)

| Template | Route |
|---|---|
| overview | `/` |
| trading_terminal | `/trading` |
| signals_engine | `/trading/signals` |
| paper_account | `/trading/paper` |
| positions_blotter | `/trading/positions` |
| market_intelligence | `/markets` |
| market_explorer | `/markets/explorer` |
| scanner | `/markets/scanner` |
| economic_calendar_news | `/markets/calendar` |
| market_data_sources | `/data-research/data` |
| market_recordings | `/data-research/data/recordings` |
| datasets_catalog | `/data-research/data/datasets` |
| data_quality | `/data-research/data/quality` |
| test_data_lineage | `/data-research/data/lineage` |
| ai_research | `/data-research/research` |
| experiments | `/data-research/research/experiments` |
| new_experiment | `/data-research/research/experiments` (create flow) |
| trade_journal | `/data-research/journal` |
| indicator_library | `/strategy-lab/indicators` |
| methods_confluence | `/strategy-lab/methods` |
| strategy_library | `/strategy-lab` |
| bot_profiles | `/strategy-lab/bots` |
| bot_instances | `/strategy-lab/bots/instances` |
| backtest_runs | `/test-center/runs` |
| runs_comparison | `/test-center/runs/compare` |
| live_forward_tests | `/test-center/forward` |
| replay_training | `/test-center/replay` |
| alert_rules | `/alerts` |
| health_and_telemetry | `/admin-system/logs` |

Every mockup maps to an existing, functional page — the gap is **visual only**. Routes
are re-homed from the roadmap's aspirational §58.2 paths (`/trade`, `/scanner`, …) and are
locked by `tests/nav-contracts.test.ts`; do not change them for the sake of a mockup.

## Pilot scope

Phase 1 stays limited to the Trading cluster for review: `/`, `/trading*`, `/markets*`.
The remaining screens adopt the same tokens afterwards. Presentation-only changes — pages
keep consuming the existing `/api/v1/*` endpoints.
