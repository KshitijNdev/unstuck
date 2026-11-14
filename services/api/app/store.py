"""SQLite document store for audits. One row per audit, JSON body. Weekend-grade on purpose."""
from __future__ import annotations

import os
import sqlite3
import threading

from .models import Audit

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _db_path() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///./unstuck.sqlite")
    return url.removeprefix("sqlite:///") if url.startswith("sqlite:///") else "./unstuck.sqlite"


def _connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(_db_path(), check_same_thread=False)
        _conn.execute("CREATE TABLE IF NOT EXISTS audits (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        _conn.commit()
    return _conn


def reset(path: str | None = None) -> None:
    """Point the store at a fresh database (used by tests)."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        if path is not None:
            os.environ["DATABASE_URL"] = f"sqlite:///{path}"


def save(audit: Audit) -> None:
    with _lock:
        c = _connection()
        c.execute("INSERT INTO audits (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
                  (audit.id, audit.model_dump_json()))
        c.commit()


def get(audit_id: str) -> Audit | None:
    with _lock:
        row = _connection().execute("SELECT body FROM audits WHERE id = ?", (audit_id,)).fetchone()
    return Audit.model_validate_json(row[0]) if row else None


def find_by_finding(finding_id: str) -> Audit | None:
    audit_id = finding_id.split("__", 1)[0]
    return get(audit_id)


def usage_totals() -> dict:
    """Model tokens summed over every audit in this database."""
    with _lock:
        rows = _connection().execute(
            "SELECT json_extract(body, '$.usage') FROM audits WHERE json_array_length(json_extract(body, '$.usage')) > 0"
        ).fetchall()
    import json
    t = {"audits_with_agent": 0, "requests": 0, "input_tokens": 0, "cache_write_tokens": 0,
         "cache_read_tokens": 0, "output_tokens": 0, "est_cost_usd": 0.0, "unpriced_models": []}
    for (raw,) in rows:
        t["audits_with_agent"] += 1
        for u in json.loads(raw):
            for k in ("requests", "input_tokens", "cache_write_tokens", "cache_read_tokens", "output_tokens"):
                t[k] += u.get(k, 0)
            if u.get("est_cost_usd") is None:
                t["unpriced_models"] = sorted(set(t["unpriced_models"]) | {u["model"]})
            else:
                t["est_cost_usd"] += u["est_cost_usd"]
    t["est_cost_usd"] = round(t["est_cost_usd"], 4)
    return t
