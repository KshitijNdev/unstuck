"""Vexcel orthophoto adapter (HackPrinceton 2026 key: geofenced, see GEOFENCE).

Request shape taken from the hackathon Matterport quickstart, section 7:
POST https://api.vexcelgroup.com/v2/ortho/extract with the key in the X-API-KEY header.
Verified with a hackathon key on 14 Nov 2026.

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


# Hackathon key geofence, as posted by Vexcel staff in the track Discord on 14 Nov 2026.
# Requests outside these polygons get a 403 "geofence" error. Rings are (lon, lat).
GEOFENCE: dict[str, list[tuple[float, float]]] = {
    "Los Angeles": [(-119.0134, 33.0945), (-116.8949, 33.0945), (-116.8949, 34.3154), (-119.0134, 34.3154)],
    "Houston": [(-96.2185, 29.0173), (-94.5758, 29.0173), (-94.5758, 30.3804), (-96.2185, 30.3804)],
    "Northern California": [(-124.7437, 38.0655), (-118.9869, 38.0655), (-118.9869, 41.9596), (-124.7437, 41.9596)],
    "Florida Panhandle": [(-88.2145, 30.8016), (-88.3285, 30.132), (-86.2124, 30.2269), (-85.5125, 29.6277),
                          (-84.8004, 29.5039), (-84.9062, 30.7876)],
    # Added later on 14 Nov 2026: a box around the Princeton campus.
    "Princeton": [(-74.6943406774712, 40.31565454915983), (-74.59812447568899, 40.31565454915983),
                  (-74.59812447568899, 40.3713908156042), (-74.6943406774712, 40.3713908156042)],
}
REGIONS = ", ".join(GEOFENCE)


def _inside(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """Ray casting point-in-polygon."""
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def geofence_region(lat: float, lon: float) -> str | None:
    """Name of the region whose polygon holds the whole request box, or None if the request would be refused."""
    xmin, ymin, xmax, ymax = bbox(lat, lon, HALF_SIZE_M)
    corners = [(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)]
    for name, ring in GEOFENCE.items():
        if all(_inside(x, y, ring) for x, y in corners):
            return name
    return None


def _key() -> str | None:
    return os.environ.get("VEXCEL_API_KEY") or None


def status() -> SourceStatus:
    if not _key():
        return SourceStatus(provider="Vexcel", layer="aerial", state="unavailable", is_sponsor_source=True,
                            detail="No VEXCEL_API_KEY set. Get one with /costar-keys in the track Discord.")
    return SourceStatus(provider="Vexcel", layer="aerial", state="connected", is_sponsor_source=True,
                        detail=f"Orthophoto extract working inside the hackathon geofence ({REGIONS}). Capture date is not retrieved yet.",
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
    if geofence_region(lat, lon) is None:  # don't spend a call we know will be refused
        raise PermissionError(f"site is outside the Vexcel hackathon geofence ({REGIONS}); not requested")
    r = await client.post(URL, json=_body(lat, lon), headers={"X-API-KEY": key}, timeout=40)
    if r.status_code == 403:
        raise PermissionError(f"Vexcel returned 403 (geofence or key not entitled). Covered regions: {REGIONS}")
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
