"""Matterport Model API adapter (GraphQL, HTTP basic auth: API key as user, token as password).

Queries taken from the HackPrinceton 2026 quickstart; verified with a hackathon key on 14 Nov 2026.

What this can and cannot support:
  * Room dimensions are context. They are NOT door clear widths.
  * Where Matterport has drawn a floor plan, wall edges carry `openings` typed doorway, opening,
    window or divider, each with a width in metres. A doorway's width is the framed gap in the
    wall, not the clear width with the door open, so the rule engine can use it to suspect a
    narrow door but never to pass one (rules/ada2010.py screen_doorway_opening).
  * Many scans have no floor plan at all (no edges); then there is nothing to measure.
"""
from __future__ import annotations

import os
from collections import Counter
from typing import Any

import httpx

from ..models import Evidence, SourceStatus, now_iso

URL = "https://api.matterport.com/api/models/graph"

BASICS = """query Basics($id: ID!) { model(id: $id) {
  id name created visibility
  address { address locality administrativeArea postalCode }
  geolocation { lat long }
  propertyClassifications { classification type }
  floors { id label edges { id type thickness openings { id type label width height } } }
  rooms { id classifications { label confidence } dimensions(units: metric) { areaFloor width depth height } }
  panoLocations { id }
} }"""


def _auth() -> tuple[str, str] | None:
    key = os.environ.get("MATTERPORT_API_KEY") or os.environ.get("MATTERPORT_TOKEN_ID")
    token = os.environ.get("MATTERPORT_API_TOKEN") or os.environ.get("MATTERPORT_TOKEN_SECRET")
    return (key, token) if key and token else None


def status() -> SourceStatus:
    if not _auth():
        return SourceStatus(provider="Matterport", layer="interior", state="unavailable", is_sponsor_source=True,
                            detail="No MATTERPORT_API_KEY / MATTERPORT_API_TOKEN set. Get them with /costar-keys in the track Discord.")
    return SourceStatus(provider="Matterport", layer="interior", state="limited", is_sponsor_source=True,
                        detail="Model identity, rooms, 3D tour and doorway openings from the floor plan where Matterport drew one "
                               "(32 of 80 sampled scans). Limited: an opening is the frame gap, not clear width, so it can flag a "
                               "narrow doorway but never pass one.",
                        features=["model identity", "rooms and dimensions", "doorway openings", "3D tour embed"])


async def fetch_model(client: httpx.AsyncClient, property_id: str, model_id: str) -> tuple[Evidence, dict[str, Any]]:
    auth = _auth()
    if not auth:
        raise PermissionError("Matterport credentials not configured")
    r = await client.post(URL, json={"query": BASICS, "variables": {"id": model_id}}, auth=auth, timeout=30)
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise ValueError(f"Matterport GraphQL error: {body['errors'][0].get('message', 'unknown')}")
    m = (body.get("data") or {}).get("model")
    if not m:
        raise LookupError(f"Matterport model {model_id} not found or not visible to this key")

    edge_types = Counter(e.get("type") or "unknown" for f in m.get("floors") or [] for e in f.get("edges") or [])
    rooms = [
        {"label": (rm.get("classifications") or [{}])[0].get("label"), **(rm.get("dimensions") or {})}
        for rm in m.get("rooms") or []
    ]
    geo = m.get("geolocation") or {}
    summary = {
        "model_id": m["id"], "name": m.get("name"),
        "address": (m.get("address") or {}).get("address"),
        "lat": float(geo["lat"]) if geo.get("lat") else None,
        "lon": float(geo["long"]) if geo.get("long") else None,
        "classifications": [c.get("classification") for c in m.get("propertyClassifications") or []],
        "floors": len(m.get("floors") or []), "rooms": rooms, "panos": len(m.get("panoLocations") or []),
        "wall_graph_edge_types": dict(edge_types), "visibility": m.get("visibility"),
        "has_floor_plan": sum(edge_types.values()) > 0, "doorways": doorways(m),
    }
    public = m.get("visibility") in ("public", "unlisted")
    evidence = Evidence(
        id=f"ev_matterport_{property_id}", property_id=property_id, provider="Matterport",
        provider_asset_id=m["id"], asset_type="tour", capture_date=None, retrieved_at=now_iso(),
        view_url=f"https://my.matterport.com/show/?m={m['id']}" if public else None,
        geometry={"summary": summary},
        rights="Matterport, HackPrinceton 2026 hackathon use only",
        quality=("Doorway widths are the openings drawn in Matterport's floor plan (the frame gap), not clear width "
                 "with the door open. Room dimensions are context only."
                 if summary["doorways"] else
                 "This scan has no doorways in its floor plan, so no door can be screened from it. Room dimensions are context only."),
        notes="'created' is the date the model was copied into the hackathon org, not the capture date.",
        is_sponsor_source=True,
    )
    return evidence, summary


OVERVIEW = """query Overview($id: ID!) { model(id: $id) {
  id name propertyClassifications { classification }
  floors { edges { openings { type } } }
  rooms { classifications { label } }
} }"""

M_TO_IN = 1 / 0.0254


async def _query(client: httpx.AsyncClient, query: str, model_id: str) -> dict[str, Any]:
    auth = _auth()
    if not auth:
        raise PermissionError("Matterport credentials not configured")
    r = await client.post(URL, json={"query": query, "variables": {"id": model_id}}, auth=auth, timeout=30)
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise ValueError(f"Matterport GraphQL error: {body['errors'][0].get('message', 'unknown')}")
    m = (body.get("data") or {}).get("model")
    if not m:
        raise LookupError(f"Matterport model {model_id} not found or not visible to this key")
    return m


async def scan_overview(client: httpx.AsyncClient, model_id: str) -> dict[str, Any]:
    """A light look at one scan so an agent can choose which to load: name, kind, floor plan, doorways."""
    m = await _query(client, OVERVIEW, model_id)
    kinds = Counter(o.get("type") for f in m.get("floors") or [] for e in f.get("edges") or [] for o in e.get("openings") or [])
    edges = sum(len(f.get("edges") or []) for f in m.get("floors") or [])
    rooms = Counter((rm.get("classifications") or [{}])[0].get("label") or "unlabelled" for rm in m.get("rooms") or [])
    return {"model_id": m["id"], "name": m.get("name"),
            "classifications": [c.get("classification") for c in m.get("propertyClassifications") or []],
            "has_floor_plan": edges > 0, "doorways": kinds.get("doorway", 0),
            "room_labels": dict(rooms.most_common(6))}


def doorways(model: dict[str, Any]) -> list[dict[str, Any]]:
    """Every doorway opening in a fetched model's floor plan, widths converted to inches (narrowest first)."""
    out = []
    for fi, f in enumerate(model.get("floors") or []):
        for e in f.get("edges") or []:
            for o in e.get("openings") or []:
                if o.get("type") != "doorway":
                    continue
                w = o.get("width")
                out.append({
                    "opening_id": str(o.get("id")), "floor": f.get("label") or f"Floor {fi + 1}",
                    "kind": o.get("label") or "door-unknown",
                    "width_in": round(w * M_TO_IN, 1) if isinstance(w, (int, float)) else None,
                    "wall_thickness_in": round(e["thickness"] * M_TO_IN, 1) if isinstance(e.get("thickness"), (int, float)) else None,
                })
    return sorted(out, key=lambda d: (d["width_in"] is None, d["width_in"] or 0))
