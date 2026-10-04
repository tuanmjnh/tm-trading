#!/usr/bin/env python3
# =============================================================================
#  TM TRADING - MT5 BRIDGE (roadmap Phase 12, contract docs/mt5-ipc.md)
#
#  Runs next to the MT5 terminal on Windows only, using the official
#  `MetaTrader5` package. Node keeps everything else (contract section 1).
#
#  Endpoints (section 2, base http://127.0.0.1:8790):
#    GET  /health        liveness + MT5 state + account (section 2.2)
#    GET  /account       balance / equity / margin / currency
#    GET  /positions     open positions (also the Node reconciliation source)
#    POST /order         place a market/pending order (Idempotency-Key REQUIRED)
#    POST /order/close   close by ticket (closing a closed order = ok)
#    POST /order/modify  change SL/TP by ticket
#    GET  /history       command history (spans closed positions)
#
#  Hard rules from the contract:
#    - bind 127.0.0.1 ONLY (section 1, section 6)
#    - Authorization: Bearer <MT5_BRIDGE_TOKEN>, fail-closed (section 6)
#    - every request is answered with JSON, never HTML, and a 4xx/5xx body is
#      {"ok": false, "error": "..."} (section 2)
#    - a repeated Idempotency-Key returns the FIRST result with duplicate:true
#      and places NOTHING (section 2.1, section 4.2)
#    - the same key with a different payload -> 409 with the original ticket
#
#  STATUS: UNVERIFIED. There is no MT5 terminal on the machine where this file
#  was written, so it has never been executed against MetaTrader5. Treat it as
#  a careful draft of the bridge side, not as working software.
#
#  Run:  python exec/mt5/server.py          (reads .env from the repo root)
#  Env:  MT5_BRIDGE_TOKEN   required, fail-closed (no token -> every request 401)
#        MT5_BRIDGE_PORT    default 8790
#        MT5_BRIDGE_HOST    default 127.0.0.1 (never expose this on 0.0.0.0)
#        MT5_MAGIC          magic number stamped on orders, default 20261002
#        MT5_DEVIATION      max price deviation in points, default 20
#        MT5_IDEMPOTENCY_FILE  optional path for the durable key ledger
# =============================================================================
from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # exec/mt5 -> repo root

MAX_BODY = 64 * 1024  # request body cap; /order payloads are tiny
ORDER_HISTORY_DAYS = 30

# MetaTrader5 is imported lazily so `python -m py_compile` and syntax checks work
# on machines without the package. The import failure is reported through
# /health and by every endpoint that needs the terminal.
try:  # pragma: no cover - depends on the host
    import MetaTrader5 as mt5  # type: ignore
except Exception as exc:  # noqa: BLE001 - any import problem is fatal-ish, not a crash
    mt5 = None  # type: ignore
    MT5_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
else:
    MT5_IMPORT_ERROR = ""


# =============================================================================
#  Config
# =============================================================================
def load_env_file(path: Path) -> None:
    """Fill only keys that are NOT already set (mirrors exec/env.mjs)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


class Config:
    def __init__(self) -> None:
        self.host = os.environ.get("MT5_BRIDGE_HOST", "127.0.0.1")
        self.port = env_int("MT5_BRIDGE_PORT", 8790)
        # Fail-closed (section 6): an empty token disables the whole bridge
        # rather than exposing an unauthenticated trading port on loopback.
        self.token = os.environ.get("MT5_BRIDGE_TOKEN", "") or ""
        self.magic = env_int("MT5_MAGIC", 20261002)
        self.deviation = env_int("MT5_DEVIATION", 20)
        self.idempotency_file = os.environ.get("MT5_IDEMPOTENCY_FILE", "") or ""


# =============================================================================
#  Idempotency ledger (section 2.1 + 4.2)
# =============================================================================
class Ledger:
    """
    Idempotency-Key -> result of the FIRST attempt.

    A repeated key with an equal payload returns the stored ticket with
    duplicate:true and places nothing. The same key with a DIFFERENT payload is
    a conflict (409) and is never placed either.

    The in-memory map is authoritative for the process lifetime; the optional
    JSON file makes the guarantee survive a bridge restart, which is what keeps
    a Node-side reconcile resend from ever becoming a second real order.
    """

    def __init__(self, path: str = "") -> None:
        self._lock = threading.Lock()
        self._map: Dict[str, Dict[str, Any]] = {}
        self._path = Path(path) if path else None
        self._load()

    def _load(self) -> None:
        if not self._path or not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                self._map = {str(k): v for k, v in raw.items() if isinstance(v, dict)}
        except Exception as exc:  # noqa: BLE001 - a corrupt ledger must not block trading
            log_event("ledger_load_error", error=str(exc))

    def _persist_locked(self) -> None:
        if not self._path:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(self._path.suffix + ".tmp")
            tmp.write_text(json.dumps(self._map, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self._path)
        except Exception as exc:  # noqa: BLE001
            log_event("ledger_persist_error", error=str(exc))

    @staticmethod
    def payload_hash(payload: Dict[str, Any]) -> str:
        """Canonical hash of the order payload WITHOUT the idempotency fields."""
        canon = {k: v for k, v in payload.items() if k not in ("Idempotency-Key", "clientOrderId")}
        blob = json.dumps(canon, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def claim(self, key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        returns {state: 'new'} | {state:'duplicate', record} | {state:'conflict', record}
        """
        digest = self.payload_hash(payload)
        with self._lock:
            prev = self._map.get(key)
            if prev is None:
                self._map[key] = {"hash": digest, "result": None, "createdAt": now_iso()}
                self._persist_locked()
                return {"state": "new"}
            if prev.get("hash") != digest:
                return {"state": "conflict", "record": prev}
            return {"state": "duplicate", "record": prev}

    def remember(self, key: str, result: Dict[str, Any]) -> None:
        with self._lock:
            rec = self._map.get(key)
            if rec is None:
                rec = {"hash": "", "result": None, "createdAt": now_iso()}
                self._map[key] = rec
            rec["result"] = result
            self._persist_locked()


# =============================================================================
#  Helpers
# =============================================================================
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def log_event(event: str, **fields: Any) -> None:
    """NDJSON to stdout (section 1: Node and the bridge share the log stream)."""
    line = {"ts": now_iso(), "event": event}
    line.update(fields)
    print(json.dumps(line, ensure_ascii=False, default=str), flush=True)


def account_type_of(info: Any) -> str:
    """
    Map MT5 account trade mode to the string the contract names (section 6).

    ACCOUNT_TRADE_MODE_DEMO = 0 -> 'demo'; the two other modes (contest, real)
    both mean "not a demo account", which is what the Node demo-first gate
    refuses. Written defensively: unknown values become 'unknown', never 'demo'.
    """
    mode = getattr(info, "trade_mode", None)
    if mode is None:
        return "unknown"
    if mt5 is not None and mode == getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", 0):
        return "demo"
    return "real"


def http_error(status: int, message: str, **extra: Any) -> Tuple[int, Dict[str, Any]]:
    body = {"ok": False, "error": message}
    body.update(extra)
    return status, body


# =============================================================================
#  MT5 access layer (every call goes through _ensure())
# =============================================================================
class Mt5Bridge:
    def __init__(self, cfg: Config, ledger: Ledger) -> None:
        self.cfg = cfg
        self.ledger = ledger
        self._lock = threading.Lock()
        self._started = time.time()

    # --- connection -----------------------------------------------------------
    def _import_ok(self) -> Optional[Tuple[int, Dict[str, Any]]]:
        if mt5 is None:
            return http_error(503, f"MetaTrader5 package unavailable: {MT5_IMPORT_ERROR}")
        return None

    def _ensure(self) -> Optional[Tuple[int, Dict[str, Any]]]:
        """
        Connect + login if needed. Returns (status, body) if the terminal is not
        usable, or None when the connection is ready. Serialised: the MT5 python
        API binds to one terminal at a time and ThreadingHTTPServer is concurrent.
        """
        err = self._import_ok()
        if err:
            return err
        with self._lock:
            try:
                if mt5.terminal_info() is not None and mt5.account_info() is not None:
                    return None
            except Exception as exc:  # noqa: BLE001
                log_event("mt5_state_error", error=str(exc))
            login = os.environ.get("MT5_LOGIN")
            password = os.environ.get("MT5_PASSWORD")
            server = os.environ.get("MT5_SERVER")
            try:
                if login:
                    ok = mt5.initialize(
                        login=int(login),
                        password=password or "",
                        server=server or "",
                    )
                else:
                    # Attach to an already-running terminal (typical local setup).
                    ok = mt5.initialize()
            except Exception as exc:  # noqa: BLE001
                return http_error(503, f"MT5 initialize failed: {exc}")
            if not ok:
                return http_error(503, f"MT5 initialize failed: {mt5.last_error()}")
            return None

    # --- GET /health (section 2.2) -------------------------------------------
    def health(self) -> Tuple[int, Dict[str, Any]]:
        """
        Always 200 with `ok` reflecting the terminal, EXCEPT when the bridge
        itself is misconfigured (409 conflict is not applicable here).

        Section 6 requires `account_type` in /health; `connected:false` means
        Node must not retry order placement, only report degraded.
        """
        err = self._ensure()
        if err:
            status, body = err
            # Keep the section 2.2 shape so Node can parse it in every state.
            return status, {
                "ok": False,
                "error": body.get("error", "MT5 unavailable"),
                "mt5": {"connected": False, "terminal": None, "account": None, "company": None},
                "account_type": "unknown",
                "uptime": int(time.time() - self._started),
            }
        info = mt5.terminal_info()
        acct = mt5.account_info()
        connected = info is not None and acct is not None
        return 200, {
            "ok": connected,
            "mt5": {
                "connected": connected,
                "terminal": getattr(info, "name", None),
                "account": getattr(acct, "login", None),
                "company": getattr(acct, "company", None),
            },
            "account_type": account_type_of(acct) if connected else "unknown",
            "uptime": int(time.time() - self._started),
        }

    # --- GET /account ---------------------------------------------------------
    def account(self) -> Tuple[int, Dict[str, Any]]:
        err = self._ensure()
        if err:
            return err
        acct = mt5.account_info()
        if acct is None:
            return http_error(503, f"account_info failed: {mt5.last_error()}")
        return 200, {
            "ok": True,
            "login": getattr(acct, "login", None),
            "balance": getattr(acct, "balance", None),
            "equity": getattr(acct, "equity", None),
            "margin": getattr(acct, "margin", None),
            "margin_free": getattr(acct, "margin_free", None),
            "currency": getattr(acct, "currency", None),
            "leverage": getattr(acct, "leverage", None),
            "account_type": account_type_of(acct),
        }

    # --- GET /positions (section 5: the bridge is the source of truth) --------
    def positions(self) -> Tuple[int, Dict[str, Any]]:
        err = self._ensure()
        if err:
            return err
        raw = mt5.positions_get()
        if raw is None:
            return http_error(503, f"positions_get failed: {mt5.last_error()}")
        out: List[Dict[str, Any]] = [position_doc(p) for p in raw]
        return 200, out

    # --- GET /history ---------------------------------------------------------
    def history(self) -> Tuple[int, Dict[str, Any]]:
        err = self._ensure()
        if err:
            return err
        since = datetime.now(timezone.utc).timestamp() - ORDER_HISTORY_DAYS * 86400
        raw = mt5.history_orders_get(int(since), int(time.time()))
        if raw is None:
            return http_error(503, f"history_orders_get failed: {mt5.last_error()}")
        deals = mt5.history_deals_get(int(since), int(time.time())) or ()
        return 200, {
            "ok": True,
            "orders": [history_order_doc(o) for o in raw],
            "deals": [deal_doc(d) for d in deals],
        }

    # --- POST /order (section 2.1) -------------------------------------------
    def order(self, payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        key = payload.get("Idempotency-Key") or payload.get("clientOrderId")
        if not isinstance(key, str) or not key:
            return http_error(422, "Idempotency-Key is required (section 2.1)")
        if len(key) > 31 or not all(c.isalnum() or c in "_-" for c in key):
            return http_error(422, f"Idempotency-Key invalid (<=31 chars [A-Za-z0-9_-]): {key}")

        claim = self.ledger.claim(key, payload)

        if claim["state"] == "conflict":
            # Same key, different payload (section 2.1).
            original = (claim.get("record") or {}).get("result") or {}
            return 409, {
                "ok": False,
                "error": "idempotency-key trung nhung payload khac",
                "original": {"ticket": original.get("ticket")},
            }
        if claim["state"] == "duplicate":
            result = (claim.get("record") or {}).get("result") or {}
            if result.get("ticket") is None:
                # The first attempt did NOT produce a ticket (a rejected order).
                # Never invent one: repeat the original failure.
                return int(result.get("httpStatus", 409)), {
                    "ok": False,
                    "error": result.get("error", "previous attempt failed"),
                    "duplicate": True,
                }
            out = dict(result)
            out["duplicate"] = True
            return 200, out

        err = self._ensure()
        if err:
            return err

        required = ("symbol", "side", "type", "qty", "sl")
        missing = [f for f in required if payload.get(f) in (None, "")]
        if missing:
            return http_error(422, f"missing required field(s): {', '.join(missing)}")

        side = str(payload["side"]).upper()
        if side not in ("BUY", "SELL"):
            return http_error(422, f"side must be BUY or SELL: {payload['side']}")
        otype = str(payload["type"]).lower()
        if otype not in ("market", "pending"):
            return http_error(422, f"type must be market or pending: {payload['type']}")
        try:
            qty = float(payload["qty"])
            sl = float(payload["sl"])
            tp = float(payload["tp"]) if payload.get("tp") not in (None, "") else 0.0
        except (TypeError, ValueError) as exc:
            return http_error(422, f"qty/sl/tp must be numbers: {exc}")
        if qty <= 0:
            return http_error(422, f"qty must be > 0: {qty}")

        symbol = str(payload["symbol"])
        info = mt5.symbol_info(symbol)
        if info is None:
            return http_error(404, f"symbol not found at broker: {symbol}")
        if not info.visible:
            mt5.symbol_select(symbol, True)
            info = mt5.symbol_info(symbol) or info

        # Bridge-side volume normalisation (section 2.1: the bridge checks
        # MODE_VOLUME_MIN/MAX/STEP itself).
        qty = normalise_volume(qty, info)
        if qty <= 0:
            return http_error(422, f"qty outside broker volume limits for {symbol}")
        bad = validate_stops(side, sl, info)
        if bad:
            return http_error(422, bad)

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return http_error(503, f"symbol_info_tick failed: {mt5.last_error()}")
        price = tick.ask if side == "BUY" else tick.bid
        comment = str(payload.get("comment") or "")[:31]

        request = {
            "action": mt5.TRADE_ACTION_DEAL if otype == "market" else mt5.TRADE_ACTION_PENDING,
            "symbol": symbol,
            "volume": qty,
            "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": self.cfg.deviation,
            "magic": self.cfg.magic,
            # MT5 caps `comment` at 31 chars; the Node side keeps it <= 31 too.
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling_mode(info),
        }

        try:
            result = mt5.order_send(request)
        except Exception as exc:  # noqa: BLE001
            # The request may have reached the terminal: report 503 so Node
            # treats the order as unknown and reconciles (section 4.3).
            self.ledger.remember(key, {"httpStatus": 503, "error": f"order_send raised: {exc}"})
            return http_error(503, f"order_send raised: {exc}")

        if result is None:
            self.ledger.remember(key, {"httpStatus": 503, "error": f"order_send returned None: {mt5.last_error()}"})
            return http_error(503, f"order_send returned None: {mt5.last_error()}")
        if getattr(result, "retcode", None) != mt5.TRADE_RETCODE_DONE:
            err_text = f"order_send retcode={getattr(result, 'retcode', None)} {getattr(result, 'comment', '')}"
            self.ledger.remember(key, {"httpStatus": 400, "error": err_text})
            return http_error(400, err_text, retcode=getattr(result, "retcode", None))

        out = {
            "ok": True,
            "ticket": getattr(result, "order", None) or getattr(result, "deal", None),
            "clientOrderId": key,
            "duplicate": False,
            "filled": {
                "price": getattr(result, "price", price),
                "qty": getattr(result, "volume", qty),
            },
        }
        self.ledger.remember(key, out)
        log_event("order_placed", key=key, symbol=symbol, side=side, qty=qty, ticket=out["ticket"])
        return 200, out

    # --- POST /order/close (idempotent: closing a closed order = ok) ----------
    def close(self, payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        err = self._ensure()
        if err:
            return err
        ticket = as_int(payload.get("ticket"))
        if ticket is None:
            return http_error(422, "ticket is required")
        found = mt5.positions_get(ticket=ticket)
        if not found:
            # Idempotent per section 2: already closed (or never existed) = ok.
            return 200, {"ok": True, "ticket": ticket, "closed": False, "note": "already-closed"}
        pos = found[0]
        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            return http_error(503, f"symbol_info_tick failed: {mt5.last_error()}")
        closing_buy = pos.type == mt5.POSITION_TYPE_SELL
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": ticket,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": mt5.ORDER_TYPE_BUY if closing_buy else mt5.ORDER_TYPE_SELL,
            "price": tick.ask if closing_buy else tick.bid,
            "deviation": self.cfg.deviation,
            "magic": self.cfg.magic,
            "comment": "tm-close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling_mode(mt5.symbol_info(pos.symbol)),
        }
        try:
            result = mt5.order_send(request)
        except Exception as exc:  # noqa: BLE001
            return http_error(503, f"close raised: {exc}")
        if result is None or getattr(result, "retcode", None) != mt5.TRADE_RETCODE_DONE:
            rc = getattr(result, "retcode", None)
            return http_error(400, f"close failed retcode={rc} {getattr(result, 'comment', '')}")
        log_event("order_closed", ticket=ticket)
        return 200, {"ok": True, "ticket": ticket, "closed": True, "price": getattr(result, "price", None)}

    # --- POST /order/modify (idempotent) -------------------------------------
    def modify(self, payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        err = self._ensure()
        if err:
            return err
        ticket = as_int(payload.get("ticket"))
        if ticket is None:
            return http_error(422, "ticket is required")
        found = mt5.positions_get(ticket=ticket)
        if not found:
            return http_error(404, f"position not found: {ticket}")
        pos = found[0]
        sl = payload.get("sl")
        tp = payload.get("tp")
        if sl is None and tp is None:
            return http_error(422, "sl or tp is required")
        request = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": ticket,
            "symbol": pos.symbol,
            "sl": float(sl) if sl not in (None, "") else pos.sl,
            "tp": float(tp) if tp not in (None, "") else pos.tp,
            "magic": self.cfg.magic,
            "comment": "tm-modify",
        }
        try:
            result = mt5.order_send(request)
        except Exception as exc:  # noqa: BLE001
            return http_error(503, f"modify raised: {exc}")
        if result is None or getattr(result, "retcode", None) != mt5.TRADE_RETCODE_DONE:
            rc = getattr(result, "retcode", None)
            return http_error(400, f"modify failed retcode={rc} {getattr(result, 'comment', '')}")
        log_event("order_modified", ticket=ticket)
        return 200, {"ok": True, "ticket": ticket, "sl": request["sl"], "tp": request["tp"]}


# =============================================================================
#  MT5 record -> contract JSON
# =============================================================================
def position_doc(p: Any) -> Dict[str, Any]:
    """Section 5: Node stores externalId = ticket, so ticket must be stable."""
    side = "BUY" if getattr(p, "type", 0) == 0 else "SELL"
    return {
        "ticket": getattr(p, "ticket", None),
        "symbol": getattr(p, "symbol", None),
        "side": side,
        "qty": getattr(p, "volume", None),
        "entryPrice": getattr(p, "price_open", None),
        "price_current": getattr(p, "price_current", None),
        "sl": getattr(p, "sl", None),
        "tp": getattr(p, "tp", None),
        "profit": getattr(p, "profit", None),
        "comment": getattr(p, "comment", None),
        "magic": getattr(p, "magic", None),
        # Same value as `ticket`, named for the data-model field (D3/D4).
        "clientOrderId": str(getattr(p, "ticket", "") or "") or None,
        "openedAt": iso_from_seconds(getattr(p, "time", None)),
    }


def history_order_doc(o: Any) -> Dict[str, Any]:
    return {
        "ticket": getattr(o, "ticket", None),
        "symbol": getattr(o, "symbol", None),
        "type": getattr(o, "type", None),
        "state": getattr(o, "state", None),
        "volume": getattr(o, "volume_initial", None),
        "price": getattr(o, "price_open", None),
        "sl": getattr(o, "sl", None),
        "tp": getattr(o, "tp", None),
        "comment": getattr(o, "comment", None),
        "time": iso_from_seconds(getattr(o, "time_setup", None)),
    }


def deal_doc(d: Any) -> Dict[str, Any]:
    return {
        "ticket": getattr(d, "ticket", None),
        "order": getattr(d, "order", None),
        "position": getattr(d, "position_id", None),
        "symbol": getattr(d, "symbol", None),
        "volume": getattr(d, "volume", None),
        "price": getattr(d, "price", None),
        "profit": getattr(d, "profit", None),
        "comment": getattr(d, "comment", None),
        "time": iso_from_seconds(getattr(d, "time", None)),
    }


def iso_from_seconds(seconds: Any) -> Optional[str]:
    try:
        return datetime.fromtimestamp(int(seconds), tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:  # noqa: BLE001
        return None


def as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalise_volume(qty: float, info: Any) -> float:
    """Round DOWN to MODE_VOLUME_STEP and clamp to MODE_VOLUME_MIN/MAX."""
    step = float(getattr(info, "volume_step", 0) or 0)
    vmin = float(getattr(info, "volume_min", 0) or 0)
    vmax = float(getattr(info, "volume_max", 0) or 0)
    out = qty
    if step > 0:
        out = (int(qty / step + 1e-9)) * step
    if vmin > 0 and out < vmin:
        out = vmin
    if vmax > 0 and out > vmax:
        out = vmax
    return round(out, 8)


def validate_stops(side: str, sl: float, info: Any) -> str:
    """Section 2.1: the bridge checks MODE_STOPLEVEL itself."""
    point = float(getattr(info, "point", 0) or 0)
    stop = float(getattr(info, "trade_stops_level", 0) or 0)
    if point <= 0 or stop <= 0:
        return ""
    tick = mt5.symbol_info_tick(info.name) if mt5 is not None else None
    if tick is None:
        return ""
    price = tick.ask if side == "BUY" else tick.bid
    distance = abs(price - sl) / point
    if distance < stop:
        return f"sl too close: {distance:.1f} points < stop level {stop:.0f}"
    return ""


def filling_mode(info: Any) -> int:
    """
    Pick a filling mode the symbol actually supports (a common MT5 gotcha: the
    default FOK is rejected with retcode 10030 on many brokers).
    """
    if mt5 is None or info is None:
        return 0
    allowed = getattr(info, "filling_mode", 0)
    if allowed & getattr(mt5, "SYMBOL_FILLING_FOK", 1):
        return mt5.ORDER_FILLING_FOK
    if allowed & getattr(mt5, "SYMBOL_FILLING_IOC", 2):
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


# =============================================================================
#  HTTP server (loopback only, section 6)
# =============================================================================
class Handler(BaseHTTPRequestHandler):
    server_version = "tm-mt5-bridge/0.1"
    protocol_version = "HTTP/1.1"
    bridge: Mt5Bridge = None  # type: ignore[assignment]
    cfg: Config = None  # type: ignore[assignment]

    # --- plumbing -------------------------------------------------------------
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        # Default access log is noisy and not NDJSON; replace it.
        pass

    def _json(self, status: int, body: Any) -> None:
        raw = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def _authorised(self) -> bool:
        """Fail-closed: no configured token -> nothing is authorised (section 6)."""
        if not self.cfg.token:
            return False
        header = self.headers.get("Authorization", "") or ""
        if not header.startswith("Bearer "):
            return False
        offered = header[len("Bearer ") :].strip()
        return constant_time_eq(offered, self.cfg.token)

    def _read_json(self) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[int, Dict[str, Any]]]]:
        length = as_int(self.headers.get("Content-Length")) or 0
        if length <= 0:
            return {}, None
        if length > MAX_BODY:
            return None, http_error(413, "payload too large")
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            return None, http_error(400, f"invalid JSON: {exc}")
        if not isinstance(parsed, dict):
            return None, http_error(400, "body must be a JSON object")
        return parsed, None

    # --- methods --------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/health" and not self.cfg.token:
            # Even /health is fail-closed: the bridge must never look "ready"
            # to an unauthenticated caller. 401 keeps Node in `degraded`.
            return self._json(401, {"ok": False, "error": "MT5_BRIDGE_TOKEN is not set - bridge disabled (fail-closed)"})
        if not self._authorised():
            return self._json(401, {"ok": False, "error": "invalid or missing bearer token"})
        try:
            if path == "/health":
                status, body = self.bridge.health()
            elif path == "/account":
                status, body = self.bridge.account()
            elif path == "/positions":
                status, body = self.bridge.positions()
            elif path == "/history":
                status, body = self.bridge.history()
            else:
                status, body = http_error(404, "not found")
        except Exception as exc:  # noqa: BLE001 - never leak a stack trace as HTML
            log_event("handler_error", path=path, error=str(exc))
            status, body = http_error(500, f"internal error: {exc}")
        self._json(status, body)

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if not self._authorised():
            # Drain the body so the connection stays in a usable state.
            length = as_int(self.headers.get("Content-Length")) or 0
            if 0 < length <= MAX_BODY:
                self.rfile.read(length)
            return self._json(401, {"ok": False, "error": "invalid or missing bearer token"})
        payload, err = self._read_json()
        if err:
            return self._json(*err)
        assert payload is not None
        try:
            if path == "/order":
                status, body = self.bridge.order(payload)
            elif path == "/order/close":
                status, body = self.bridge.close(payload)
            elif path == "/order/modify":
                status, body = self.bridge.modify(payload)
            else:
                status, body = http_error(404, "not found")
        except Exception as exc:  # noqa: BLE001
            log_event("handler_error", path=path, error=str(exc))
            status, body = http_error(500, f"internal error: {exc}")
        self._json(status, body)

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_PUT(self) -> None:  # noqa: N802
        self._json(405, {"ok": False, "error": "method not allowed"})

    do_DELETE = do_PUT
    do_PATCH = do_PUT


def constant_time_eq(a: str, b: str) -> bool:
    """Compare without an early exit (mirrors server/webhook.mjs sameToken())."""
    import hmac

    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def main() -> int:
    load_env_file(ROOT / ".env")
    cfg = Config()

    if not cfg.token:
        # Fail-closed and loud: refuse to run an unauthenticated trading port.
        print("FATAL: MT5_BRIDGE_TOKEN is not set - refusing to start (fail-closed, contract section 6).", file=sys.stderr)
        print("       Add MT5_BRIDGE_TOKEN=<secret> to .env and run again.", file=sys.stderr)
        return 2

    ledger = Ledger(cfg.idempotency_file)
    bridge = Mt5Bridge(cfg, ledger)
    Handler.bridge = bridge
    Handler.cfg = cfg

    if mt5 is None:
        # Keep serving: /health reports the problem instead of the port being dead.
        log_event("mt5_import_failed", error=MT5_IMPORT_ERROR)
    else:
        err = bridge._ensure()
        if err:
            log_event("mt5_connect_failed", error=err[1].get("error"))

    server = ThreadingHTTPServer((cfg.host, cfg.port), Handler)
    log_event("bridge_listening", host=cfg.host, port=cfg.port)
    print(f"TM MT5 bridge    : http://{cfg.host}:{cfg.port}", flush=True)
    print(f"  token          : {'set' if cfg.token else 'MISSING'}", flush=True)
    print(f"  idempotency    : {'file ' + cfg.idempotency_file if cfg.idempotency_file else 'in-memory only'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        try:
            if mt5 is not None:
                mt5.shutdown()
        except Exception:  # noqa: BLE001
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
