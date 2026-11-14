"""Vexcel orthophoto adapter (HackPrinceton 2026 key: Houston and Los Angeles only).

Request shape taken from the hackathon Matterport quickstart, section 7:
POST https://api.vexcelgroup.com/v2/ortho/extract with the key in the X-API-KEY header.
NOT YET VERIFIED with a real key from this codebase.

The image is fetched server-side and proxied; the key never reaches the browser.
"""
from __future__ import annotations

import os

import httpx

from ..models import Evidence, SourceStatus, now_iso
from .usgs import bbox

URL = "https://api.vexcelgroup.com/v2/ortho/extract"
HALF_SIZE_M = 70.0
IMAGE_PX = 1400


def _key() -> str | None:
    return os.environ.get("VEXCEL_API_KEY") or None


def status() -> SourceStatus:
    if not _key():
        return SourceStatus(provider="Vexcel", layer="aerial", state="unavailable", is_sponsor_source=True,
                            detail="No VEXCEL_API_KEY set. Get one with /costar-keys in the track Discord.")
    return SourceStatus(provider="Vexcel", layer="aerial", state="limited", is_sponsor_source=True,
                        detail="Key present. Ortho extract wired; not yet verified against a live response. Houston/LA only.",
                        features=["orthophoto about 7.5 cm/pixel"])


def _body(lat: float, lon: float) -> dict:
    xmin, ymin, xmax, ymax = bbox(lat, lon, HALF_SIZE_M)
    wkt = f"POLYGON(({xmin} {ymin},{xmax} {ymin},{xmax} {ymax},{xmin} {ymax},{xmin} {ymin}))"
    return {"wkt": wkt, "srid": 4326, "layer": "urban,urban-r,wide-area,urban-g", "crop": "bounding_box",
            "image-format": "jpeg", "destination-dimensions": f"{IMAGE_PX},{IMAGE_PX}", "attribution": "false"}


async def fetch_image(client: httpx.AsyncClient, lat: float, lon: float) -> bytes:
    key = _key()
    if not key:
        raise PermissionError("VEXCEL_API_KEY not configured")
    r = await client.post(URL, json=_body(lat, lon), headers={"X-API-KEY": key}, timeout=40)
    if r.status_code == 403:
        raise PermissionError("Vexcel returned 403: outside Houston/Los Angeles coverage or key not entitled")
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image/"):
        raise ValueError("Vexcel response was not an image")
    return r.content


async def fetch_aerial(client: httpx.AsyncClient, audit_id: str, property_id: str, lat: float, lon: float) -> Evidence:
    """Confirm an image can be fetched for the point, then return Evidence that points at our proxy route."""
    await fetch_image(client, lat, lon)
    ev_id = f"ev_vexcel_{property_id}"
    return Evidence(
        id=ev_id, property_id=property_id, provider="Vexcel", asset_type="aerial_image",
        capture_date=None, retrieved_at=now_iso(),
        view_url=f"/api/audits/{audit_id}/evidence/{ev_id}/image",
        geometry={"bbox_wgs84": list(bbox(lat, lon, HALF_SIZE_M)), "center": {"lat": lat, "lon": lon}},
        scale={"display_m_per_px": round(2 * HALF_SIZE_M / IMAGE_PX, 3), "note": "Provider states about 7.5 cm/pixel ortho"},
        coordinate_reference_system="EPSG:4326 bounding box",
        rights="Vexcel, HackPrinceton 2026 hackathon use only",
        quality="High-resolution orthophoto. Capture date not yet retrieved from Vexcel metadata.",
        notes="Sponsor imagery fetched live and not stored. Publication rights must be confirmed before screenshots are shared.",
        is_sponsor_source=True,
    )
