import asyncio

import pytest

from app.providers import vexcel


@pytest.mark.parametrize("lat,lon,region", [
    (34.0522, -118.2437, "Los Angeles"),
    (29.7604, -95.3698, "Houston"),
    (38.5816, -121.4944, "Northern California"),  # Sacramento
    (30.4213, -87.2169, "Florida Panhandle"),     # Pensacola
    (40.3487, -74.6593, "Princeton"),            # Nassau Hall
    (40.2206, -74.7597, None),                   # Trenton, outside the Princeton box
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
        asyncio.run(vexcel.fetch_image(Boom(), 40.7128, -74.0060))


class _Resp:
    def __init__(self, status, json=None, ctype="application/json"):
        self.status_code, self._json, self.headers, self.content = status, json, {"content-type": ctype}, b"jpg"

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class _FakeVexcel:
    """Parcel metadata on GET; on POST, the layers each request asked for are recorded."""

    def __init__(self, meta_status=200, layer_ok=True):
        self.meta_status, self.layer_ok, self.layers = meta_status, layer_ok, []

    async def get(self, *a, **k):
        props = {"metadata.ortho-date-estimate": "2026-07-03T18:21:32", "metadata.layer-name": "urban-r",
                 "metadata.collection": "us-ca-la-2026", "structure.count": 1}  # flat keys, as the live API sends
        return _Resp(self.meta_status, {"features": [{"properties": props}]})

    async def post(self, url, json, **k):
        self.layers.append(json["layer"])
        if json["layer"] != vexcel.DEFAULT_LAYERS and not self.layer_ok:
            return _Resp(404)
        return _Resp(200, ctype="image/jpeg")


@pytest.fixture
def vx(monkeypatch):
    monkeypatch.setenv("VEXCEL_API_KEY", "test")
    vexcel._META.clear()
    yield
    vexcel._META.clear()


def test_capture_date_comes_from_parcel_metadata_and_matches_the_layer(vx):
    c = _FakeVexcel()
    ev = asyncio.run(vexcel.fetch_aerial(c, "a1", "p1", 34.0619, -118.2780))
    assert ev.capture_date == "2026-07-03"
    assert c.layers == ["urban-r"]            # the image comes from the layer the date belongs to
    assert "estimate" in ev.quality and ev.geometry["layer"] == "urban-r"


def test_no_parcel_means_unknown_date_not_a_guess(vx):
    c = _FakeVexcel(meta_status=404)
    ev = asyncio.run(vexcel.fetch_aerial(c, "a1", "p1", 34.0619, -118.2780))
    assert ev.capture_date is None and "unknown" in ev.quality
    assert c.layers == [vexcel.DEFAULT_LAYERS]


def test_dated_layer_failing_drops_the_date(vx):
    c = _FakeVexcel(layer_ok=False)
    ev = asyncio.run(vexcel.fetch_aerial(c, "a1", "p1", 34.0619, -118.2780))
    assert ev.capture_date is None              # image came from the default list, so the date may not apply
    assert c.layers == ["urban-r", vexcel.DEFAULT_LAYERS]
