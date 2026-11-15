"""Portfolio triage across an owner's CoStar buildings. Reads the local extract only: no provider or AI calls."""
from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Query

from .. import portfolio
from ..providers import costar, vexcel

router = APIRouter(prefix="/api")

MAX_ROWS = 600


def _region(r: dict) -> str | None:
    return vexcel.geofence_region(r["lat"], r["lon"]) if r.get("lat") is not None and r.get("lon") is not None else None


@router.get("/portfolio")
def get_portfolio(owner: int | None = None, q: str = Query("", max_length=100), limit: int = MAX_ROWS):
    """Every indexed building (or one owner's), with Table 208.2 minimums and a measuring order.

    Owners are CoStar company location ids: the hackathon extract carries no owner names."""
    records = list(costar.index().values())
    groups = Counter(r["owner_id"] for r in records if r.get("owner_id"))
    owners = [{"id": oid, "buildings": n} for oid, n in groups.most_common() if n >= 2][:30]

    term = q.strip().lower()
    scope = [r for r in records
             if (owner is None or r.get("owner_id") == owner)
             and (not term or term in f"{r['name']} {r['address']} {r['city']} {r['type']}".lower())]
    rows = portfolio.order([portfolio.triage(r, _region(r)) for r in scope])
    return {
        "owners": owners, "owner": owner,
        "properties": rows[:min(max(limit, 1), MAX_ROWS)],
        "totals": portfolio.totals(rows),
        "rights": costar.RIGHTS, "available": costar.status().state != "unavailable",
    }
