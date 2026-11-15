"""Portfolio triage: what the rule engine and data coverage already say about a building before any screening runs.

No provider or AI call happens here. Everything comes from the CoStar record, the CoStar-Matterport crosswalk and the
Vexcel geofence. The ordering is a measuring order (where a person with a tape measure should go first), not a risk or
compliance score, and it never produces a finding.
"""
from __future__ import annotations

from typing import Any

from .rules import ada2010

ADA_CONTEXT_YEAR = 1992  # same context line the web app uses; background only, never a finding


def triage(rec: dict[str, Any], vexcel_region: str | None) -> dict[str, Any]:
    """One building's row: Table 208.2 minimums for its recorded surface spaces, coverage, and measuring-order points."""
    spaces = rec.get("surface_spaces")
    required = ada2010.required_accessible_spaces(spaces) if spaces is not None else None
    van = ada2010.required_van_spaces(required) if required is not None else None
    year = rec.get("year_built")
    scans = len(rec.get("model_ids") or [])

    reasons: list[dict[str, Any]] = []

    def add(code: str, points: int, label: str) -> None:
        reasons.append({"code": code, "points": points, "label": label})

    if spaces is None:
        add("lot_unknown", 3, "Surface spaces not recorded: count the lot before stalls can be checked")
    elif required and required >= 9:
        add("large_lot", 2, f"Large lot: at least {required} accessible stalls to verify")
    elif required and required >= 5:
        add("large_lot", 1, f"At least {required} accessible stalls to verify")
    if year is None:
        add("year_unknown", 1, "Year built not recorded")
    elif year < ADA_CONTEXT_YEAR:
        add("pre_ada", 2, f"Built {year}, before the ADA")
    if scans == 0:
        add("no_scan", 2, "No 3D scan: every door needs a tape measure")
    if vexcel_region is None:
        add("no_aerial", 1, "No Vexcel aerial: stalls are counted on public imagery or on site")

    return {
        "id": rec["id"], "name": rec.get("name"), "address": rec.get("address"), "city": rec.get("city"),
        "state": rec.get("state"), "type": rec.get("type"), "year_built": year,
        "surface_spaces": spaces, "required_accessible": required, "required_van": van,
        "pre_ada": year is not None and year < ADA_CONTEXT_YEAR,
        "scans": scans, "vexcel_region": vexcel_region,
        "points": sum(r["points"] for r in reasons), "reasons": reasons,
    }


def order(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Most points first; ties go to the building with more accessible stalls to check, then by name."""
    return sorted(rows, key=lambda r: (-r["points"], -(r["required_accessible"] or 0), r["name"] or ""))


def totals(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "buildings": len(rows),
        "required_accessible": sum(r["required_accessible"] or 0 for r in rows),
        "lot_unknown": sum(1 for r in rows if r["surface_spaces"] is None),
        "pre_ada": sum(1 for r in rows if r["pre_ada"]),
        "no_scan": sum(1 for r in rows if r["scans"] == 0),
        "no_aerial": sum(1 for r in rows if r["vexcel_region"] is None),
    }
