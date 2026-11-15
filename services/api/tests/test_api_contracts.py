import os

import pytest
from fastapi.testclient import TestClient

os.environ["UNSTUCK_STEP_DELAY"] = "0"
for k in ("VEXCEL_API_KEY", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN", "COSTAR_KIT_DIR", "ANTHROPIC_API_KEY"):
    os.environ[k] = ""

from app import store  # noqa: E402
from app.main import app  # noqa: E402
from app.providers import usgs  # noqa: E402

FIXTURE = {"property_id": "property_demo_001", "mode": "single_property",
           "standard_profile": "ADA_2010_SCREEN", "allow_synthetic_fixture": True}


@pytest.fixture()
def client(tmp_path):
    store.reset(str(tmp_path / "test.sqlite"))
    with TestClient(app) as c:
        yield c
    store.reset()


def run_fixture(client):
    r = client.post("/api/audits", json=FIXTURE)
    assert r.status_code == 202 and r.json()["status"] == "QUEUED"
    return r.json()["audit_id"]


def by_key(findings):
    return {(f["rule_id"], f["location_id"]): f for f in findings}


def test_fixture_audit_end_to_end(client):
    aid = run_fixture(client)
    audit = client.get(f"/api/audits/{aid}").json()
    assert audit["status"] == "COMPLETE" and audit["is_synthetic"] is True
    assert audit["engine"] == "scripted_pipeline"
    types = [e["type"] for e in audit["events"]]
    assert types[0] == "PLANNED" and types[-1] == "REPORT_READY"
    assert "SOURCE_MISSING" in types and "RULE_EVALUATED" in types and "REVIEW_REQUESTED" in types

    f = by_key(client.get(f"/api/audits/{aid}/findings").json()["findings"])
    assert f[("ADA_2010_208_2", "lot_main")]["status"] == "NUMERIC_SCREEN_FAIL"
    assert f[("ADA_2010_208_2_4", "lot_main")]["status"] == "NUMERIC_SCREEN_PASS"
    assert f[("ADA_2010_404_2_3", "door_suite_b")]["status"] == "NUMERIC_SCREEN_PASS"
    assert f[("ADA_2010_404_2_3", "door_entrance")]["status"] == "FIELD_VERIFICATION_REQUIRED"
    assert f[("ADA_2010_303", "side_entrance")]["status"] == "SUSPECTED_VISUAL_BARRIER"
    for finding in f.values():
        assert finding["is_synthetic"] is True
        assert finding["legal_compliance_determination"] is False
    assert f[("ADA_2010_208_2", "lot_main")]["confidence"] == "DEMO_SYNTHETIC"


def test_fixture_requires_opt_in(client):
    r = client.post("/api/audits", json={**FIXTURE, "allow_synthetic_fixture": False})
    assert r.status_code == 400


def test_measurement_flips_finding_and_review_gate(client):
    aid = run_fixture(client)
    fid = f"{aid}__ADA_2010_404_2_3__door_entrance"
    # cannot approve something with no measurement behind it
    r = client.post(f"/api/findings/{fid}/verify", json={"action": "approve", "reviewer": "Tester"})
    assert r.status_code == 409

    m = {"location_id": "door_entrance", "name": "door_clear_width_in", "value": 30, "unit": "in",
         "method": "field", "reviewed_by": "Tester"}
    r = client.post(f"/api/audits/{aid}/measurements", json=m)
    assert r.status_code == 200
    f = by_key(r.json()["findings"])[("ADA_2010_404_2_3", "door_entrance")]
    assert f["status"] == "NUMERIC_SCREEN_FAIL" and f["label"] == "measured"
    assert f["confidence"] == "FIELD_MEASURED" and f["required"]["value"] == 32

    r = client.post(f"/api/findings/{fid}/verify", json={"action": "approve", "reviewer": "Tester"})
    assert r.status_code == 200 and r.json()["review_status"] == "APPROVED"
    events = client.get(f"/api/audits/{aid}").json()["events"]
    assert events[-1]["type"] == "FINDING_APPROVED"


def test_measurement_validation(client):
    aid = run_fixture(client)
    base = {"reviewed_by": "Tester", "method": "field"}
    bad = [
        {"location_id": "door_entrance", "name": "door_clear_width_in", "value": 30, "unit": "cm"},
        {"location_id": "lot_main", "name": "door_clear_width_in", "value": 30, "unit": "in"},
        {"location_id": "lot_main", "name": "parking_total_spaces", "value": 10.5, "unit": "spaces"},
        {"location_id": "lot_main", "name": "ramp_slope", "value": 1, "unit": "in"},
        {"location_id": "lot_main", "name": "parking_accessible_spaces", "value": 500, "unit": "spaces"},
    ]
    for m in bad:
        assert client.post(f"/api/audits/{aid}/measurements", json={**base, **m}).status_code == 400, m
    # people cannot submit machine or synthetic methods
    r = client.post(f"/api/audits/{aid}/measurements", json={"location_id": "door_entrance", "name": "door_clear_width_in",
                                                              "value": 30, "unit": "in", "method": "image_estimate", "reviewed_by": "T"})
    assert r.status_code == 422
    # a rejected measurement leaves no trace
    assert len(client.get(f"/api/audits/{aid}").json()["measurements"]) == 5


def test_custom_property_needs_authorization_and_never_invents(client, monkeypatch):
    async def no_network(*a, **k):
        raise LookupError("No NAIP scene covers this point")
    monkeypatch.setattr(usgs, "fetch_aerial", no_network)

    body = {"custom_property": {"name": "Test Shop", "lat": 34.05, "lon": -118.25},
            "standard_profile": "ADA_2010_SCREEN"}
    assert client.post("/api/audits", json=body).status_code == 403
    r = client.post("/api/audits", json={**body, "ownership_authorized": True})
    assert r.status_code == 202
    audit = client.get(f"/api/audits/{r.json()['audit_id']}").json()
    assert audit["status"] == "COMPLETE" and audit["is_synthetic"] is False
    assert audit["property"]["year_built"] is None and audit["property"]["type"] is None
    assert audit["evidence"] == [] and audit["measurements"] == []
    assert {f["status"] for f in audit["findings"]} == {"FIELD_VERIFICATION_REQUIRED"}
    assert all(f["observed"] is None for f in audit["findings"])
    assert "FETCH_FAILURE" in [e["type"] for e in audit["events"]]


def test_sources_status_reports_sponsors_unavailable_without_keys(client):
    sources = {s["provider"]: s for s in client.get("/api/sources/status").json()["sources"]}
    for sponsor in ("CoStar", "Vexcel", "Matterport"):
        assert sources[sponsor]["state"] == "unavailable" and sources[sponsor]["is_sponsor_source"] is True
    assert sources["USGS NAIP"]["is_sponsor_source"] is False


def test_export_and_events_stream(client):
    aid = run_fixture(client)
    export = client.get(f"/api/audits/{aid}/export").json()
    assert export["legal_compliance_determination"] is False and export["contains_synthetic_data"] is True
    assert "not a certified ADA inspection" in export["disclaimer"]
    text = client.get(f"/api/audits/{aid}/events").text
    assert "event: agent_event" in text and text.rstrip().endswith('{"status": "COMPLETE"}')
    assert client.get("/api/audits/nope").status_code == 404
    assert client.post("/api/audits", json={**FIXTURE, "standard_profile": "TITLE_24"}).status_code == 400


def test_markups_become_counts_and_evidence(client, monkeypatch):
    from app.models import Evidence, Measurement

    async def fake_aerial(client_, property_id, lat, lon):
        return Evidence(id="ev_test_aerial", property_id=property_id, provider="USGS NAIP", asset_type="aerial_image")
    monkeypatch.setattr(usgs, "fetch_aerial", fake_aerial)
    r = client.post("/api/audits", json={"custom_property": {"name": "Shop", "lat": 34.05, "lon": -118.25},
                                         "standard_profile": "ADA_2010_SCREEN", "ownership_authorized": True})
    aid = r.json()["audit_id"]
    total = {"location_id": "lot_main", "name": "parking_total_spaces", "value": 63, "unit": "spaces",
             "method": "manual", "reviewed_by": "T"}
    assert client.post(f"/api/audits/{aid}/measurements", json=total).status_code == 200

    pins = [{"x": 0.2, "y": 0.3, "kind": "accessible"}, {"x": 0.25, "y": 0.3, "kind": "van"}]
    r = client.post(f"/api/audits/{aid}/markups", json={"pins": pins, "reviewed_by": "T"})
    assert r.status_code == 200
    assert len(r.json()["evidence"]["geometry"]["pins"]) == 2
    f = by_key(r.json()["findings"])
    assert f[("ADA_2010_208_2", "lot_main")]["status"] == "NUMERIC_SCREEN_FAIL"       # 2 marked, 3 required
    assert f[("ADA_2010_208_2", "lot_main")]["observed"]["value"] == 2
    assert f[("ADA_2010_208_2_4", "lot_main")]["status"] == "NUMERIC_SCREEN_PASS"     # 1 van, 1 required
    assert f[("ADA_2010_208_2", "lot_main")]["confidence"] == "MANUAL_ENTRY"

    # zero marks is a real answer, not "unknown"
    r = client.post(f"/api/audits/{aid}/markups", json={"pins": [], "reviewed_by": "T"})
    assert by_key(r.json()["findings"])[("ADA_2010_208_2", "lot_main")]["observed"]["value"] == 0
    assert client.post(f"/api/audits/{aid}/markups", json={"pins": [{"x": 2, "y": 0, "kind": "van"}], "reviewed_by": "T"}).status_code == 422


def test_markups_need_an_image_and_model_must_be_linked(client):
    aid = run_fixture(client)   # synthetic fixture has a schematic, not an aerial image
    assert client.post(f"/api/audits/{aid}/markups", json={"pins": [], "reviewed_by": "T"}).status_code == 404
    assert client.post(f"/api/audits/{aid}/model", json={"model_id": "abcdef123"}).status_code == 400


def test_stall_suggestions_drop_low_confidence_and_bad_entries():
    from app.agents import stalls

    text = """Here you go: {"stalls":[
      {"x":0.2,"y":0.3,"kind":"accessible","cue":"blue square","confidence":"high"},
      {"x":0.5,"y":0.5,"kind":"van","cue":"wide aisle","confidence":"medium"},
      {"x":0.7,"y":0.7,"kind":"accessible","cue":"car near hatching","confidence":"low"},
      {"x":1.4,"y":0.1,"kind":"accessible","cue":"off image","confidence":"high"},
      {"y":0.1,"kind":"accessible","confidence":"high"}],
      "notes":"Shadows along the storefront."}"""
    found, notes = stalls.parse(text)
    assert [(s["x"], s["kind"]) for s in found] == [(0.2, "accessible"), (0.5, "van")]
    assert notes == "Shadows along the storefront."


def test_stall_suggestions_reject_unreadable_reply():
    import pytest
    from app.agents import stalls

    with pytest.raises(ValueError):
        stalls.parse("I could not see any stalls.")
