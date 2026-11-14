"""USGS NAIP public aerial imagery. A PUBLIC FALLBACK, never presented as Vexcel imagery.

Resolution (0.3-0.6 m/pixel) supports context and rough stall counting at best; it cannot
support inch-scale dimensions.
"""
from __future__ import annotations

from datetime import datetime, timezone
from math import cos, radians
from urllib.parse import urlencode

import httpx

from ..models import Evidence, SourceStatus, now_iso

BASE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer"
HALF_SIZE_M = 90.0
IMAGE_PX = 1000


def status() -> SourceStatus:
    return SourceStatus(
        provider="USGS NAIP", layer="aerial", state="limited", is_sponsor_source=False,
        detail="Public fallback imagery. Coarse (about 0.3-0.6 m/pixel): context only, no dimensions.",
        features=["orthophoto", "acquisition date"],
    )


def bbox(lat: float, lon: float, half_m: float = HALF_SIZE_M) -> tuple[float, float, float, float]:
    dlat = half_m / 111_320.0
    dlon = half_m / (111_320.0 * cos(radians(lat)))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def image_url(lat: float, lon: float) -> str:
    xmin, ymin, xmax, ymax = bbox(lat, lon)
    q = urlencode({
        "bbox": f"{xmin},{ymin},{xmax},{ymax}", "bboxSR": 4326, "imageSR": 3857,
        "size": f"{IMAGE_PX},{IMAGE_PX}", "format": "jpgpng", "f": "image",
    })
    return f"{BASE}/exportImage?{q}"


def _date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()
    return str(value)[:10]


async def fetch_aerial(client: httpx.AsyncClient, property_id: str, lat: float, lon: float) -> Evidence:
    """Look up the newest NAIP scene covering the point and return an Evidence record for it."""
    params = {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "where": "Category = 1",
        "outFields": "Name,Year,acquisition_date,resolution_value,resolution_units",
        "returnGeometry": "false", "orderByFields": "Year DESC", "f": "json",
    }
    r = await client.get(f"{BASE}/query", params=params, timeout=20)
    r.raise_for_status()
    features = r.json().get("features", [])
    if not features:
        raise LookupError("No NAIP scene covers this point")
    a = features[0]["attributes"]
    capture = _date(a.get("acquisition_date")) or (str(a["Year"]) if a.get("Year") else None)
    res, units = a.get("resolution_value"), a.get("resolution_units")
    return Evidence(
        id=f"ev_usgs_{property_id}", property_id=property_id, provider="USGS NAIP",
        provider_asset_id=a.get("Name"), asset_type="aerial_image", capture_date=capture,
        retrieved_at=now_iso(), view_url=image_url(lat, lon),
        geometry={"bbox_wgs84": list(bbox(lat, lon)), "center": {"lat": lat, "lon": lon}},
        scale={"native_resolution": res, "units": units, "display_m_per_px": round(2 * HALF_SIZE_M / IMAGE_PX, 3)},
        coordinate_reference_system="EPSG:3857 (requested by WGS84 bounding box)",
        rights="USGS/USDA NAIP, public domain",
        quality="Coarse public orthophoto. Suitable for context; not for measuring stalls, aisles, slopes or doors.",
        notes="Public fallback. This is not Vexcel imagery.",
        is_sponsor_source=False,
    )
