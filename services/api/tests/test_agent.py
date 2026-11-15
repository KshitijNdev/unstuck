"""Deep Agent tests: the real deepagents graph with a scripted LangChain chat model. No network, no real model."""
import asyncio
import os

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

os.environ["UNSTUCK_STEP_DELAY"] = "0"
for k in ("VEXCEL_API_KEY", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN", "COSTAR_KIT_DIR"):
    os.environ[k] = ""

from app import store  # noqa: E402
from app.agents import orchestrator  # noqa: E402
from app.models import Evidence  # noqa: E402
from app.pipeline import runner  # noqa: E402
from app.providers import fixture  # noqa: E402


class ScriptedModel(BaseChatModel):
    """Plays back AIMessages in order, for the orchestrator and its subagents alike, and records what it was sent."""
    script: list = []
    sent: list = []

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kw):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        self.sent.append(list(messages))
        nxt = self.script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return ChatResult(generations=[ChatGeneration(message=nxt)])


def say(text="", *calls, usage=None):
    return AIMessage(content=text, tool_calls=[{"name": n, "args": a, "id": f"c{i}_{n}", "type": "tool_call"}
                                               for i, (n, a) in enumerate(calls)],
                     usage_metadata=usage, response_metadata={"model_name": "claude-opus-5-5"})


def delegate(subagent, what):
    return ("task", {"subagent_type": subagent, "description": what})


@pytest.fixture()
def audit(tmp_path, monkeypatch):
    store.reset(str(tmp_path / "t.sqlite"))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    prop, *_ = fixture.load("a1")
    from app.models import Audit
    a = Audit(id="a1", property_id=prop.id, property=prop, is_synthetic=True)
    store.save(a)
    yield a
    store.reset()


def use(monkeypatch, script):
    model = ScriptedModel(script=list(script), sent=[])
    monkeypatch.setattr(orchestrator, "build_model", lambda: model)
    return model


def test_deep_agent_delegates_and_rules_engine_makes_findings(audit, monkeypatch):
    use(monkeypatch, [
        say("Planning.", ("make_plan", {"steps": ["Record", "Aerial", "Scan", "Checks"]}),
            delegate("property_investigator", "Get the record")),
        say("", ("get_property_record", {})),                              # property_investigator
        say("Synthetic fixture loaded: retail, 75 spaces."),               # property_investigator reports back
        say("", ("cross_check_identity", {})),
        say("", ("run_ada_checks", {})),
        say("", ("finish", {"summary": "Two checks are below threshold; measure the entrance door next."})),
        say("Done."),
    ])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    assert a.status == "COMPLETE" and a.engine == "deep_agent"
    assert a.plan == ["Record", "Aerial", "Scan", "Checks"]
    assert a.findings, "findings come from the rule engine"
    assert a.narrative.startswith("Two checks")
    notes = [(e.actor, e.summary) for e in a.events if e.type == "AGENT_NOTE"]
    assert ("orchestrator", "Delegated to property_investigator: Get the record") in notes
    assert ("property_investigator", "Synthetic fixture loaded: retail, 75 spaces.") in notes
    assert a.events[-1].type in ("REPORT_READY", "AGENT_NOTE")
    assert any(e.type == "REPORT_READY" for e in a.events)


def test_summary_with_legal_conclusion_is_sent_back(audit, monkeypatch):
    model = use(monkeypatch, [
        say("", ("run_ada_checks", {})),
        say("", ("finish", {"summary": "The building is ADA compliant."})),
        say("", ("finish", {"summary": "No checks are below threshold on recorded data."})),
        say("Done."),
    ])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    rejected = model.sent[2][-1]  # the tool result the model saw after its first finish
    assert "Error" in rejected.content and "compliant" in rejected.content
    assert a.narrative == "No checks are below threshold on recorded data."


def test_model_failure_falls_back_to_script(audit, monkeypatch):
    use(monkeypatch, [RuntimeError("model down")])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    assert a.status == "COMPLETE" and a.engine == "scripted_pipeline"
    assert a.plan == runner.SCRIPT_PLAN and a.findings
    assert any("finishing with the scripted pipeline" in e.summary for e in a.events)


def test_agent_that_stops_early_still_gets_rules_and_report(audit, monkeypatch):
    use(monkeypatch, [say("", ("cross_check_identity", {})), say("Done.")])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    assert a.findings and any(e.type == "REPORT_READY" for e in a.events) and a.narrative is None


def test_tool_error_goes_back_to_the_model_instead_of_ending_the_run(audit, monkeypatch):
    def boom(_a):
        raise RuntimeError("identity check exploded")
    monkeypatch.setattr(runner, "step_identity", boom)
    model = use(monkeypatch, [
        say("", ("cross_check_identity", {})),
        say("", ("finish", {"summary": "Measure the entrance door next."})),
        say("Done."),
    ])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    assert a.engine == "deep_agent" and a.narrative == "Measure the entrance door next."
    assert "identity check exploded" in model.sent[1][-1].content


def test_unlinked_scan_is_refused(audit):
    tools = orchestrator._Tools(audit, None, None)
    audit.is_synthetic = False
    with pytest.raises(ValueError, match="not linked"):
        asyncio.run(tools.load_interior_scan("someone-elses-scan"))


def test_measuring_before_a_scan_is_loaded_is_refused(audit):
    tools = orchestrator._Tools(audit, None, None)
    audit.is_synthetic = False
    with pytest.raises(ValueError, match="load_interior_scan first"):
        asyncio.run(tools.measure_doorways())


def test_no_key_uses_script(audit, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    asyncio.run(runner.run_audit("a1"))
    assert store.get("a1").engine == "scripted_pipeline"


def test_token_usage_is_recorded_for_every_agent_and_totalled(audit, monkeypatch):
    # LangChain's input_tokens is the total; cache read/write are inside it.
    u1 = {"input_tokens": 4000, "output_tokens": 200, "total_tokens": 4200,
          "input_token_details": {"cache_creation": 3000, "cache_read": 0}}
    u2 = {"input_tokens": 3100, "output_tokens": 50, "total_tokens": 3150,
          "input_token_details": {"cache_creation": 0, "cache_read": 3000}}
    use(monkeypatch, [
        say("", ("run_ada_checks", {}), usage=u1),
        say("", ("finish", {"summary": "Measure the entrance door next."}), usage=u2),
        say("Done."),
    ])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    [u] = a.usage
    assert (u.requests, u.input_tokens, u.cache_write_tokens, u.cache_read_tokens, u.output_tokens) == (2, 1100, 3000, 3000, 250)
    # 1100*4 + 3000*5 + 3000*0.2 + 250*20 = 25000 per million
    assert u.est_cost_usd == 0.025
    assert any(e.summary.startswith("Model usage (claude-opus-5-5): 2 requests") for e in a.events)
    t = store.usage_totals()
    assert t["audits_with_agent"] == 1 and t["output_tokens"] == 250 and t["est_cost_usd"] == 0.025


# ---- doorway measuring from a scan's floor plan -----------------------------------------------------------
def _tour(audit, doorways, model_id="MODEL123456"):
    audit.evidence = [e for e in audit.evidence if e.asset_type != "tour"] + [Evidence(
        id=f"ev_matterport_{audit.property_id}", property_id=audit.property_id, provider="Matterport",
        provider_asset_id=model_id, asset_type="tour", retrieved_at="2026-11-14T00:00:00+00:00",
        geometry={"summary": {"has_floor_plan": True, "doorways": doorways}}, rights="test", is_sponsor_source=True)]


def _door(oid, width, wall=5.1):
    return {"opening_id": oid, "floor": "Floor 1", "kind": "door-pivot", "width_in": width, "wall_thickness_in": wall}


def test_scan_doorways_become_door_checks(audit):
    audit.is_synthetic = False
    _tour(audit, [_door("a", 28.4), _door("b", 36.0), _door("c", 0.6)])
    out = runner.step_doorways(audit)
    assert out["measured"] == 3
    runner.reevaluate(audit)
    scan = {f.location: f for f in audit.findings if f.location.startswith("Scan doorway")}
    assert scan["Scan doorway 1, Floor 1 (door-pivot)"].status == "SUSPECTED_VISUAL_BARRIER"
    assert scan["Scan doorway 1, Floor 1 (door-pivot)"].label == "suspected"
    assert scan["Scan doorway 1, Floor 1 (door-pivot)"].confidence == "SCAN_FLOORPLAN"
    assert scan["Scan doorway 2, Floor 1 (door-pivot)"].status == "FIELD_VERIFICATION_REQUIRED"
    assert scan["Scan doorway 3, Floor 1 (door-pivot)"].status == "INSUFFICIENT_DATA"
    assert not any(f.status in ("NUMERIC_SCREEN_PASS", "NUMERIC_SCREEN_FAIL") for f in scan.values()), \
        "a frame opening never passes or fails a door"
    # Each scan doorway names the model it came from, so the workspace can open that scan.
    doors = {d.id: d for d in audit.property.doors}
    assert all(doors[f.location_id].model_id for f in scan.values())
    assert all(f.observed["measures"].startswith("doorway opening") for f in scan.values() if f.observed)


def test_a_tape_measurement_overrides_the_scan_opening(audit):
    audit.is_synthetic = False
    _tour(audit, [_door("a", 36.0)])
    runner.step_doorways(audit)
    door = next(d for d in audit.property.doors if d.source == "matterport_floorplan")
    from app.models import Measurement
    audit.measurements.append(Measurement(id="m1", audit_id="a1", location_id=door.id, name="door_clear_width_in",
                                          value=34, unit="in", method="field"))
    audit.measurements.append(Measurement(id="m2", audit_id="a1", location_id=door.id, name="door_opening_depth_in",
                                          value=5, unit="in", method="field"))
    runner.reevaluate(audit)
    f = next(f for f in audit.findings if f.location_id == door.id)
    assert f.status == "NUMERIC_SCREEN_PASS" and f.confidence == "FIELD_MEASURED"


def test_switching_scans_replaces_the_doorways(audit):
    audit.is_synthetic = False
    _tour(audit, [_door("a", 28.4), _door("b", 36.0)], model_id="FIRST000001")
    runner.step_doorways(audit)
    _tour(audit, [], model_id="SECOND00002")
    out = runner.step_doorways(audit)
    assert out["measured"] == 0
    assert not [d for d in audit.property.doors if d.source == "matterport_floorplan"]
    assert not [m for m in audit.measurements if m.method == "scan_floorplan"]


def test_scan_doorway_position_comes_from_the_wall_it_sits_in():
    from app.providers import matterport
    wall = {"thickness": 0.15, "vertices": [{"position": {"x": 0, "y": 0}}, {"position": {"x": 4, "y": 2}}],
            "openings": [{"id": "o1", "type": "doorway", "label": "door-pivot", "width": 0.8, "relativeCenter": 0.25},
                         {"id": "o2", "type": "doorway", "width": 0.9, "relativeCenter": None}]}
    model = {"floors": [{"label": "Floor 1", "edges": [wall, {"vertices": [{"position": {"x": 1}}]}]}]}
    by_id = {d["opening_id"]: d for d in matterport.doorways(model)}
    assert by_id["o1"]["center"] == [1.0, 0.5]
    assert by_id["o2"]["center"] is None, "no relativeCenter means no position, never a guess"
    assert matterport.floor_plan(model) == {"Floor 1": [[0, 0, 4, 2]]}   # the vertex-less edge is skipped


def test_a_tour_measurement_on_a_scan_doorway_uses_the_scan_wall_as_depth(audit):
    """One line drawn in the 3D tour is enough: the scan already knows how deep the opening is."""
    from app.models import Measurement
    audit.is_synthetic = False
    _tour(audit, [_door("a", 36.0, wall=5.1), _door("b", 36.0, wall=5.1)])
    runner.step_doorways(audit)
    wide, tight = [d for d in audit.property.doors if d.source == "matterport_floorplan"]
    for door, value in ((wide, 33.4), (tight, 30.5)):
        audit.measurements.append(Measurement(id=f"m_{door.id}", audit_id="a1", location_id=door.id,
                                              name="door_clear_width_in", value=value, unit="in", method="model_metric"))
    runner.reevaluate(audit)
    by = {f.location_id: f for f in audit.findings}
    assert by[wide.id].status == "NUMERIC_SCREEN_PASS" and by[wide.id].confidence == "MODEL_METRIC"
    assert by[tight.id].status == "NUMERIC_SCREEN_FAIL"
    assert any("wall thickness" in a for a in by[wide.id].assumptions)


def test_scan_mesh_measures_a_doorway_gap():
    """A wall with a 0.9 m opening: the gap is found, and a leaf across the opening blocks it."""
    from app.providers import scanmesh

    def wall(x0, x1):   # a vertical quad in the plane y = 0, from floor to 2.4 m
        return [(x0, 0, 0), (x1, 0, 0), (x1, 0, 2.4), (x0, 0, 2.4)]

    def obj(quads):
        verts = [v for q in quads for v in q]
        lines = [f"v {x} {y} {z}" for x, y, z in verts]
        lines += [f"f {4*i+1} {4*i+2} {4*i+3}\nf {4*i+1} {4*i+3} {4*i+4}" for i in range(len(quads))]
        return "\n".join(lines).encode()

    geom = {"a": [-3, 0], "b": [3, 0], "centre": 0.5, "width_m": 0.9, "thickness_m": 0.12, "lower_m": 0.0, "height_m": 2.1}
    open_doorway = [{"geom": dict(geom)}]
    assert scanmesh.measure_doorways(obj([wall(-3, -0.45), wall(0.45, 3)]), open_doorway) == 1
    assert open_doorway[0]["mesh_state"] == "clear" and abs(open_doorway[0]["mesh_gap_in"] - 35.4) < 0.2

    closed = [{"geom": dict(geom)}]
    assert scanmesh.measure_doorways(obj([wall(-3, -0.45), wall(-0.45, 0.45), wall(0.45, 3)]), closed) == 0
    assert closed[0]["mesh_state"] == "blocked"

    ajar = [{"geom": dict(geom)}]
    scanmesh.measure_doorways(obj([wall(-3, -0.45), wall(-0.45, 0.0), wall(0.45, 3)]), ajar)
    assert ajar[0]["mesh_state"] == "partly_blocked"


def test_accepting_scan_estimates_passes_only_mesh_confirmed_wide_doorways(audit):
    from fastapi.testclient import TestClient
    from app import store
    from app.main import app
    audit.is_synthetic = False
    audit.status = "COMPLETE"
    wide = {**_door("a", 37.0), "mesh_state": "clear", "mesh_gap_in": 36.8}
    tight = {**_door("b", 34.0), "mesh_state": "clear", "mesh_gap_in": 34.0}
    unseen = {**_door("c", 40.0), "mesh_state": "blocked", "mesh_gap_in": 0.0}
    _tour(audit, [wide, tight, unseen])
    runner.step_doorways(audit)
    runner.reevaluate(audit)
    assert not any(f.status == "NUMERIC_SCREEN_PASS" and f.location.startswith("Scan doorway") for f in audit.findings), \
        "nothing passes until a person accepts"
    store.save(audit)

    res = TestClient(app).post(f"/api/audits/{audit.id}/doors/accept-scan-estimates", json={"reviewed_by": "Test Reviewer"})
    assert res.status_code == 200 and res.json()["accepted"] == 1
    after = {f.location: f for f in store.get(audit.id).findings if f.location.startswith("Scan doorway")}
    passed = [f for f in after.values() if f.status == "NUMERIC_SCREEN_PASS"]
    assert len(passed) == 1 and passed[0].confidence == "SCAN_MESH_ACCEPTED"
    assert passed[0].observed["value"] == 33.5 and "accepted by Test Reviewer" in passed[0].assumptions[0]
    assert sum(f.status == "FIELD_VERIFICATION_REQUIRED" for f in after.values()) == 2


def test_a_person_can_take_the_scan_width_after_looking_at_the_doorway(audit):
    from fastapi.testclient import TestClient
    from app import store
    from app.main import app
    audit.is_synthetic = False
    audit.status = "COMPLETE"
    _tour(audit, [{**_door("a", 57.0), "mesh_state": "clear", "mesh_gap_in": 56.8}, _door("b", 33.5), _door("c", 30.0)])
    runner.step_doorways(audit)
    runner.reevaluate(audit)
    store.save(audit)
    doors = {d.label.split(",")[0]: d.id for d in audit.property.doors if d.source == "matterport_floorplan"}
    client = TestClient(app)
    url = f"/api/audits/{audit.id}/doors/{{}}/use-scan-width"

    # A 57 in opening with no door in it: the opening is the clear width, taken as the scan has it.
    open_one = client.post(url.format(doors["Scan doorway 1"]), json={"door": "none", "reviewed_by": "Test Reviewer"}).json()["finding"]
    assert open_one["status"] == "NUMERIC_SCREEN_PASS" and open_one["observed"]["value"] == 56.8
    assert "saw no door" in open_one["assumptions"][0] and open_one["confidence"] == "SCAN_MESH_ACCEPTED"

    # A 33.5 in opening with a hinged door leaves about 31.2 in: below the minimum.
    hinged = client.post(url.format(doors["Scan doorway 2"]), json={"door": "hinged", "reviewed_by": "Test Reviewer"}).json()["finding"]
    assert hinged["status"] == "NUMERIC_SCREEN_FAIL" and hinged["observed"]["value"] == 31.2

    assert client.post(url.format("door_entrance"), json={"door": "none", "reviewed_by": "x"}).status_code == 404


def test_doorway_sorting_note_counts_like_the_inspector(audit):
    """The log's 'to measure first' must include doorways already under 32 in, as the workspace summary does."""
    audit.is_synthetic = False
    _tour(audit, [_door("a", 20.5), _door("b", 28.0), _door("c", 33.0), _door("d", 60.0)])
    runner.step_doorways(audit)
    runner.reevaluate(audit)
    tri = [f.observed["triage"] for f in audit.findings if (f.observed or {}).get("triage")]
    first = sum(t in ("narrow", "likely_narrow") for t in tri)
    note = next(e.summary for e in audit.events if "Sorted by scan width" in e.summary)
    assert f"{first} to measure first" in note and first >= 1
