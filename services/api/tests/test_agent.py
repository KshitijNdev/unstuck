"""Agent loop tests with a fake model client. No network, no real model calls."""
import asyncio
import os
from types import SimpleNamespace as NS

import pytest

os.environ["UNSTUCK_STEP_DELAY"] = "0"
for k in ("VEXCEL_API_KEY", "MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN", "COSTAR_KIT_DIR"):
    os.environ[k] = ""

from app import store  # noqa: E402
from app.agents import orchestrator  # noqa: E402
from app.pipeline import runner  # noqa: E402
from app.providers import fixture  # noqa: E402


def call(i, name, **inp):
    return NS(type="tool_use", id=f"t{i}", name=name, input=inp)


def reply(*blocks, stop="tool_use"):
    return NS(stop_reason=stop, content=list(blocks))


class FakeClient:
    """Plays back a fixed list of model responses and records what it was sent."""
    def __init__(self, script):
        self.script, self.sent = list(script), []
        self.beta = NS(messages=NS(create=self._create))

    async def _create(self, **kw):
        self.sent.append({**kw, "messages": list(kw["messages"])})  # snapshot: the loop keeps appending
        return self.script.pop(0)


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
    fake = FakeClient(script)
    monkeypatch.setattr(orchestrator.anthropic, "AsyncAnthropic", lambda **_: fake)
    return fake


def test_agent_runs_tools_and_rules_engine_makes_findings(audit, monkeypatch):
    fake = use(monkeypatch, [
        reply(NS(type="text", text="Starting."), call(1, "make_plan", steps=["a", "b", "c"]), call(2, "get_property_record")),
        reply(call(3, "cross_check_identity")),
        reply(call(4, "run_ada_checks")),
        reply(call(5, "finish", summary="Two checks are below threshold; measure the entrance door next.")),
    ])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    assert a.status == "COMPLETE" and a.engine == "claude_agent"
    assert a.plan == ["a", "b", "c"]
    assert a.findings, "findings come from the rule engine"
    assert a.narrative.startswith("Two checks")
    types = [e.type for e in a.events]
    assert "AGENT_NOTE" in types and types[-1] == "REPORT_READY"
    # parallel tool calls answered in one user message, in order
    second = fake.sent[1]["messages"][-1]
    assert second["role"] == "user" and [r["tool_use_id"] for r in second["content"]] == ["t1", "t2"]


def test_summary_with_legal_conclusion_is_rejected(audit, monkeypatch):
    fake = use(monkeypatch, [
        reply(call(1, "run_ada_checks")),
        reply(call(2, "finish", summary="The building is ADA compliant.")),
        reply(call(3, "finish", summary="No checks are below threshold on recorded data.")),
    ])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    rejected = fake.sent[2]["messages"][-1]["content"][0]
    assert rejected["is_error"] and "compliant" in rejected["content"]
    assert a.narrative == "No checks are below threshold on recorded data."


def test_agent_failure_falls_back_to_script(audit, monkeypatch):
    async def boom(**_):
        raise RuntimeError("model down")
    monkeypatch.setattr(orchestrator.anthropic, "AsyncAnthropic", lambda **_: NS(beta=NS(messages=NS(create=boom))))
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    assert a.status == "COMPLETE" and a.engine == "scripted_pipeline"
    assert a.plan == runner.SCRIPT_PLAN and a.findings
    assert any("finishing with the scripted pipeline" in e.summary for e in a.events)


def test_agent_that_stops_early_still_gets_rules_and_report(audit, monkeypatch):
    use(monkeypatch, [reply(call(1, "get_property_record")), reply(NS(type="text", text="Done."), stop="end_turn")])
    asyncio.run(runner.run_audit("a1"))
    a = store.get("a1")
    assert a.findings and a.events[-1].type == "REPORT_READY" and a.narrative is None


def test_unlinked_scan_is_refused(audit):
    tools = orchestrator._Tools(audit, None, None)
    audit.is_synthetic = False
    with pytest.raises(ValueError, match="not linked"):
        asyncio.run(tools.call("load_interior_scan", {"model_id": "someone-elses-scan"}))


def test_no_key_uses_script(audit, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    asyncio.run(runner.run_audit("a1"))
    assert store.get("a1").engine == "scripted_pipeline"


def test_token_usage_is_recorded_and_totalled(audit, monkeypatch):
    def r(*blocks, stop="tool_use", inp=1000, out=200, read=0, write=0):
        x = reply(*blocks, stop=stop)
        x.model = "claude-opus-5-5"
        x.usage = NS(input_tokens=inp, output_tokens=out, cache_read_input_tokens=read, cache_creation_input_tokens=write)
        return x
    use(monkeypatch, [
        r(call(1, "run_ada_checks"), write=3000),
        r(call(2, "finish", summary="Measure the entrance door next."), inp=100, read=3000, out=50),
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
