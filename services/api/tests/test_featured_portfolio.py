"""Featured screenings (read-only originals, free copies) and portfolio triage. No provider or model is called."""
import os

import pytest
from fastapi.testclient import TestClient

os.environ["UNSTUCK_STEP_DELAY"] = "0"
for k in ("VEXCEL_API_KEY", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN", "COSTAR_KIT_DIR", "ANTHROPIC_API_KEY"):
    os.environ[k] = ""

from app import portfolio, store  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ModelUsage  # noqa: E402
from app.providers import costar  # noqa: E402

FIXTURE = {"property_id": "property_demo_001", "allow_synthetic_fixture": True}
DOOR = {"location_id": "door_entrance", "name": "door_clear_width_in", "value": 30, "unit": "in",
        "method": "field", "reviewed_by": "Tester"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("UNSTUCK_FEATURED_AUDITS", raising=False)
    store.reset(str(tmp_path / "test.sqlite"))
    with TestClient(app) as c:
        yield c
    store.reset()


def featured(client, monkeypatch):
    aid = client.post("/api/audits", json=FIXTURE).json()["audit_id"]
    monkeypatch.setenv("UNSTUCK_FEATURED_AUDITS", f"{aid}, audit_missing")
    return aid


def test_featured_lists_only_finished_configured_audits(client, monkeypatch):
    assert client.get("/api/audits/featured").json() == {"audits": []}
    aid = featured(client, monkeypatch)
    rows = client.get("/api/audits/featured").json()["audits"]
    assert [r["id"] for r in rows] == [aid]  # the missing id is skipped, not an error
    full = client.get(f"/api/audits/{aid}").json()
    assert rows[0]["counts"]["verify"] == sum(f["label"] != "measured" for f in full["findings"])
    assert rows[0]["is_synthetic"] is True


def test_featured_original_is_read_only(client, monkeypatch):
    aid = featured(client, monkeypatch)
    before = client.get(f"/api/audits/{aid}").json()
    assert client.post(f"/api/audits/{aid}/measurements", json=DOOR).status_code == 403
    fid = f"{aid}__ADA_2010_404_2_3__door_entrance"
    r = client.post(f"/api/findings/{fid}/verify", json={"action": "needs_field_visit", "reviewer": "Tester"})
    assert r.status_code == 403
    r = client.post(f"/api/audits/{aid}/markups", json={"pins": [], "reviewed_by": "Tester"})
    assert r.status_code == 403
    after = client.get(f"/api/audits/{aid}").json()
    assert after["measurements"] == before["measurements"] and after["findings"] == before["findings"]


def test_copy_is_independent_and_editable(client, monkeypatch):
    aid = featured(client, monkeypatch)
    before = client.get(f"/api/audits/{aid}").json()["measurements"]
    r = client.post(f"/api/audits/{aid}/copy")
    assert r.status_code == 201
    cid = r.json()["audit_id"]
    assert cid != aid and r.json()["copied_from"] == aid

    copy = client.get(f"/api/audits/{cid}").json()
    assert copy["copied_from"] == aid and copy["status"] == "COMPLETE"
    assert all(f["id"].startswith(f"{cid}__") and f["audit_id"] == cid for f in copy["findings"])
    assert copy["events"][-1]["type"] == "AGENT_NOTE" and aid in copy["events"][-1]["summary"]

    assert client.post(f"/api/audits/{cid}/measurements", json=DOOR).status_code == 200
    fid = f"{cid}__ADA_2010_404_2_3__door_entrance"
    assert client.post(f"/api/findings/{fid}/verify", json={"action": "approve", "reviewer": "Tester"}).status_code == 200
    assert client.get(f"/api/audits/{aid}").json()["measurements"] == before  # the original is untouched
    assert len(client.get(f"/api/audits/{cid}").json()["measurements"]) == len(before) + 1


def test_only_featured_audits_can_be_copied(client, monkeypatch):
    aid = client.post("/api/audits", json=FIXTURE).json()["audit_id"]
    assert client.post(f"/api/audits/{aid}/copy").status_code == 404


def test_usage_totals_skip_copies(client, monkeypatch):
    aid = featured(client, monkeypatch)
    a = store.get(aid)
    a.usage = [ModelUsage(model="m", requests=2, input_tokens=10, cache_write_tokens=0, cache_read_tokens=0,
                          output_tokens=5, est_cost_usd=0.5, price_note=None)]
    store.save(a)
    client.post(f"/api/audits/{aid}/copy")
    u = client.get("/api/usage").json()
    assert u["audits_with_agent"] == 1 and u["est_cost_usd"] == 0.5


def rec(**kw):
    base = {"id": 1, "name": "A", "address": "1 Main", "city": "Houston", "state": "TX", "type": "Retail",
            "year_built": 2005, "surface_spaces": 40, "model_ids": ["m1"]}
    return {**base, **kw}


def test_triage_uses_table_208_2_and_explains_points():
    r = portfolio.triage(rec(surface_spaces=120), "Houston")
    assert (r["required_accessible"], r["required_van"]) == (5, 1)
    assert r["points"] == 1 and [x["code"] for x in r["reasons"]] == ["large_lot"]

    r = portfolio.triage(rec(surface_spaces=None, year_built=1980, model_ids=[]), None)
    assert r["required_accessible"] is None and r["pre_ada"] is True
    assert {x["code"] for x in r["reasons"]} == {"lot_unknown", "pre_ada", "no_scan", "no_aerial"}
    assert r["points"] == 3 + 2 + 2 + 1

    quiet = portfolio.triage(rec(), "Houston")
    assert quiet["points"] == 0 and quiet["required_accessible"] == 2


def test_order_puts_most_to_measure_first():
    rows = [portfolio.triage(rec(id=1, name="B"), "Houston"),
            portfolio.triage(rec(id=2, name="A", year_built=1970), "Houston"),
            portfolio.triage(rec(id=3, name="C", year_built=1970, surface_spaces=500), "Houston")]
    assert [r["id"] for r in portfolio.order(rows)] == [3, 2, 1]
    t = portfolio.totals(rows)
    assert t["buildings"] == 3 and t["pre_ada"] == 2 and t["required_accessible"] == 2 + 2 + 9


def test_portfolio_groups_by_owner(client, monkeypatch):
    idx = {1: rec(id=1, owner_id=77), 2: rec(id=2, owner_id=77, year_built=1960), 3: rec(id=3, owner_id=88),
           4: {**rec(id=4), "owner_id": None}}
    for r in idx.values():
        r.update(lat=None, lon=None)
    monkeypatch.setattr(costar, "index", lambda: idx)
    body = client.get("/api/portfolio").json()
    assert body["owners"] == [{"id": 77, "buildings": 2}]  # single-building owners are not offered as portfolios
    assert body["totals"]["buildings"] == 4
    mine = client.get("/api/portfolio", params={"owner": 77}).json()
    assert [r["id"] for r in mine["properties"]] == [2, 1]


def test_portfolio_without_the_extract(client):
    body = client.get("/api/portfolio").json()
    assert body["available"] is False and body["properties"] == [] and body["owners"] == []
