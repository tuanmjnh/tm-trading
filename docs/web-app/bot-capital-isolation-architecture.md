# Bot Capital & Isolation Architecture

## 1. Overview & Architectural Philosophy

In TM Trading, quantitative trading bots (`bot_instances`, `bot_profiles`) and AI trading agents (`ai_agents`) serve as **isolated strategy testbenches**. Their primary objective is to measure the **true, unadulterated PnL and edge** of individual strategies (e.g. VSA, Wonderwhales, Trend, Orderflow, AI reasoning) without mutual capital contamination or shared accounting friction.

### Separation of Concerns

| Domain | Entity | Purpose | Capital & Lifecycle Model |
| :--- | :--- | :--- | :--- |
| **Demo Trading** | `paper_accounts` | Manual paper trading, demo portfolios, discretionary testing | Shared multi-currency balance, manual deposits/withdrawals, book-wide risk limits |
| **Strategy Bots** | `bot_instances` | Automated strategy runs driven by market data & supervisor | **Self-contained allocated capital** (`initialCapital`, default `$10,000.00`), isolated PnL (`paperPnl`), independent traded volume |
| **AI Copilots** | `ai_agents` | LLM-driven market analysis, proposal generation & execution | **Isolated allocated capital** (`allocatedCapital`), audited action records (`ai_agent_actions`), policy-gated execution |

---

## 2. Why Bots Do Not Bind to Shared Accounts

1. **Measurement Honesty**:
   - Binding multiple bots to a single shared `paper-main` account causes overlapping drawdowns, unclear fee attribution, and distorted win-rate metrics.
   - Giving each bot its own dedicated initial capital (`initialCapital`, e.g. `$10,000.00`) ensures that `paperEquity = initialCapital + paperPnl` directly reflects that specific bot's performance.
2. **Elimination of Resource Locks (`account_busy`)**:
   - In legacy shared-account models, only one active bot could hold an account at any given time to avoid duplicate order collisions.
   - With isolated bot testbenches, each bot operates its own sub-book (`bot-<instanceId>`), allowing unlimited concurrent bots to run simultaneously across different symbols and timeframes.
3. **Clear Boundary for Manual Demo Trading**:
   - Global `paper_accounts` (Tài khoản) remain clean and dedicated exclusively for manual demo trading and user-driven sandbox experiments.

---

## 3. Dual Bot Rerun Semantics

When a bot finishes its cycle or encounters a terminal state (`completed`, `failed`, `halted`), the system provides **two distinct rerun actions**:

### Action 1: Rerun from Scratch / Reset Capital (`mode: 'reset'`)
- **Intent**: Fast creation of a fresh bot instance using the exact same strategy parameters.
- **Behavior**:
  - Clones all technical parameters (profile id, symbol, timeframe, method, stop-loss / trailing ATR, AI version).
  - Resets capital back to the initial default (`$10,000.00` or custom specified capital).
  - Resets all counters: `signals: 0`, `orders: 0`, `trades: 0`, `paperPnl: $0.00`.
  - Generates a fresh instance identifier (e.g. `bot-<profile>-<date>-<n>`).
  - Sets state to `queued` and enqueues the `start` command for the supervisor.
- **Use Case**: Testing the strategy against a new market session or resetting after parameter tuning.

### Action 2: Continue Running with Current History & Capital (`mode: 'continue'`)
- **Intent**: Extend the existing bot run to evaluate cumulative, multi-day track records.
- **Behavior**:
  - Re-arms the existing bot instance from its terminal state back to `queued`.
  - Preserves existing accumulated capital (`paperEquity`), net PnL (`paperPnl`), and historical order/fill records.
  - Clears previous error reason codes (`healthReason: null`, `lastError: null`).
  - Enqueues the `start` command to resume market subscription and signal processing.
- **Use Case**: Evaluating long-term strategy compounding, recovery from drawdown, or continuous endurance testing.

---

## 4. UI & UX Integration

1. **Unified Dropdown Actions**:
   - In both the **Trading Bots** tab and the **AI Agents** tab on `/operations` (`app/pages/operations.vue`), the row actions column is streamlined into a single clean `⋯` (`i-lucide-ellipsis-vertical`) dropdown menu.
   - **Menu Items for Bots**:
     1. 🔍 **Xem chi tiết (View Detail)**: Opens the comprehensive 3-tab Responsive Modal.
     2. 🔄 **Chạy lại từ đầu (Reset vốn)**: Clones config and resets starting capital to default.
     3. ⏯️ **Chạy tiếp tục (Giữ vốn & lịch sử)**: Continues run inheriting current capital and trade history.
     4. ⏸️ / ⏹️ **Tạm dừng / Dừng**: Contextual lifecycle controls for active bots.
   - **Menu Items for AI Agents**:
     1. 🔍 **Xem chi tiết (View Detail)**: Opens the AI Agent inspector modal.
     2. ⏯️ **Kích hoạt / Tạm dừng (Start / Pause)**: Immediate autonomy state toggle.
2. **Bot Detail Modal**:
   - Displays 4 independent financial metric cards (Allocated Capital, Net PnL, Traded Volume, Total Trades).
   - Features dedicated header action buttons for both **Chạy lại từ đầu** and **Chạy tiếp tục**.
   - Includes architectural notice informing the user that bot capital is isolated from manual demo trading accounts.
