"""LangChain Deep Agent that runs an audit by delegating to specialist subagents.

Built with `deepagents.create_deep_agent` on LangChain + LangGraph, with Claude as the model through
`langchain_anthropic.ChatAnthropic`. The orchestrator plans the audit and hands work to three
subagents through the Deep Agents `task` tool:

  property_investigator  CoStar property record
  exterior_inspector     Vexcel aerial image (labelled USGS fallback)
  interior_inspector     compares the linked Matterport scans, loads one, measures its doorway openings

The agents never produce a finding. Every result comes from the deterministic rule engine
(app/rules/ada2010.py) through the run_ada_checks tool. Tools are read-only toward providers and only
append evidence or measurements to this audit.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Awaitable, Callable
from uuid import UUID

import httpx
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from .. import store
from ..models import Audit, ModelUsage
from ..pipeline import runner
from ..providers import costar, matterport

MAX_MAIN_STEPS = 80          # LangGraph recursion limit for the orchestrator (deepagents defaults to 9999)
MAX_SUBAGENT_MODEL_CALLS = 8  # the parent's limit does not bound subagents, so each gets its own
RUN_TIMEOUT_S = 300
# Words a screening summary must not use about this building.
FORBIDDEN = re.compile(r"\b(compliant|non-?compliant|compliance with|violat\w*|certif\w*|passes ada|fails ada|ada[- ]approved|lawsuit)\b", re.I)

SYSTEM = """You are the orchestrator of an accessibility SCREENING of one commercial property for its owner or manager. You \
are not an inspector, and nothing you produce is a certification or legal compliance determination.

You work only through tools and subagents. Every numeric result comes from run_ada_checks, a tested rule engine for the \
2010 ADA Standards. Never compute, estimate or invent a measurement, count or width yourself. If something was not \
measured, it stays unmeasured and a person is asked to measure it.

Do the audit in this order, skipping a step only when its source is unavailable (say so when you skip):
1. make_plan: record 4 to 9 short plan steps for the user.
2. task -> property_investigator: get the property record.
3. task -> exterior_inspector: get the aerial image.
4. task -> interior_inspector: choose and load a linked 3D scan and measure its doorway openings.
   Steps 2 to 4 are independent; you may delegate them in parallel.
5. cross_check_identity.
6. run_ada_checks.
7. finish, with a summary of at most 120 words for the owner: what evidence was gathered, which checks are below \
threshold or suspected on measured or scanned data, and what a person should measure next. Use the words "below \
threshold", "suspected", "meets threshold", "needs measurement". Never use the words compliant, violation or certified.

A failed tool or subagent is not a reason to stop: carry on with what you have. Do not use the file tools; this audit \
has no files. When you delegate, say in the task description exactly what you want back."""

PROPERTY_PROMPT = """You are the property investigator in an accessibility screening. Call get_property_record once and \
report back, in under 80 words: use type, year built, surface parking count, how many Matterport scans are linked, and \
which record fields are unknown. Report only what the tool returned; never guess a missing value. Plain sentences, no \
markdown."""

EXTERIOR_PROMPT = """You are the exterior inspector in an accessibility screening. Call fetch_aerial_image once and report \
back, in under 60 words: which provider supplied the image, whether it is sponsor data or the public fallback, and its \
limits. Images support counting stalls by a person; they never measure anything. Plain sentences, no markdown."""

INTERIOR_PROMPT = """You are the interior inspector in an accessibility screening. Your job is to measure doorway openings \
from a 3D scan's floor plan.
1. Call list_linked_scans to see every Matterport scan linked to this property.
2. Choose one scan: prefer one whose floor plan has doorways, and among those prefer public or common areas (lobby, \
entrance, retail floor, whole building) over a private suite or residence. If the brief names a pre-selected scan, \
load it unless another linked scan has doorways and it has none.
3. Call load_interior_scan with that scan's id.
4. Call measure_doorways.
Report back in under 100 words: which scan you chose and why, how many doorway openings were measured and the \
narrowest width the tool returned. Doorway widths are frame openings, not clear width with the door open: never call a \
door wide enough. Copy numbers exactly from the tools; never compute or estimate a width. Call the tools one at a \
time, in order: measure_doorways only works after load_interior_scan has returned. Plain sentences, no markdown."""


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and os.environ.get("UNSTUCK_AGENT", "on") != "off"


def model_name() -> str:
    return os.environ.get("UNSTUCK_MODEL", "claude-opus-5-5")


def build_model():
    """The chat model every agent in the graph uses. Tests replace this with a scripted model."""
    from langchain_anthropic import ChatAnthropic
    return ChatAnthropic(model=model_name(), max_tokens=8000, max_retries=3, timeout=120)


# ---- tools ------------------------------------------------------------------------------------------------
class _Tools:
    """Every tool the orchestrator and its subagents can call, bound to one audit."""

    def __init__(self, audit: Audit, http: httpx.AsyncClient | None, requested_model: str | None):
        self.audit, self.http, self.requested_model = audit, http, requested_model
        self.done = False

    def linked_models(self) -> list[str]:
        prop = self.audit.property
        ref = next((r for r in prop.source_refs if r.provider == "CoStar"), None) if prop else None
        rec = costar.get(int(ref.source_record_id)) if ref and ref.source_record_id else None
        ids = list(rec["model_ids"]) if rec else []
        if self.requested_model and self.requested_model not in ids:
            ids.append(self.requested_model)
        return ids

    # Each method returns a plain dict the agent reads, or raises ValueError with a message for the agent.
    async def make_plan(self, steps: list[str]) -> dict:
        steps = [str(s)[:160] for s in steps][:9]
        if len(steps) < 3:
            raise ValueError("give 3 to 9 steps")
        return runner.set_plan(self.audit, steps)

    async def get_property_record(self) -> dict:
        if not self.audit.is_synthetic:
            return runner.step_record(self.audit)
        out = runner.step_fixture(self.audit)
        p = self.audit.property
        assert p is not None
        return {**out, "record": {"name": p.name, "type": p.type, "year_built": p.year_built,
                                  "parking_facilities": [f.label for f in p.facilities], "doors": [d.label for d in p.doors]},
                "note": "SYNTHETIC fixture: made-up values for trying the flow, not a real building."}

    async def fetch_aerial_image(self) -> dict:
        if self.audit.is_synthetic:
            return {"synthetic": True, "note": "The synthetic demo uses a labelled site schematic, not imagery."}
        return await runner.step_aerial(self.audit, self.http)

    async def list_linked_scans(self) -> dict:
        if self.audit.is_synthetic:
            return {"synthetic": True, "scans": [], "note": "No 3D scan exists for the synthetic demo."}
        ids = self.linked_models()
        if not ids:
            return {"scans": [], "note": "No Matterport scan is linked to this property."}
        if matterport.status().state == "unavailable":
            return {"scans": [], "note": "Matterport is not available on this server."}
        results = await asyncio.gather(*(matterport.scan_overview(self.http, m) for m in ids[:8]), return_exceptions=True)
        scans = [r if not isinstance(r, Exception) else {"model_id": m, "error": type(r).__name__}
                 for m, r in zip(ids, results)]
        runner.emit(self.audit, "FETCH_SUCCESS", "interior_inspector",
                    f"Compared {len(scans)} linked Matterport scan(s): "
                    + "; ".join(f"{s.get('name') or s['model_id']} ({s.get('doorways', '?')} doorways)" for s in scans),
                    tool="matterport.scan_overview", source_id="Matterport", payload=scans)
        return {"scans": scans, "pre_selected": self.requested_model}

    async def load_interior_scan(self, model_id: str) -> dict:
        if self.audit.is_synthetic:
            return {"synthetic": True, "note": "No 3D scan exists for the synthetic demo."}
        linked = self.linked_models()
        if model_id not in linked:
            raise ValueError(f"not linked to this property; choose one of {linked}")
        return await runner.step_interior(self.audit, self.http, model_id)

    async def measure_doorways(self) -> dict:
        if self.audit.is_synthetic:
            return {"synthetic": True, "note": "No 3D scan exists for the synthetic demo."}
        if not any(e.asset_type == "tour" for e in self.audit.evidence):
            raise ValueError("no scan is loaded yet: call load_interior_scan first, then measure_doorways")
        return runner.step_doorways(self.audit)

    async def cross_check_identity(self) -> dict:
        return runner.step_identity(self.audit)

    async def run_ada_checks(self) -> dict:
        out = runner.step_rules(self.audit)
        # Keep the reply short: many scan doorways can mean dozens of findings.
        counts: dict[str, int] = {}
        for f in out["findings"]:
            counts[f["status"]] = counts.get(f["status"], 0) + 1
        notable = [f for f in out["findings"] if f["status"] in ("NUMERIC_SCREEN_FAIL", "SUSPECTED_VISUAL_BARRIER")]
        return {"counts_by_status": counts, "below_threshold_or_suspected": notable[:12],
                "other_findings": [{"title": f["title"], "location": f["location"], "status": f["status"]}
                                   for f in out["findings"] if f not in notable][:25]}

    async def finish(self, summary: str) -> dict:
        summary = summary.strip()
        if hit := FORBIDDEN.search(summary):
            raise ValueError(f"summary uses '{hit.group(0)}'; this is a screening, rephrase without legal conclusions")
        if len(summary.split()) > 140:
            raise ValueError("summary is over 120 words")
        if not self.audit.findings:
            runner.step_rules(self.audit)
        self.audit.narrative = summary
        runner.step_report(self.audit)
        self.done = True
        return {"ok": True}


SUBAGENTS = ("property_investigator", "exterior_inspector", "interior_inspector")
ROLE = {  # tool -> the role it acts as in the event log
    "make_plan": "orchestrator", "get_property_record": "property_investigator",
    "fetch_aerial_image": "exterior_inspector", "list_linked_scans": "interior_inspector",
    "load_interior_scan": "interior_inspector", "measure_doorways": "interior_inspector",
    "cross_check_identity": "orchestrator", "run_ada_checks": "rules_evaluator", "finish": "report_author",
}
DESCRIPTIONS = {
    "make_plan": "Record the audit plan shown to the user (steps: 4 to 9 short plan steps). Call first.",
    "get_property_record": "Look up the CoStar property record: use type, year built, surface parking count, linked "
                           "Matterport scan ids. For the synthetic demo this loads the labelled fixture.",
    "fetch_aerial_image": "Fetch an orthophoto of the site: Vexcel first, labelled public USGS fallback second. Images "
                          "support counting stalls, not measuring them.",
    "list_linked_scans": "List every Matterport scan linked to this property with its name, classification, whether it "
                         "has a floor plan, how many doorways the floor plan has, and its room labels.",
    "load_interior_scan": "Load one Matterport scan linked to this property (model_id from list_linked_scans).",
    "measure_doorways": "Measure every doorway opening in the loaded scan's floor plan. Widths are frame openings in "
                        "inches, not clear widths. Records them for run_ada_checks.",
    "cross_check_identity": "Check that the loaded sources describe the same building (distance between the scan and "
                            "the record's coordinates).",
    "run_ada_checks": "Run the deterministic 2010 ADA numeric screens on every measurement recorded so far. Returns "
                      "counts by status and the checks that are below threshold or suspected.",
    "finish": "End the audit with a summary for the owner (at most 120 words).",
}


def _tool(tools: _Tools, name: str) -> StructuredTool:
    fn: Callable[..., Awaitable[dict]] = getattr(tools, name)

    async def run(**kwargs: Any) -> str:
        # deepagents does not catch tool exceptions (they would end the run), so every error goes back to the model.
        try:
            out = await fn(**kwargs)
            store.save(tools.audit)
            return json.dumps(out, default=str)[:12000]
        except Exception as e:  # noqa: BLE001
            runner.emit(tools.audit, "AGENT_NOTE", ROLE[name], f"Tool {name} returned an error to the agent: {e}"[:400],
                        tool=name, error_class=type(e).__name__)
            return f"Error: {e}"

    return StructuredTool.from_function(coroutine=run, name=name, description=DESCRIPTIONS[name],
                                        args_schema=ARGS.get(name, _NoArgs))


class _NoArgs(BaseModel):
    pass


class _PlanArgs(BaseModel):
    steps: list[str] = Field(description="4 to 9 short plan steps")


class _ScanArgs(BaseModel):
    model_id: str = Field(description="A scan id from list_linked_scans")


class _FinishArgs(BaseModel):
    summary: str = Field(description="Summary for the owner, at most 120 words")


ARGS: dict[str, type[BaseModel]] = {"make_plan": _PlanArgs, "load_interior_scan": _ScanArgs, "finish": _FinishArgs}


# ---- usage and event log ----------------------------------------------------------------------------------
class _Recorder(AsyncCallbackHandler):
    """Counts tokens for every model call in the graph (subagents included) and logs what the agents say."""

    def __init__(self, audit: Audit):
        self.audit = audit
        self.agent_of: dict[UUID, str] = {}

    async def on_chat_model_start(self, serialized, messages, *, run_id, metadata=None, **kw):
        name = (metadata or {}).get("lc_agent_name")
        self.agent_of[run_id] = name if name in SUBAGENTS else "orchestrator"

    async def on_llm_end(self, response, *, run_id, **kw):
        who = self.agent_of.pop(run_id, "orchestrator")
        for gens in response.generations:
            for g in gens:
                msg = getattr(g, "message", None)
                if msg is None:
                    continue
                record_usage(self.audit, msg)
                text = _text(msg)
                if text:
                    runner.emit(self.audit, "AGENT_NOTE", who, text[:400])

    async def on_tool_start(self, serialized, input_str, *, inputs=None, **kw):
        if (serialized or {}).get("name") == "task" and isinstance(inputs, dict):
            runner.emit(self.audit, "AGENT_NOTE", "orchestrator",
                        f"Delegated to {inputs.get('subagent_type')}: {str(inputs.get('description', ''))[:300]}")


def _text(msg: Any) -> str:
    c = msg.content
    if isinstance(c, str):
        return c.strip()
    return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text").strip()


def _brief(audit: Audit, requested_model: str | None, sources: list[dict]) -> str:
    p = audit.property
    assert p is not None
    lines = [f"Screen this property: {p.name}", f"Address: {p.address or 'unknown'}",
             f"Coordinates: {p.lat}, {p.lon}" if p.lat is not None else "Coordinates: unknown",
             "This is the SYNTHETIC demo property, not a real building. It has no imagery and no 3D scan."
             if audit.is_synthetic else "The requester confirmed they own or are authorized to audit it."]
    if requested_model:
        lines.append(f"The user pre-selected Matterport scan {requested_model}; tell the interior inspector.")
    lines.append("Connected sources (already checked):\n" + json.dumps(sources))
    return "\n".join(lines)


def build_agent(tools: _Tools, model: Any):
    from deepagents import create_deep_agent
    t = {n: _tool(tools, n) for n in ROLE}

    def sub(name: str, description: str, prompt: str, names: list[str]) -> dict:
        return {"name": name, "description": description, "system_prompt": prompt, "tools": [t[n] for n in names],
                "middleware": [ModelCallLimitMiddleware(run_limit=MAX_SUBAGENT_MODEL_CALLS, exit_behavior="end")]}

    return create_deep_agent(
        model=model,
        tools=[t["make_plan"], t["cross_check_identity"], t["run_ada_checks"], t["finish"]],
        system_prompt=SYSTEM,
        subagents=[
            sub("property_investigator", "Looks up the CoStar property record and reports use type, age, parking and "
                "linked scans.", PROPERTY_PROMPT, ["get_property_record"]),
            sub("exterior_inspector", "Fetches the aerial image of the site and reports its provider and limits.",
                EXTERIOR_PROMPT, ["fetch_aerial_image"]),
            sub("interior_inspector", "Compares the linked Matterport scans, loads the best one and measures its "
                "doorway openings from the floor plan.", INTERIOR_PROMPT,
                ["list_linked_scans", "load_interior_scan", "measure_doorways"]),
        ],
        name="unstuck_orchestrator",
    )


async def run(audit: Audit, requested_model: str | None) -> None:
    runner.emit(audit, "PLANNED", "orchestrator", f"Deep Agent ({model_name()}, LangChain deepagents) is planning the audit.")
    coverage = runner.step_coverage(audit)  # always recorded, whatever the agent decides
    async with httpx.AsyncClient() as http:
        tools = _Tools(audit, http, requested_model)
        agent = build_agent(tools, build_model())
        await asyncio.wait_for(agent.ainvoke(
            {"messages": [{"role": "user", "content": _brief(audit, requested_model, coverage["sources"])}]},
            config={"recursion_limit": MAX_MAIN_STEPS, "callbacks": [_Recorder(audit)]},
        ), timeout=RUN_TIMEOUT_S)

    # The agent may stop early; the audit must still end with rule results and a report.
    if not tools.done:
        if not audit.findings:
            runner.step_rules(audit)
        runner.emit(audit, "AGENT_NOTE", "orchestrator", "Agent ended without a summary; report assembled from rule results only.")
        runner.step_report(audit)
    for u in audit.usage:
        runner.emit(audit, "AGENT_NOTE", "orchestrator", usage_line(u))
    store.save(audit)


# ---- token accounting -------------------------------------------------------------------------------------
# List prices in USD per million tokens: input, cache write (5 min), cache read, output.
# Update when prices change; an unknown model gets tokens but no cost estimate.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-5-5": (4.00, 5.00, 0.20, 20.00),
    "claude-sonnet-5-5": (2.00, 2.50, 0.10, 10.00),
    "claude-haiku-5-5": (0.10, 0.125, 0.01, 0.50),
    "claude-opus-4-8": (5.00, 6.25, 0.50, 25.00),
}


def record_usage(audit: Audit, msg: Any) -> None:
    """Add one model reply's tokens to the audit, keyed by the model that served it.

    LangChain's usage_metadata.input_tokens is the TOTAL input (uncached + cache read + cache write),
    so the cached parts are subtracted to get the uncached count.
    """
    u = getattr(msg, "usage_metadata", None)
    if not u:
        return
    meta = getattr(msg, "response_metadata", None) or {}
    served = meta.get("model_name") or meta.get("model") or model_name()
    details = u.get("input_token_details") or {}
    read, write = details.get("cache_read") or 0, details.get("cache_creation") or 0
    row = next((r for r in audit.usage if r.model == served), None)
    if row is None:
        row = ModelUsage(model=served)
        audit.usage.append(row)
    row.requests += 1
    row.input_tokens += max((u.get("input_tokens") or 0) - read - write, 0)
    row.cache_write_tokens += write
    row.cache_read_tokens += read
    row.output_tokens += u.get("output_tokens") or 0
    price = PRICES.get(served)
    if price:
        p_in, p_write, p_read, p_out = price
        row.est_cost_usd = round((row.input_tokens * p_in + row.cache_write_tokens * p_write
                                  + row.cache_read_tokens * p_read + row.output_tokens * p_out) / 1_000_000, 4)
        row.price_note = "Estimate at list prices; the Anthropic Console has the billed amount."
    else:
        row.est_cost_usd, row.price_note = None, f"No price on file for {served}."


def usage_line(u: ModelUsage) -> str:
    total_in = u.input_tokens + u.cache_write_tokens + u.cache_read_tokens
    cost = f", about ${u.est_cost_usd:.3f}" if u.est_cost_usd is not None else ""
    return (f"Model usage ({u.model}): {u.requests} requests, {total_in:,} input tokens "
            f"({u.cache_read_tokens:,} from cache), {u.output_tokens:,} output tokens{cost}.")
