# News Taxonomy v1 — V3.5 §60 Slice A

> Versioned, extensible classification for normalized news items/events.
> Source of truth for Slice B (`marketGroup`, tags, event types). Frontend must
> not embed classification logic — it consumes these values only.
> Authority: `docs/web-app/tm-trading-roadmap-v3.5.md` §60.3.

## Version: 1 (2026-10-16)

Changelog: initial adoption from §60.3; maps current `NEWS_RULES` keyword tags
forward (see §4). Future versions append rows, never rename in place.

## 1. Primary market groups

An item has exactly one primary `marketGroup`; everything else is tags.
For a multi-group source the primary group is chosen per item: the group its
strongest group-specific tag maps to, restricted to the groups the source
declares (else the source's first group) — see `marketGroupFor` in
`engine/newsIngest.mjs`. Single-group sources are unaffected.

| ID | Label | Covers |
|---|---|---|
| `crypto` | Crypto & Digital Assets | Protocol/network updates, tokenomics/governance, exchange announcements, listings/delistings, stablecoin disclosures, custody/security incidents, institutional products/flows, ETF disclosures, mining/validator economics, material on-chain events |
| `equities_global` | Global Equities | US/EU/JP/CN-HK/KR/TW/IN/ASEAN index news, filings, earnings, guidance, buybacks/dividends, M&A, capital raises, sector developments, exchange/regulatory notices |
| `equities_vn` | Vietnam Equities & Capital Markets | HOSE/HNX/UPCoM, listed issuers, official disclosures, corporate actions, earnings, bond-market notices, market structure, regulatory changes, statistics |
| `macro_cb` | Macro & Central Banks | Rate decisions, CB speeches/minutes, CPI/PCE/inflation, labor, GDP, PMI, retail sales, trade data, fiscal policy, liquidity, sovereign yields, official macro revisions |
| `fx_gold_commod` | FX, Gold, Rates & Commodities | USD + majors, gold/XAU, oil, metals, agriculture, yields, real rates, dollar liquidity, supply/demand shocks |
| `reg_geo_risk` | Regulation, Geopolitics & Systemic Risk | Laws/enforcement, sanctions, elections/policy, trade restrictions, conflicts, shipping/logistics, cyber/operational incidents, cross-market risks |
| `company_sector` | Company, Sector & Industry | Issuer/sector events cross-linked to equity markets, supply chains, tech/banks/energy/consumer/healthcare |

## 2. Cross-cutting dimensions (zero or more each)

`geography`, `exchange`, `assetClass`, `symbol`, `issuerId`, `sector`,
`eventType`, `policyArea`, `language`, `sourceTier`, `severity`, `novelty`,
`reliability`, `potentialImpactWindow`, `macroSeries`, `topicTags`.
Store normalized IDs separately from original source strings.

## 3. Event types (closed list v1 — extend by appending)

`official_disclosure`, `earnings`, `guidance`, `corporate_action`,
`listing_delisting`, `protocol_upgrade`, `security_incident`,
`regulatory_action`, `central_bank_decision`, `macro_release`,
`macro_revision`, `geopolitical_event`, `commodity_supply_shock`,
`market_structure_change`, `fund_flow`, `analyst_commentary`,
`rumor_unverified`, `correction`.

## 4. Forward mapping from current keyword tags (v0 → v1)

Today's `NEWS_RULES` tags map to v1 as follows (Slice B implements this):

| Current tag | v1 `marketGroup` (primary) | v1 `eventType` | Notes |
|---|---|---|---|
| `security` | `crypto` (or `reg_geo_risk` if non-crypto) | `security_incident` | Score rules conflate hacks+ransomware; split by source domain in Slice B |
| `stability` | `crypto` | `security_incident` / `market_structure_change` | depeg/bankruptcy/liquidation cascade |
| `regulation` | `reg_geo_risk` | `regulatory_action` | |
| `etf` | `crypto` | `fund_flow` | ETF approvals → `official_disclosure` when T0 confirms |
| `approval` | `crypto` | `official_disclosure` | Requires T0 corroboration before `confirmed` status |
| `whale` | `crypto` | `fund_flow` | On-chain claims are T2 until provider-verified |
| `adoption` | `company_sector` | `market_structure_change` | Partnership/integration/adoption |
| `listing` | `crypto` | `listing_delisting` | |
| `price` | (tag only, no group) | — | Price-move headlines carry no event; kept as `topicTags` |
| `central_bank` | `macro_cb` | `central_bank_decision` | Fed/FOMC + ECB rules; direction stays `flat` (meeting-dependent) |
| `filing` | `equities_global` | `official_disclosure` / `corporate_action` | SEC EDGAR; anchored on form types so a generic "files" cannot trip it |
| `macro_release` | `macro_cb` | `macro_release` | BLS program releases (CPI/PPI/Employment Situation/JOLTS); direction `flat` (data-dependent) |
| `commodity` | `fx_gold_commod` | `commodity_supply_shock` | EIA energy/metals/ags; direction `flat` (data-dependent) |
| `equity_market` | `equities_vn` | `official_disclosure` / `market_structure_change` | VnExpress Vietnam market terms (VN-Index/HOSE/SBV/dong); direction `flat` |

## 5. Rules

1. One primary `marketGroup` per item; many-to-many everything else.
2. `rumor_unverified` can never drive high-confidence impact (Slice D rule).
3. Taxonomy changes are versioned here; code references version `1`.
4. No numeric "truth score" — authority lives in source tier + corroboration
   (§60.4), not in this taxonomy.
