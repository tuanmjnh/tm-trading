# TM Trading Documentation Directory

This directory contains the technical documentation, architectural specifications, indicator methodologies, and web application designs for the TM Trading ecosystem.

> **Current product/UI authority: V5.0** — read [tm-trading-central-dashboard-v5.0.md](web-app/tm-trading-central-dashboard-v5.0.md) first for the single-dashboard product scope, Modal/Slideover rules, Control Center, deployment boundaries and cleanup plan. V4.2 remains a technical reference for service reliability/readiness and its audits; V3.x documents are historical unless explicitly retained as technical references.


---

## Directory Organization

```
docs/
├── user-guide/     # Task-oriented guide for people who USE the app
├── indicator/      # Pine Script indicators, trading signals, risk models & roadmaps
│   ├── tm-indicator/   # TM Indicator multi-asset futures system (Phase 0–8)
│   ├── vsa-wyckoff/    # Volume Spread Analysis & Wyckoff method
│   ├── liquidity/      # Liquidity sweeps & LuxAlgo reference
│   ├── xau/            # Historical XAU signals indicator blueprints
│   └── README.md       # Indicator index
├── web-app/        # Nuxt 4 dashboard, UI design system, architecture & app roadmaps
└── engine/         # Core quantitative signal engine, data models, time rules
```

---

## 0. Start Here

**Using the application?** Read the user guide, not the roadmaps.

- [docs/user-guide/README.md](file:///d:/Applications/tm-trading/docs/user-guide/README.md): What TM Trading is, who the guide is for, and the capability-status legend.
- [docs/user-guide/getting-started.md](file:///d:/Applications/tm-trading/docs/user-guide/getting-started.md): Prerequisites, environment, first login, first-run checklist.
- [docs/user-guide/workspaces.md](file:///d:/Applications/tm-trading/docs/user-guide/workspaces.md): Every workspace, in sidebar order, with an honest status per page.
- [docs/user-guide/operations.md](file:///d:/Applications/tm-trading/docs/user-guide/operations.md): Running services, reading the heartbeat, restarting safely, seeding rules.
- [docs/user-guide/troubleshooting.md](file:///d:/Applications/tm-trading/docs/user-guide/troubleshooting.md): Symptom → cause → fix, including login, empty tables, Telegram and bots.
- [docs/user-guide/runbooks.md](file:///d:/Applications/tm-trading/docs/user-guide/runbooks.md): Recovery runbooks for every failure mode (crash, stale feed, lease, backlog, storage, restart).
- [docs/web-app/v4.2-drills.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-drills.md): The reliability drill harness (`npm run drills`) — what each drill proves and what still needs operator evidence.

**Changing the application?** Start with the V5.0 product/UI authority, then consult the V4.2 technical reliability and audit set.

- [docs/web-app/tm-trading-roadmap-v4.2.md](file:///d:/Applications/tm-trading/docs/web-app/tm-trading-roadmap-v4.2.md): **Technical reference** — retain §17 service lifecycle, reliability, readiness, authorization and operations rules; V5.0 governs product scope and primary UI.
- [docs/web-app/v4.2-delivery-plan.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-delivery-plan.md): The 10-stage delivery plan (S0–S9) and decisions A1–A7.
- [docs/web-app/v4-product-scope-audit.md](file:///d:/Applications/tm-trading/docs/web-app/v4-product-scope-audit.md): S0 — page inventory and capability audit.
- [docs/web-app/v4-route-migration-map.md](file:///d:/Applications/tm-trading/docs/web-app/v4-route-migration-map.md): S0 — all 72 seeded routes mapped to the V4 IA.
- [docs/web-app/v4.2-service-inventory.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-service-inventory.md): S0 — processes, 18 services, ownership, target grouping.
- [docs/web-app/v4.2-operations-control-audit.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-operations-control-audit.md): S0 — control paths, `run-once` anti-pattern, security findings.

---

## 1. Indicator & TradingView Signals (`docs/indicator/`)

- [docs/indicator/README.md](file:///d:/Applications/tm-trading/docs/indicator/README.md): Master Indicator documentation index.
- **TM Indicator Suite** (`docs/indicator/tm-indicator/`):
  - [tm-indicator-guide.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/tm-indicator-guide.md): User guide, installation, asset profiles, and dashboard reference.
  - [TM_Indicator_Roadmap.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/TM_Indicator_Roadmap.md): Master development roadmap covering Phases 0 through 8.
  - [audit-baseline.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/audit-baseline.md): Deep audit of the baseline indicator code and P0 issue analyses.
  - [futures-risk-model.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/futures-risk-model.md): Linear USDT-margined futures risk, leverage cap, margin & liquidation formulas.
  - [asset-profiles.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/asset-profiles.md): Profiles for XAU, BTC, ETH, Altcoins, and Crypto 24/7 session neutrality.
  - [regression-checklist.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/regression-checklist.md): Full regression test checklist and verification matrices.
  - [ablation-walkforward-protocol.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/ablation-walkforward-protocol.md): Ablation test configurations (A to E) and walk-forward verification.
  - [known-limitations.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/known-limitations.md): Technical boundaries, execution limitations, and platform constraints.
  - [architecture_indicator.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/architecture_indicator.md): Structural architecture of Pine indicators.
- **VSA & Wyckoff Suite** (`docs/indicator/vsa-wyckoff/`):
  - [vsa-wyckoff-method.md](file:///d:/Applications/tm-trading/docs/indicator/vsa-wyckoff/vsa-wyckoff-method.md): VSA Wyckoff method specification and rules.
  - [vsa-optimization.md](file:///d:/Applications/tm-trading/docs/indicator/vsa-wyckoff/vsa-optimization.md): VSA parameter studies and optimization notes.
- **Liquidity & Sweeps** (`docs/indicator/liquidity/`):
  - [liquidity-sweep.md](file:///d:/Applications/tm-trading/docs/indicator/liquidity/liquidity-sweep.md): Liquidity sweep detection methodology.
  - [Liquidity Swings [LuxAlgo].pine](file:///d:/Applications/tm-trading/docs/indicator/liquidity/Liquidity%20Swings%20%5BLuxAlgo%5D.pine): Reference Pine Script source.
- **XAU Legacy Indicators** (`docs/indicator/xau/`): Historical blueprints and prompts.

---

## 2. Web Application & Dashboard (`docs/web-app/`)

- [docs/web-app/tm-trading-roadmap-v4.2.md](file:///d:/Applications/tm-trading/docs/web-app/tm-trading-roadmap-v4.2.md): **Current authority** — supersedes the V3.x product scope and primary navigation where it explicitly says so.
- [docs/web-app/v4.2-delivery-plan.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-delivery-plan.md): Delivery plan for the V4.2 restructure.
- [docs/web-app/v4-product-scope-audit.md](file:///d:/Applications/tm-trading/docs/web-app/v4-product-scope-audit.md): Page-by-page capability audit.
- [docs/web-app/v4-route-migration-map.md](file:///d:/Applications/tm-trading/docs/web-app/v4-route-migration-map.md): Route registry → V4 IA mapping.
- [docs/web-app/v4.2-service-inventory.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-service-inventory.md): Service and process inventory.
- [docs/web-app/v4.2-operations-control-audit.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-operations-control-audit.md): Operations control-plane audit.
- [docs/web-app/v4.2-drills.md](file:///d:/Applications/tm-trading/docs/web-app/v4.2-drills.md): Reliability drills — the seven lifecycle scenarios the supervisor must survive, and how to run them.
- [docs/web-app/app-inheritance.md](file:///d:/Applications/tm-trading/docs/web-app/app-inheritance.md): Hub-client architecture, satellite modules, and IAM integration.
- [docs/web-app/ui-design-system.md](file:///d:/Applications/tm-trading/docs/web-app/ui-design-system.md): UI styling, component tokens, dark theme, and typography guidelines.
- [docs/web-app/navigation-audit.md](file:///d:/Applications/tm-trading/docs/web-app/navigation-audit.md): Menu routes, authorization mapping, and navigation hierarchy.
- [docs/web-app/tm-trading-roadmap-v3.9.md](file:///d:/Applications/tm-trading/docs/web-app/tm-trading-roadmap-v3.9.md): **Superseded by V4.2** for product scope and navigation; still the reference for §59 AI agents/bots, §60 news/events/macro and §64 multi-exchange demo adapters.
- [docs/web-app/ai-agent-session-audit.md](file:///d:/Applications/tm-trading/docs/web-app/ai-agent-session-audit.md): §59.17 required first deliverable — existing AI agent/session models, APIs and route ownership.
- [docs/web-app/news-macro-status.md](file:///d:/Applications/tm-trading/docs/web-app/news-macro-status.md): §60 status record — slice status, closed gaps and their tests, remaining coverage/translation gaps.
- [docs/web-app/roadmap-v3.5-gap-audit.md](file:///d:/Applications/tm-trading/docs/web-app/roadmap-v3.5-gap-audit.md): The gap audit that produced the §59/§60 work list, with a closure log at the top — read §0 before acting on a gap.
- [docs/web-app/oi-filter-hidden-gem.md](file:///d:/Applications/tm-trading/docs/web-app/oi-filter-hidden-gem.md): Open Interest screener spec — CoinGlass filter vocabulary from the source video, the three profiles (COIL/SQUEEZE/DISTRIBUTION), the 0–100 scoring model, the scan pipeline and the JSON contract the AI agent must answer from.
- Superseded roadmaps (**V1 – V3.4**) are archived for history only — do not implement from them: `docs/web-app/archive/`.

---

## 3. Core Engine & Platform Services (`docs/engine/`)

- [docs/engine/data-model.md](file:///d:/Applications/tm-trading/docs/engine/data-model.md): Unified data schema for MongoDB, Mongoose, and memory bus.
- [docs/engine/time-rules.md](file:///d:/Applications/tm-trading/docs/engine/time-rules.md): UTC calendar days, trading sessions, and clock invariants.
- [docs/engine/alert-schema.md](file:///d:/Applications/tm-trading/docs/engine/alert-schema.md): Webhook alert payload specifications and signal deduplication.
- [docs/engine/method-league.md](file:///d:/Applications/tm-trading/docs/engine/method-league.md): Method league table scoring and ranking framework.
