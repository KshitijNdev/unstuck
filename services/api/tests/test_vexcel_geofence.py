import asyncio

import pytest

from app.providers import vexcel


@pytest.mark.parametrize("lat,lon,region", [
    (34.0522, -118.2437, "Los Angeles"),
    (29.7604, -95.3698, "Houston"),
    (38.5816, -121.4944, "Northern California"),  # Sacramento
    (30.4213, -87.2169, "Florida Panhandle"),     # Pensacola
    (40.3573, -74.6672, None),                   # Princeton
    (40.7128, -74.0060, None),                   # New York
    (32.7767, -96.7970, None),                   # Dallas
])
def test_geofence_region(lat, lon, region):
    assert vexcel.geofence_region(lat, lon) == region


def test_box_straddling_edge_is_refused():
    # Center just inside the LA box's north edge: the 70 m half-box pokes out.
    assert vexcel.geofence_region(34.3150, -118.0) is None


def test_outside_geofence_never_calls_api(monkeypatch):
    monkeypatch.setenv("VEXCEL_API_KEY", "test")

    class Boom:
        async def post(self, *a, **k):
            raise AssertionError("should not call Vexcel")

    with pytest.raises(PermissionError, match="geofence"):
        asyncio.run(vexcel.fetch_image(Boom(), 40.3573, -74.6672))
