# TM Trading Documentation Directory

This directory contains the technical documentation, architectural specifications, indicator methodologies, and web application designs for the TM Trading ecosystem.

---

## Directory Organization

```
docs/
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

- [docs/web-app/app-inheritance.md](file:///d:/Applications/tm-trading/docs/web-app/app-inheritance.md): Hub-client architecture, satellite modules, and IAM integration.
- [docs/web-app/ui-design-system.md](file:///d:/Applications/tm-trading/docs/web-app/ui-design-system.md): UI styling, component tokens, dark theme, and typography guidelines.
- [docs/web-app/navigation-audit.md](file:///d:/Applications/tm-trading/docs/web-app/navigation-audit.md): Menu routes, authorization mapping, and navigation hierarchy.
- [docs/web-app/tm-trading-roadmap-v3.9.md](file:///d:/Applications/tm-trading/docs/web-app/tm-trading-roadmap-v3.9.md): **Web App Roadmap V3.9 — the single authority** (§59 AI agents/bots, §60 news/events/macro, §64 multi-exchange demo adapters and crypto-only execution scope).
- [docs/web-app/ai-agent-session-audit.md](file:///d:/Applications/tm-trading/docs/web-app/ai-agent-session-audit.md): §59.17 required first deliverable — existing AI agent/session models, APIs and route ownership.
- [docs/web-app/news-macro-status.md](file:///d:/Applications/tm-trading/docs/web-app/news-macro-status.md): §60 status record — slice status, closed gaps and their tests, remaining coverage/translation gaps.
- [docs/web-app/roadmap-v3.5-gap-audit.md](file:///d:/Applications/tm-trading/docs/web-app/roadmap-v3.5-gap-audit.md): The gap audit that produced the §59/§60 work list, with a closure log at the top — read §0 before acting on a gap.
- Superseded roadmaps (**V1 – V3.4**) are archived for history only — do not implement from them: `docs/web-app/archive/`.

---

## 3. Core Engine & Platform Services (`docs/engine/`)

- [docs/engine/data-model.md](file:///d:/Applications/tm-trading/docs/engine/data-model.md): Unified data schema for MongoDB, Mongoose, and memory bus.
- [docs/engine/time-rules.md](file:///d:/Applications/tm-trading/docs/engine/time-rules.md): UTC calendar days, trading sessions, and clock invariants.
- [docs/engine/alert-schema.md](file:///d:/Applications/tm-trading/docs/engine/alert-schema.md): Webhook alert payload specifications and signal deduplication.
- [docs/engine/method-league.md](file:///d:/Applications/tm-trading/docs/engine/method-league.md): Method league table scoring and ranking framework.
