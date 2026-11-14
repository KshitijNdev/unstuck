"""Claude agent that runs an audit by choosing which evidence tools to call.

The agent decides the plan, the order of calls and which linked 3D scan to load, and writes a
plain-language summary. It never produces a finding: every result still comes from the
deterministic rule engine (app/rules/ada2010.py) via the run_ada_checks tool. Tools are
read-only toward providers and only append evidence to this audit.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import anthropic
import httpx

from .. import store
from ..models import Audit, ModelUsage
from ..pipeline import runner
from ..providers import costar

MAX_TURNS = 14
ROLE = {  # tool -> the role it acts as in the event log
    "make_plan": "orchestrator", "get_property_record": "property_investigator",
    "fetch_aerial_image": "exterior_inspector", "load_interior_scan": "interior_inspector",
    "cross_check_identity": "orchestrator", "run_ada_checks": "rules_evaluator", "finish": "report_author",
}
# Words a screening summary must not use about this building.
FORBIDDEN = re.compile(r"\b(compliant|non-?compliant|compliance with|violat\w*|certif\w*|passes ada|fails ada|ada[- ]approved|lawsuit)\b", re.I)

SYSTEM = """You run an accessibility SCREENING of one commercial property for its owner or manager. You are not an inspector, \
and nothing you produce is a certification or legal compliance determination.

You work only through the tools. Every numeric result comes from run_ada_checks, a tested rule engine for the 2010 ADA \
Standards; never compute, estimate or invent a measurement, count or width yourself. If something was not measured, it \
stays unmeasured and a person is asked to measure it.

Source availability is given in the brief. Typical order: make_plan, get_property_record, fetch_aerial_image, load_interior_scan (only a scan the \
property record links, preferring one that looks like the public entrance or common areas rather than a private suite or \
residence), cross_check_identity, run_ada_checks, finish. Skip a step if its source is unavailable, and say so. A failed \
tool is not a reason to stop: carry on with what you have.

finish takes a summary of at most 120 words for the owner: what evidence was gathered, which checks are below threshold \
on measured or recorded data, and what a person should measure next. Use the words "below threshold", "meets threshold", \
"needs measurement". Do not use the words compliant, violation or certified."""

TOOLS: list[dict[str, Any]] = [
    {"name": "make_plan", "description": "Record the audit plan shown to the user. Call first.",
     "input_schema": {"type": "object", "properties": {"steps": {"type": "array", "items": {"type": "string"},
                      "description": "3 to 9 short plan steps"}}, "required": ["steps"], "additionalProperties": False}},
    {"name": "get_property_record", "description": "Look up the CoStar property record: use type, year built, surface parking count, linked Matterport scan ids. For the synthetic demo this loads the labelled fixture.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "fetch_aerial_image", "description": "Fetch an orthophoto of the site: Vexcel first, labelled public USGS fallback second. Images support counting stalls, not measuring them.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "load_interior_scan", "description": "Load one Matterport 3D scan linked to this property. Returns its name, address, classification and room count. It cannot measure doors.",
     "input_schema": {"type": "object", "properties": {"model_id": {"type": "string", "description": "A scan id from the property record's model_ids"}},
                      "required": ["model_id"], "additionalProperties": False}},
    {"name": "cross_check_identity", "description": "Check that the loaded sources describe the same building (distance between scan and record coordinates).",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "run_ada_checks", "description": "Run the deterministic 2010 ADA numeric screens on whatever measurements exist. Returns each finding with status and follow-up.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "finish", "description": "End the audit with a summary for the owner (at most 120 words).",
     "input_schema": {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"], "additionalProperties": False}},
]
for _t in TOOLS:
    _t["strict"] = True


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and os.environ.get("UNSTUCK_AGENT", "on") != "off"


def model_name() -> str:
    return os.environ.get("UNSTUCK_MODEL", "claude-opus-5-5")


class _Tools:
    def __init__(self, audit: Audit, http: httpx.AsyncClient, requested_model: str | None):
        self.audit, self.http, self.requested_model = audit, http, requested_model
        self.done = False

    def _linked_models(self) -> list[str]:
        prop = self.audit.property
        ref = next((r for r in prop.source_refs if r.provider == "CoStar"), None) if prop else None
        rec = costar.get(int(ref.source_record_id)) if ref else None
        ids = list(rec["model_ids"]) if rec else []
        if self.requested_model and self.requested_model not in ids:
            ids.append(self.requested_model)
        return ids

    async def call(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        a = self.audit
        if name == "make_plan":
            steps = [str(s)[:160] for s in args.get("steps", [])][:9]
            if len(steps) < 3:
                raise ValueError("give 3 to 9 steps")
            return runner.set_plan(a, steps)
        if name == "get_property_record":
            return runner.step_fixture(a) if a.is_synthetic else runner.step_record(a)
        if name == "fetch_aerial_image":
            if a.is_synthetic:
                return {"synthetic": True, "note": "The synthetic demo uses a labelled site schematic, not imagery."}
            return await runner.step_aerial(a, self.http)
        if name == "load_interior_scan":
            if a.is_synthetic:
                return {"synthetic": True, "note": "No 3D scan exists for the synthetic demo."}
            mid = str(args.get("model_id", ""))
            linked = self._linked_models()
            if mid not in linked:
                raise ValueError(f"not linked to this property; choose one of {linked}")
            return await runner.step_interior(a, self.http, mid)
        if name == "cross_check_identity":
            return runner.step_identity(a)
        if name == "run_ada_checks":
            return runner.step_rules(a)
        if name == "finish":
            summary = str(args.get("summary", "")).strip()
            if hit := FORBIDDEN.search(summary):
                raise ValueError(f"summary uses '{hit.group(0)}'; this is a screening, rephrase without legal conclusions")
            if len(summary.split()) > 140:
                raise ValueError("summary is over 120 words")
            if not a.findings:
                runner.step_rules(a)
            a.narrative = summary
            runner.step_report(a)
            self.done = True
            return {"ok": True}
        raise ValueError(f"unknown tool {name}")


def _brief(audit: Audit, requested_model: str | None) -> str:
    p = audit.property
    assert p is not None
    lines = [f"Screen this property: {p.name}", f"Address: {p.address or 'unknown'}",
             f"Coordinates: {p.lat}, {p.lon}" if p.lat is not None else "Coordinates: unknown",
             "This is the SYNTHETIC demo property, not a real building." if audit.is_synthetic else
             "The requester confirmed they own or are authorized to audit it."]
    if requested_model:
        lines.append(f"The user pre-selected Matterport scan {requested_model}; load it unless the record suggests a better public-area scan.")
    return "\n".join(lines)


async def run(audit: Audit, requested_model: str | None) -> None:
    client = anthropic.AsyncAnthropic(max_retries=3, timeout=120)
    runner.emit(audit, "PLANNED", "orchestrator", f"AI agent ({model_name()}) is planning the audit.")
    coverage = runner.step_coverage(audit)  # always recorded, whatever the agent decides
    brief = _brief(audit, requested_model) + "\nConnected sources (already checked):\n" + json.dumps(coverage["sources"])
    messages: list[dict[str, Any]] = [{"role": "user", "content": brief}]
    async with httpx.AsyncClient() as http:
        tools = _Tools(audit, http, requested_model)
        for _ in range(MAX_TURNS):
            resp = await client.beta.messages.create(
                model=model_name(), max_tokens=16000, system=SYSTEM, tools=TOOLS, messages=messages,
                output_config={"effort": "medium"},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                cache_control={"type": "ephemeral"},  # each turn resends the history; cache it
            )
            record_usage(audit, resp)
            if resp.stop_reason == "refusal":
                raise RuntimeError("model declined")
            messages.append({"role": "assistant", "content": resp.content})  # keep thinking blocks intact
            for b in resp.content:
                if b.type == "text" and b.text.strip():
                    runner.emit(audit, "AGENT_NOTE", "orchestrator", b.text.strip()[:400])
            calls = [b for b in resp.content if b.type == "tool_use"]
            if not calls:
                break
            results = []
            for c in calls:
                try:
                    out = await tools.call(c.name, dict(c.input or {}))
                    results.append({"type": "tool_result", "tool_use_id": c.id, "content": json.dumps(out, default=str)[:12000]})
                except Exception as e:
                    runner.emit(audit, "AGENT_NOTE", ROLE.get(c.name, "orchestrator"),
                                f"Tool {c.name} returned an error to the agent: {e}"[:400], tool=c.name, error_class=type(e).__name__)
                    results.append({"type": "tool_result", "tool_use_id": c.id, "content": f"Error: {e}", "is_error": True})
            messages.append({"role": "user", "content": results})
            store.save(audit)
            if tools.done:
                break

    # The agent may stop early; the audit must still end with rule results and a report.
    if not tools.done:
        if not audit.data_availability:
            runner.step_coverage(audit)
        if not audit.findings:
            runner.step_rules(audit)
        runner.emit(audit, "AGENT_NOTE", "orchestrator", "Agent ended without a summary; report assembled from rule results only.")
        runner.step_report(audit)
    for u in audit.usage:
        runner.emit(audit, "AGENT_NOTE", "orchestrator", usage_line(u))
    store.save(audit)


# List prices in USD per million tokens: input, cache write (5 min), cache read, output.
# Update when prices change; an unknown model gets tokens but no cost estimate.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-5-5": (4.00, 5.00, 0.20, 20.00),
    "claude-sonnet-5-5": (2.00, 2.50, 0.10, 10.00),
    "claude-haiku-5-5": (0.10, 0.125, 0.01, 0.50),
    "claude-opus-4-8": (5.00, 6.25, 0.50, 25.00),
}


def record_usage(audit: Audit, resp: Any) -> None:
    """Add one response's token counts to the audit, keyed by the model that served it."""
    u = getattr(resp, "usage", None)
    if u is None:
        return
    served = getattr(resp, "model", None) or model_name()
    row = next((r for r in audit.usage if r.model == served), None)
    if row is None:
        row = ModelUsage(model=served)
        audit.usage.append(row)
    row.requests += 1
    row.input_tokens += getattr(u, "input_tokens", 0) or 0
    row.cache_write_tokens += getattr(u, "cache_creation_input_tokens", 0) or 0
    row.cache_read_tokens += getattr(u, "cache_read_input_tokens", 0) or 0
    row.output_tokens += getattr(u, "output_tokens", 0) or 0
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
