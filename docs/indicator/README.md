# Indicator & Pine Script Documentation Index

This directory organizes all documentation, methodologies, prompts, and verification checklists relating to the indicator systems in the TM Trading platform.

---

## Directory Structure

```
docs/indicator/
├── tm-indicator/       # Multi-Asset Futures Analysis & Alert System (Phase 0–8)
├── vsa-wyckoff/        # Volume Spread Analysis & Wyckoff Method (Method 0)
├── liquidity/          # Liquidity Sweeps, Ranges & Price Action Geometry
├── xau/                # Historical XAU Signals Indicator prompts & blueprints
└── README.md           # This index file
```

---

## 1. TM Indicator (`docs/indicator/tm-indicator/`)

The primary multi-asset analysis system supporting Futures contracts (XAU, BTC, ETH, Altcoins):

- [tm-indicator-guide.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/tm-indicator-guide.md): Complete user and integration manual (Setup, Profiles, Dashboard, Alerts).
- [TM_Indicator_Roadmap.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/TM_Indicator_Roadmap.md): Master development roadmap covering Phases 0 through 8.
- [architecture_indicator.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/architecture_indicator.md): Structural technical architecture across all 13 logic layers.
- [audit-baseline.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/audit-baseline.md): Deep static audit of the original baseline code and P0 issue analyses.
- [futures-risk-model.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/futures-risk-model.md): Linear USDT-margined futures risk, leverage cap, margin & liquidation formulas.
- [asset-profiles.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/asset-profiles.md): Profiles for XAU, BTC, ETH, Altcoins, and Crypto 24/7 session neutrality.
- [regression-checklist.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/regression-checklist.md): 10-category verification matrix tracking all regression test gates.
- [ablation-walkforward-protocol.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/ablation-walkforward-protocol.md): Feature ablation matrix (Configurations A–E) and walk-forward verification rules.
- [known-limitations.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/known-limitations.md): Technical boundaries, non-simulated dimensions, and platform constraints.
- [prompt.md](file:///d:/Applications/tm-trading/docs/indicator/tm-indicator/prompt.md): Prompt specifications for TM Indicator development.

---

## 2. VSA & Wyckoff Method (`docs/indicator/vsa-wyckoff/`)

Documentation and quantitative specs for Volume Spread Analysis (Method 0):

- [vsa-wyckoff-method.md](file:///d:/Applications/tm-trading/docs/indicator/vsa-wyckoff/vsa-wyckoff-method.md): VSA indicator logic, background bars, volume anomalies, and test bars.
- [vsa-optimization.md](file:///d:/Applications/tm-trading/docs/indicator/vsa-wyckoff/vsa-optimization.md): Historical study on VSA parameters and empirical baseline comparisons.

---

## 3. Liquidity & Sweeps (`docs/indicator/liquidity/`)

Methodology for identifying institutional order flow, stops, and price traps:

- [liquidity-sweep.md](file:///d:/Applications/tm-trading/docs/indicator/liquidity/liquidity-sweep.md): Structural liquidity sweep rules, rejection wicks, and confirmation.
- [Liquidity Swings [LuxAlgo].pine](file:///d:/Applications/tm-trading/docs/indicator/liquidity/Liquidity%20Swings%20%5BLuxAlgo%5D.pine): Reference Pine Script source for liquidity swing calculations.

---

## 4. XAU Legacy Indicators (`docs/indicator/xau/`)

Historical blueprints and prompt sequences from the earlier gold-specialized indicators:

- Prompts: `Prompt — Phase 1.md`, `Prompt — Phase 2.md`, `Prompt AI Router.md`.
- Master prompts: `master-prompt.md`, `master-prompt v2.md`.
- Plans & steps: `pland.md`, `roadmap.md`, `rules.md`, `step.md`.
