"""Gemini candidate service: coordinate conversion, validation, rights gate and the review-to-count flow.
No network: the image fetch and the model call are replaced with local stand-ins."""
import io
import json
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

os.environ["UNSTUCK_STEP_DELAY"] = "0"
for k in ("VEXCEL_API_KEY", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN", "COSTAR_KIT_DIR", "ANTHROPIC_API_KEY",
          "VEXCEL_ALLOW_AI_PROCESSING"):
    os.environ[k] = ""

from app import store  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Evidence  # noqa: E402
from app.routes import vision as vroute  # noqa: E402
from app.vision import gemini  # noqa: E402
from app.vision.gemini import View, merge, parse, to_image_box, views  # noqa: E402

FULL = View("full frame", 0, 0, 1, 1)


def test_box_2d_is_ymin_xmin_ymax_xmax_in_thousandths():
    assert to_image_box([200, 700, 350, 800], FULL) == {"x": 0.7, "y": 0.2, "w": 0.1, "h": 0.15}


def test_crop_boxes_map_back_to_the_full_image():
    crop = View("crop 4 of 4", 0.4, 0.4, 0.6, 0.6)
    b = to_image_box([450, 450, 550, 550], crop)
    assert b == {"x": 0.67, "y": 0.67, "w": 0.06, "h": 0.06}


@pytest.mark.parametrize("box", [[500, 100, 400, 200], [100, 500, 200, 400], [-1, 0, 10, 10], [0, 0, 10, 1001],
                                 [0, 0, 900, 900], [1, 2, 3]])
def test_invalid_boxes_are_rejected(box):
    assert to_image_box(box, FULL) is None


def test_views_add_overlapping_crops_for_large_images():
    assert len(views(1000, 1000)) == 5 and len(views(400, 400)) == 1
    assert all(v.x0 + v.w <= 1 and v.y0 + v.h <= 1 for v in views(1000, 1000))


def test_parse_counts_rejected_boxes_and_rejects_malformed_json():
    text = json.dumps({"detections": [
        {"category": "accessible_symbol", "box_2d": [100, 100, 150, 140], "confidence": "high", "note": "white pictogram"},
        {"category": "curb_ramp", "box_2d": [600, 600, 500, 700], "confidence": "low", "note": "reversed box"},
    ], "image_notes": "clear day"})
    found, rejected, notes = parse(text, FULL)
    assert len(found) == 1 and rejected == 1 and notes == "clear day"
    assert found[0]["box"] == {"x": 0.1, "y": 0.1, "w": 0.04, "h": 0.05}
    with pytest.raises(gemini.VisionError) as e:
        parse('{"detections": [{"category": "door_width", "box_2d": [0,0,1,1], "confidence": "high", "note": ""}]}', FULL)
    assert e.value.kind == "malformed"
    with pytest.raises(gemini.VisionError):
        parse("not json", FULL)


def test_merge_keeps_one_of_overlapping_same_category_boxes():
    a = {"category": "parking_stall", "box": {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1}, "confidence": "low"}
    b = {"category": "parking_stall", "box": {"x": 0.11, "y": 0.1, "w": 0.1, "h": 0.1}, "confidence": "high"}
    c = {"category": "access_aisle", "box": {"x": 0.11, "y": 0.1, "w": 0.1, "h": 0.1}, "confidence": "low"}
    out = merge([a, b, c])
    assert len(out) == 2 and b in out and c in out


def test_vexcel_is_not_sent_without_permission_but_naip_is():
    base = dict(id="e", property_id="p", asset_type="aerial_image")
    assert vroute.ai_permitted(Evidence(provider="USGS NAIP", **base))[0] is True
    ok, reason = vroute.ai_permitted(Evidence(provider="Vexcel", is_sponsor_source=True, **base))
    assert ok is False and "third-party AI" in reason
    assert vroute.ai_permitted(Evidence(provider="Fixture", is_synthetic=True, **{**base, "asset_type": "schematic"}))[0] is False


@pytest.fixture()
def client(tmp_path, monkeypatch):
    store.reset(str(tmp_path / "v.sqlite"))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    with TestClient(app) as c:
        yield c
    store.reset()


def _audit_with_naip(client):
    aid = client.post("/api/audits", json={"property_id": "property_demo_001", "standard_profile": "ADA_2010_SCREEN",
                                           "allow_synthetic_fixture": True}).json()["audit_id"]
    audit = store.get(aid)
    audit.property.lat, audit.property.lon = 40.35, -74.66
    audit.evidence.append(Evidence(id="ev_naip", property_id=audit.property_id, provider="USGS NAIP",
                                   asset_type="aerial_image", view_url="https://example.invalid/naip.jpg"))
    store.save(audit)
    return aid


def _stub(monkeypatch, size, ask):
    buf = io.BytesIO()
    Image.new("RGB", size, (80, 80, 80)).save(buf, "JPEG")

    async def fake_bytes(audit, ev):
        return buf.getvalue()

    monkeypatch.setattr(vroute, "_image_bytes", fake_bytes)
    monkeypatch.setattr(gemini, "_ask", ask)
    monkeypatch.setattr("google.genai.Client", lambda **kw: object())


def test_analysis_review_and_apply_flow(client, monkeypatch):
    aid = _audit_with_naip(client)
    answers = iter([json.dumps({"detections": [
        {"category": "parking_stall", "box_2d": [100, 100, 200, 160], "confidence": "high", "note": "blue-painted stall"},
        {"category": "accessible_symbol", "box_2d": [120, 110, 160, 150], "confidence": "medium", "note": "pictogram"}]})]
                   + [json.dumps({"detections": []})] * 4)

    async def fake_ask(_client, _data):
        return next(answers)

    _stub(monkeypatch, (1000, 1000), fake_ask)
    assert client.post(f"/api/audits/{aid}/analysis", json={"evidence_id": "ev_naip"}).status_code == 202
    ev = next(e for e in client.get(f"/api/audits/{aid}").json()["evidence"] if e["id"] == "ev_naip")
    ai = ev["geometry"]["ai"]
    assert ai["status"] == "complete" and ai["image_width"] == 1000 and len(ai["views"]) == 5
    cats = {c["category"]: c for c in ai["candidates"]}
    assert set(cats) == {"parking_stall", "accessible_symbol"}
    assert all(c["status"] == "suggested" for c in ai["candidates"])
    assert not [m for m in store.get(aid).measurements if m.evidence_id == "ev_naip"]  # suggestions change nothing

    stall, sym = cats["parking_stall"], cats["accessible_symbol"]
    r = client.post(f"/api/audits/{aid}/candidates/{stall['id']}", json={"action": "accept", "reviewer": "QA", "van": True})
    assert r.json()["status"] == "accepted" and r.json()["van"] is True
    r = client.post(f"/api/audits/{aid}/candidates/{sym['id']}", json={"action": "reject", "reviewer": "QA"})
    assert r.json()["status"] == "rejected"

    r = client.post(f"/api/audits/{aid}/candidates/apply", json={"evidence_id": "ev_naip", "reviewer": "QA"})
    assert r.status_code == 200
    assert r.json()["evidence"]["geometry"]["pins"] == [{"x": 0.13, "y": 0.15, "kind": "van", "candidate_id": stall["id"]}]
    m = [x for x in store.get(aid).measurements if x.evidence_id == "ev_naip"]
    assert {(x.name, x.value) for x in m} == {("parking_accessible_spaces", 1), ("parking_van_spaces", 1)}

    saved = next(e for e in client.get(f"/api/audits/{aid}").json()["evidence"] if e["id"] == "ev_naip")
    assert {c["status"] for c in saved["geometry"]["ai"]["candidates"]} == {"accepted", "rejected"}


def test_vexcel_analysis_is_refused_with_a_reason(client):
    aid = _audit_with_naip(client)
    audit = store.get(aid)
    audit.evidence.append(Evidence(id="ev_vx", property_id=audit.property_id, provider="Vexcel", asset_type="aerial_image",
                                   is_sponsor_source=True))
    store.save(audit)
    r = client.post(f"/api/audits/{aid}/analysis", json={"evidence_id": "ev_vx"})
    assert r.status_code == 403 and "third-party AI" in r.json()["detail"]


def test_model_errors_are_recorded_not_raised(client, monkeypatch):
    aid = _audit_with_naip(client)

    async def rate_limited(_client, _data):
        raise gemini.VisionError("rate_limited", "Gemini rate limit reached. Try again in a minute.")

    calls = []

    async def counted(c, d):
        calls.append(1)
        await rate_limited(c, d)

    monkeypatch.setattr(gemini, "RETRY_WAIT_S", 0)
    _stub(monkeypatch, (500, 500), counted)
    client.post(f"/api/audits/{aid}/analysis", json={"evidence_id": "ev_naip"})
    ai = next(e for e in store.get(aid).evidence if e.id == "ev_naip").geometry["ai"]
    assert ai["status"] == "failed" and ai["error"]["kind"] == "rate_limited"
    assert len(calls) == 3  # retried twice before giving up


def test_integration_states_never_claim_success_from_a_key(client, monkeypatch):
    from app import integrations
    integrations.LAST.clear()
    monkeypatch.setenv("VEXCEL_API_KEY", "set-but-unchecked")
    rows = {r["provider"]: r for r in client.get("/api/sources/status").json()["integrations"]}
    assert rows["vexcel"]["state"] == "configured"           # a key alone is not "verified"
    assert rows["claude"]["state"] == "unavailable"          # no Anthropic key in tests
    assert rows["gemini"]["state"] == "configured" and rows["gemini"]["model"]
    assert all("key" not in str(r.get("detail", "")).lower() or "set" in r["detail"].lower() for r in rows.values())

    async def boom(provider):
        raise ConnectionError("refused")

    monkeypatch.setattr(integrations, "_probe", boom)
    r = client.post("/api/integrations/vexcel/check").json()
    assert r["state"] == "failed" and "ConnectionError" in r["check_detail"] and r["checked_at"]

    async def ok(provider):
        return "Orthophoto returned (10 KB)"

    monkeypatch.setattr(integrations, "_probe", ok)
    assert client.post("/api/integrations/vexcel/check").json()["state"] == "verified"
    assert client.post("/api/integrations/nope/check").status_code == 404
    integrations.LAST.clear()
