"""CoStar data extract adapter (HackPrinceton 2026 kit: Houston and Los Angeles).

The kit is a folder of JSON Lines files, not an API. Point COSTAR_KIT_DIR at the unzipped
folder. We read `data/commercial-property.jsonl` and the `commercial-properties.csv`
crosswalk (PropertyId -> MatterportModelId), and keep a slim index of the fields we use.

Only non-residential property types are indexed: apartments and homes fall mostly under
the Fair Housing Act rather than ADA Title III, which is out of scope here.

Nothing is invented: a field that is absent in the record stays None.
"""
from __future__ import annotations

import csv
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..models import SourceStatus

PROPERTY_TYPES = {1: "Hospitality", 2: "Industrial", 5: "Office", 6: "Retail", 7: "Flex",
                  8: "Sports and entertainment", 9: "Mixed use", 10: "Specialty", 13: "Healthcare"}
SURFACE_PARKING_TYPES = {1, 2}          # Surface, SurfaceTandem
PARKING_TYPE_NAMES = {0: "unknown", 1: "surface", 2: "surface tandem", 3: "covered", 4: "covered tandem",
                      5: "industrial trailer", 8: "reserved"}
CONSTRUCTION_COMPLETE, RENOVATION_FINISHED = 2, 4
RIGHTS = "CoStar data extract, HackPrinceton 2026 hackathon use only"


def _kit_dir() -> Path | None:
    raw = os.environ.get("COSTAR_KIT_DIR")
    if not raw:
        return None
    p = Path(raw).expanduser()
    return p if (p / "data" / "commercial-property.jsonl").is_file() else None


def _slim(r: dict[str, Any], crosswalk: dict[str, dict]) -> dict[str, Any] | None:
    ptype = PROPERTY_TYPES.get(r.get("propertyType"))
    if ptype is None:
        return None
    a = r.get("primaryAddress") or {}
    cw = crosswalk.get(str(r["id"]), {})
    events = r.get("constructionEvents") or []
    built = [e["year"] for e in events if e.get("eventType") == CONSTRUCTION_COMPLETE and e.get("year")]
    renovated = [e["year"] for e in events if e.get("eventType") == RENOVATION_FINISHED and e.get("year")]
    parking = [{"type": PARKING_TYPE_NAMES.get(p.get("parkingType"), "other"), "spaces": p.get("totalSpaces")}
               for p in r.get("parking") or []]
    surface = [p.get("totalSpaces") for p in r.get("parking") or []
               if p.get("parkingType") in SURFACE_PARKING_TYPES and p.get("totalSpaces") is not None]
    address = cw.get("address") or " ".join(
        str(a[k]) for k in ("streetNumber", "streetDirection", "streetName", "streetType") if a.get(k))
    return {
        "id": r["id"], "name": r.get("buildingName") or address or f"CoStar property {r['id']}",
        "address": address or None, "city": a.get("city"), "state": a.get("state"),
        "lat": a.get("latitude"), "lon": a.get("longitude"), "type": ptype,
        "year_built": min(built) if built else None, "year_renovated": max(renovated) if renovated else None,
        "surface_spaces": sum(surface) if surface else None, "parking": parking,
        "stories": r.get("numStoriesAboveGrade"), "rentable_sf": r.get("rentableBuildingAreaSquareFeet"),
        "model_ids": cw.get("models", []),
    }


@lru_cache(maxsize=2)
def _load(kit: str) -> dict[int, dict[str, Any]]:
    """Build (or read a cached copy of) the slim index. The source file is about 190 MB."""
    d = Path(kit)
    src = d / "data" / "commercial-property.jsonl"
    cache = d.parent / "costar_index.json"
    if cache.is_file() and cache.stat().st_mtime >= src.stat().st_mtime:
        return {int(k): v for k, v in json.loads(cache.read_text()).items()}
    crosswalk: dict[str, dict] = {}
    with open(d / "commercial-properties.csv", newline="") as f:
        for row in csv.DictReader(f):
            entry = crosswalk.setdefault(row["PropertyId"], {"address": row.get("Address"), "models": []})
            if row.get("MatterportModelId"):
                entry["models"].append(row["MatterportModelId"])
    index: dict[int, dict[str, Any]] = {}
    with open(src) as f:
        for line in f:
            slim = _slim(json.loads(line), crosswalk)
            if slim:
                index[slim["id"]] = slim
    try:
        cache.write_text(json.dumps(index))
    except OSError:
        pass
    return index


def index() -> dict[int, dict[str, Any]]:
    d = _kit_dir()
    return _load(str(d)) if d else {}


def get(property_id: int) -> dict[str, Any] | None:
    return index().get(property_id)


def search(q: str = "", city: str | None = None, limit: int = 25) -> list[dict[str, Any]]:
    """Non-residential properties that have a Matterport scan, best-documented first."""
    q = q.strip().lower()
    rows = [r for r in index().values() if r["model_ids"]
            and (not city or (r["city"] or "").lower() == city.lower())
            and (not q or q in f"{r['name']} {r['address']} {r['type']} {r['id']}".lower())]
    rows.sort(key=lambda r: (r["surface_spaces"] is None, r["year_built"] is None, r["year_built"] or 0, r["name"]))
    return rows[:limit]


def status() -> SourceStatus:
    if not _kit_dir():
        return SourceStatus(provider="CoStar", layer="property", state="unavailable", is_sponsor_source=True,
                            detail="No extract found. Run /costar-keys in the track Discord, unzip the kit, set COSTAR_KIT_DIR.")
    n = len(index())
    with_model = sum(1 for r in index().values() if r["model_ids"])
    return SourceStatus(provider="CoStar", layer="property", state="connected", is_sponsor_source=True,
                        detail=f"Data extract loaded: {n} non-residential properties in Houston and Los Angeles, {with_model} with a Matterport scan.",
                        features=["use type", "year built", "parking counts by type", "Matterport model crosswalk"])
