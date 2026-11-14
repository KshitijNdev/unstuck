"""Matterport Model API adapter (GraphQL, HTTP basic auth: API key as user, token as password).

Queries taken from the HackPrinceton 2026 quickstart. NOT YET VERIFIED with a real key here.

What this can and cannot support:
  * Room dimensions and the wall graph are context. They are NOT door clear widths.
  * Wall-graph edges carry a `type`; we report the edge types found so a person can check
    whether door openings are exposed. Nothing is screened from them automatically.
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
  floors { id label edges { id type thickness } }
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
                        detail="Key present. Model basics and rooms wired; door clear width is not available from this data.",
                        features=["model identity", "rooms and dimensions", "wall graph", "3D tour embed"])


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
    }
    public = m.get("visibility") in ("public", "unlisted")
    evidence = Evidence(
        id=f"ev_matterport_{property_id}", property_id=property_id, provider="Matterport",
        provider_asset_id=m["id"], asset_type="tour", capture_date=None, retrieved_at=now_iso(),
        view_url=f"https://my.matterport.com/show/?m={m['id']}" if public else None,
        geometry={"summary": summary},
        rights="Matterport, HackPrinceton 2026 hackathon use only",
        quality="Room dimensions and wall graph are context only. They are not door clear widths.",
        notes="'created' is the date the model was copied into the hackathon org, not the capture date.",
        is_sponsor_source=True,
    )
    return evidence, summary
