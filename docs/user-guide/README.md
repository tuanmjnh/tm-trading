# TM Trading — User Guide

This guide is for people who **use** TM Trading: operators, analysts and
administrators. It explains what each workspace does, what is genuinely working
today, and how to recover when something looks wrong.

For architecture, data contracts and roadmap material, read
[../web-app/](../web-app/) instead. This directory does not repeat design
decisions; it explains behaviour.

## Who this is for

| Reader | Start here |
| --- | --- |
| First-time user, need to log in and see data | [getting-started.md](getting-started.md) |
| Daily user of the market workspaces | [workspaces.md](workspaces.md) |
| Operator responsible for services and health | [operations.md](operations.md) |
| Something is broken | [troubleshooting.md](troubleshooting.md) |

## What TM Trading is

A crypto-first **market intelligence, coin discovery, futures signal and alerting
workbench**. It helps you:

1. see what is happening across the crypto market now;
2. detect unusual price, volume, volatility, funding, open-interest and
   liquidation activity;
3. follow a watchlist and receive explainable futures research signals;
4. combine news, market events and liquidity information into one asset view;
5. deliver selected alerts to Telegram;
6. keep the underlying evidence for later evaluation.

It is **not** a broker, an order-entry terminal, or a place to connect a live
trading account. Execution is restricted to explicitly configured demo/test
environments, and every demo order still passes the server-side Risk Gate.

## Capability status legend

Every feature description in this guide carries one of these labels. They mean
exactly what they say — a visible menu item is not proof that a feature works.

| Label | Meaning |
| --- | --- |
| **Available** | Reads or writes real records through a wired API, with a real producer behind it. |
| **Partial** | Some steps work; a producer, consumer or state machine is missing. The guide says which. |
| **Read-only** | Shows real records; there is no write path. |
| **Placeholder** | The page exists but is not bound to data, or the data is written only by a seed script. |
| **Not available** | No page and no backend. The menu entry is hidden. |

## Data freshness labels

Every number that comes from a live source has an **age**. The V4.2 data layer
(V4.2 S1.1) introduces a shared freshness contract so a panel can never show old
data as if it were live. As panels are migrated you will see these labels next to
values:

| Label | Meaning | How to react |
| --- | --- | --- |
| **FRESH** | Within the source's expected window. | Treat as live. |
| **DELAYED** | Older than expected, but still plausible (up to twice the window). | Usable, but verify if it drives a decision. |
| **STALE** | Beyond twice the window, or the producer flagged a gap. | Do not treat as current. Reload or check the service. |
| **MISSING** | The source never produced a value. | A data problem, not a zero. |
| **UNKNOWN** | Age cannot be established (bad timestamp, or no source configured). | Never assume it is fresh. |

Two rules the guide relies on, and the product enforces:

- **only FRESH may be rendered as live** — anything else is labelled;
- **missing is not zero** — an absent value is shown as missing, never as `0`.

The windows differ by data kind (a quote is expected within seconds, a macro
series within a day). This label set is rolling out panel by panel, so not every
screen shows it yet.

## Conventions used in this guide

- **Port**: the dashboard runs on `http://localhost:4001`.
- **Identity**: accounts, roles and permissions come from **TM Hub**. TM Trading
  never stores its own users or passwords.
- **Time**: everything is stored and displayed in **UTC**. Business days are
  `YYYY-MM-DD` strings.
- **Money and size**: quotes are venue-native; paper trading uses the configured
  paper market, not live funds.
- **"Freshness"**: the age of the newest underlying record, not the time the page
  was loaded.

## What this guide will not tell you

- It will not claim a feature is complete because a route exists.
- It will not hide an unimplemented capability behind vague wording. If a
  workspace is a shell, it is labelled **Placeholder**.
- It will not ask you to edit the database to fix a UI problem.

## Related reading

- Product scope and page-by-page status: [../web-app/v4-product-scope-audit.md](../web-app/v4-product-scope-audit.md)
- Menu structure and route migration: [../web-app/v4-route-migration-map.md](../web-app/v4-route-migration-map.md)
- Service inventory: [../web-app/v4.2-service-inventory.md](../web-app/v4.2-service-inventory.md)
- Operations control audit: [../web-app/v4.2-operations-control-audit.md](../web-app/v4.2-operations-control-audit.md)
