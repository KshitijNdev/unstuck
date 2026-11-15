"""Scripted audit pipeline.

This is a fixed sequence of steps, NOT an LLM agent. It emits the event log from handoff
§7.3 so the UI and the later Deep Agents orchestrator share one contract. Actor names
match the planned subagents.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from typing import Any

import httpx

from .. import store
from ..models import AgentEvent, Audit, Door, Evidence, Facility, Measurement, now_iso
from ..providers import costar, fixture, matterport, sources_status, usgs, vexcel
from .evaluate import evaluate

MAX_RETRIES = 2


def _delay() -> float:
    return float(os.environ.get("UNSTUCK_STEP_DELAY", "0.5"))


def emit(audit: Audit, type_: str, actor: str, summary: str, *, tool: str | None = None,
         source_id: str | None = None, payload: Any = None, latency_ms: int | None = None,
         error_class: str | None = None, retry_count: int = 0) -> None:
    """Append an event and persist. Payloads are hashed, never stored; no secrets are logged."""
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16] if payload is not None else None
    audit.events.append(AgentEvent(
        seq=len(audit.events) + 1, type=type_, actor=actor, tool=tool, property_id=audit.property_id,
        source_id=source_id, summary=summary, payload_hash=digest, latency_ms=latency_ms,
        error_class=error_class, retry_count=retry_count,
    ))
    store.save(audit)


async def _step(audit: Audit) -> None:
    store.save(audit)
    if _delay():
        await asyncio.sleep(_delay())


async def _fetch(audit: Audit, actor: str, tool: str, what: str, call):
    """Run a provider call with capped exponential backoff. Returns the result, or None after logging failure."""
    emit(audit, "FETCH_STARTED", actor, f"Requesting {what}.", tool=tool)
    for attempt in range(MAX_RETRIES + 1):
        started = time.monotonic()
        try:
            result = await call()
            emit(audit, "FETCH_SUCCESS", actor, f"Received {what}.", tool=tool,
                 latency_ms=int((time.monotonic() - started) * 1000), retry_count=attempt)
            return result
        except (PermissionError, LookupError, ValueError) as e:  # retrying will not help
            emit(audit, "FETCH_FAILURE", actor, f"{what}: {e}", tool=tool, error_class=type(e).__name__, retry_count=attempt)
            return None
        except Exception as e:  # network / server errors: retry
            emit(audit, "FETCH_FAILURE", actor, f"{what} failed ({type(e).__name__})" + ("; retrying." if attempt < MAX_RETRIES else "; giving up."),
                 tool=tool, error_class=type(e).__name__, retry_count=attempt)
            if attempt < MAX_RETRIES:
                await asyncio.sleep(min(0.5 * 2 ** attempt, 4) if _delay() else 0)
    return None


async def run_audit(audit_id: str, matterport_model_id: str | None = None, user_selected: bool = True) -> None:
    audit = store.get(audit_id)
    if audit is None:
        return
    audit.status = "RUNNING"
    try:
        from ..agents import orchestrator  # local import: the agent is optional
        if orchestrator.available():
            try:
                audit.engine = "deep_agent"
                await orchestrator.run(audit, matterport_model_id if user_selected else None)
            except Exception as e:  # model or tool trouble: finish the audit with the fixed script
                for u in audit.usage:  # tokens already spent still count
                    emit(audit, "AGENT_NOTE", "orchestrator", orchestrator.usage_line(u))
                emit(audit, "FETCH_FAILURE", "orchestrator",
                     f"Deep Agent stopped ({type(e).__name__}: {str(e)[:160]}); finishing with the scripted pipeline (no AI model).", error_class=type(e).__name__)
                _reset_for_script(audit)
                await _run(audit, matterport_model_id)
        else:
            await _run(audit, matterport_model_id)
        audit.status = "COMPLETE"
    except Exception as e:  # keep the audit readable even if a step blows up
        audit.status = "FAILED"
        emit(audit, "FETCH_FAILURE", "orchestrator", f"Audit stopped: {type(e).__name__}.", error_class=type(e).__name__)
    audit.completed_at = now_iso()
    store.save(audit)


def _reset_for_script(audit: Audit) -> None:
    audit.engine = "scripted_pipeline"
    audit.plan, audit.evidence, audit.measurements, audit.observations, audit.findings = [], [], [], [], []
    if audit.property is not None:  # doorways the agent read from a scan go too; the script re-reads them
        audit.property.doors = [d for d in audit.property.doors if d.source != "matterport_floorplan"]
    audit.narrative = None


SCRIPT_PLAN = [
    "Check which data sources are available for this property",
    "Property investigator: look up the property record",
    "Exterior inspector: fetch aerial imagery of the site",
    "Interior inspector: load the 3D model if one is authorized and measure its doorway openings",
    "Cross-check that every source describes the same property",
    "Run deterministic ADA 2010 numeric screens on structured measurements",
    "Queue anything unmeasured for human review",
    "Assemble the evidence-backed report",
]


# ---- steps (shared by the scripted pipeline and the agent's tools) ---------
# Each returns a short plain dict describing what happened, which the agent reads.

def set_plan(audit: Audit, steps: list[str], actor: str = "orchestrator") -> dict:
    audit.plan = steps
    assert audit.property is not None
    emit(audit, "PLANNED", actor, f"Planned {len(steps)} steps for {audit.property.name}.", payload=steps)
    return {"plan_steps": len(steps)}


def step_coverage(audit: Audit) -> dict:
    audit.data_availability = sources_status()
    for s in audit.data_availability:
        if s.state == "unavailable":
            emit(audit, "SOURCE_MISSING", "orchestrator", f"{s.provider} ({s.layer}) unavailable: {s.detail}", source_id=s.provider)
    return {"sources": [{"provider": s.provider, "layer": s.layer, "state": s.state, "detail": s.detail}
                        for s in audit.data_availability]}


def step_fixture(audit: Audit) -> dict:
    prop = audit.property
    assert prop is not None
    _, evidence, measurements, observations = fixture.load(audit.id)
    audit.evidence, audit.measurements, audit.observations = evidence, measurements, observations
    emit(audit, "FETCH_SUCCESS", "property_investigator", "Loaded SYNTHETIC fixture record. Not a real building.",
         tool="fixture.load", source_id="fixture", payload=prop.model_dump())
    emit(audit, "FETCH_SUCCESS", "exterior_inspector", "Loaded SYNTHETIC site schematic and synthetic counts. No imagery involved.",
         tool="fixture.load", source_id="fixture")
    return {"synthetic": True, "evidence": len(evidence), "measurements": len(measurements),
            "unmeasured_observations": len(observations)}


def step_record(audit: Audit) -> dict:
    prop = audit.property
    assert prop is not None
    ref = next((r for r in prop.source_refs if r.provider == "CoStar"), None)
    rec = costar.get(int(ref.source_record_id)) if ref else None
    if rec:
        unknown = [k for k in ("type", "year_built", "surface_spaces") if rec.get(k) is None]
        emit(audit, "FETCH_SUCCESS", "property_investigator",
             f"CoStar record {rec['id']}: {rec['type']}, built {rec['year_built'] or 'UNKNOWN'}, "
             f"surface parking {rec['surface_spaces'] if rec['surface_spaces'] is not None else 'UNKNOWN'} spaces, "
             f"{len(rec['model_ids'])} linked Matterport scan(s)."
             + (f" Unknown in record: {', '.join(unknown)}." if unknown else ""),
             tool="costar.get", source_id=f"CoStar:{rec['id']}", payload=rec)
        if not any(e.id == f"ev_costar_{prop.id}" for e in audit.evidence):
            audit.evidence.append(Evidence(
                id=f"ev_costar_{prop.id}", property_id=prop.id, provider="CoStar", provider_asset_id=str(rec["id"]),
                asset_type="record", retrieved_at=now_iso(), geometry={"summary": rec}, rights=costar.RIGHTS,
                quality="Research record. Parking is a property-wide count by type, not a per-lot count.",
                is_sponsor_source=True))
            if rec["surface_spaces"] is not None:
                audit.measurements.append(Measurement(
                    id=f"m_costar_{rec['id']}", audit_id=audit.id, location_id="lot_main", name="parking_total_spaces",
                    value=rec["surface_spaces"], unit="spaces", method="record", evidence_id=f"ev_costar_{prop.id}",
                    notes="CoStar surface parking total for the property. Not counted on imagery."))
        return {"found": True, "record": {k: rec.get(k) for k in ("id", "name", "type", "year_built", "surface_spaces", "model_ids")},
                "unknown_fields": unknown}
    if costar.status().state == "unavailable":
        emit(audit, "SOURCE_MISSING", "property_investigator",
             "No CoStar record: use type, year built and parking count are UNKNOWN, not guessed.", source_id="CoStar")
        return {"found": False, "reason": "CoStar data is not available on this server"}
    emit(audit, "SOURCE_MISSING", "property_investigator",
         "This property was entered by hand and is not matched to a CoStar record; record fields stay UNKNOWN.", source_id="CoStar")
    return {"found": False, "reason": "property entered by hand, not matched to a CoStar record"}


async def step_aerial(audit: Audit, client: httpx.AsyncClient) -> dict:
    """Sponsor source first, labelled public fallback second."""
    prop = audit.property
    assert prop is not None
    if any(e.asset_type == "aerial_image" for e in audit.evidence):
        return {"already_loaded": True}
    aerial = None
    if prop.lat is not None and prop.lon is not None:
        if vexcel.status().state != "unavailable":
            aerial = await _fetch(audit, "exterior_inspector", "vexcel.ortho_extract", "Vexcel orthophoto",
                                  lambda: vexcel.fetch_aerial(client, audit.id, prop.id, prop.lat, prop.lon))
        if aerial is None:
            aerial = await _fetch(audit, "exterior_inspector", "usgs.naip_query", "USGS NAIP public fallback image",
                                  lambda: usgs.fetch_aerial(client, prop.id, prop.lat, prop.lon))
    if aerial:
        audit.evidence.append(aerial)
        return {"loaded": True, "provider": aerial.provider, "sponsor_source": aerial.is_sponsor_source,
                "capture_date": aerial.capture_date, "limits": aerial.quality}
    emit(audit, "SOURCE_MISSING", "exterior_inspector", "No aerial image for this site. Exterior checks need manual input.")
    return {"loaded": False}


async def step_interior(audit: Audit, client: httpx.AsyncClient, model_id: str | None) -> dict:
    prop = audit.property
    assert prop is not None
    if model_id and matterport.status().state != "unavailable":
        got = await _fetch(audit, "interior_inspector", "matterport.model_api", f"Matterport model {model_id}",
                           lambda: matterport.fetch_model(client, prop.id, model_id))
        if got:
            audit.evidence = [e for e in audit.evidence if e.asset_type != "tour"] + [got[0]]
            summary = {k: v for k, v in got[1].items() if k not in ("doorways", "rooms")}
            summary["doorways_in_floor_plan"] = len(got[1]["doorways"])
            summary["rooms"] = len(got[1]["rooms"])
            return {"loaded": True, "summary": summary,
                    "note": ("Doorway openings are in this scan's floor plan; measure them next."
                             if got[1]["doorways"] else
                             "This scan has no doorways in its floor plan, so no door can be measured from it.")}
        return {"loaded": False, "reason": "fetch failed"}
    emit(audit, "SOURCE_MISSING", "interior_inspector",
         "No authorized Matterport model for this property. Door widths need a field measurement.", source_id="Matterport")
    return {"loaded": False, "reason": "no authorized model"}


def step_doorways(audit: Audit, actor: str = "interior_inspector") -> dict:
    """Record every doorway opening in the loaded scan's floor plan as a measurement on its own door.

    Widths come straight from Matterport (metres converted to inches in providers/matterport.py).
    They are frame openings, so the rule engine can only use them to suspect a narrow door.
    """
    prop = audit.property
    assert prop is not None
    tour = next((e for e in audit.evidence if e.asset_type == "tour"), None)
    # Forget doorways from any previously loaded scan.
    old = {d.id for d in prop.doors if d.source == "matterport_floorplan"}
    prop.doors = [d for d in prop.doors if d.id not in old]
    audit.measurements = [m for m in audit.measurements if not (m.location_id in old and m.method == "scan_floorplan")]
    if tour is None:
        emit(audit, "SOURCE_MISSING", actor, "No 3D scan is loaded, so no doorway can be measured.", source_id="Matterport")
        return {"measured": 0, "reason": "no scan loaded"}
    summ = (tour.geometry or {}).get("summary") or {}
    found = summ.get("doorways") or []
    model_id = tour.provider_asset_id
    if not found:
        emit(audit, "SOURCE_MISSING", actor,
             f"Scan {model_id} has no doorways in its floor plan, so no door can be measured from it. "
             "Doors need a measurement in the 3D tour or on site.", source_id=f"Matterport:{model_id}")
        return {"measured": 0, "reason": "this scan's floor plan has no doorways" if summ.get("has_floor_plan")
                else "this scan has no floor plan"}
    for i, d in enumerate(found, 1):
        did = "scan_door_" + "".join(ch for ch in f"{model_id}_{d['opening_id']}" if ch.isalnum() or ch == "_")[:60]
        prop.doors.append(Door(id=did, label=f"Scan doorway {i}, {d['floor']} ({d['kind']})", priority=2,
                               source="matterport_floorplan", model_id=model_id))
        note = f"Matterport floor-plan opening {d['opening_id']} in scan {model_id}. Frame gap, not clear width."
        if d["width_in"] is not None:
            audit.measurements.append(Measurement(
                id=f"m_{did}_w", audit_id=audit.id, location_id=did, name="door_opening_width_in", value=d["width_in"],
                unit="in", method="scan_floorplan", evidence_id=tour.id, notes=note))
        if d["wall_thickness_in"] is not None:
            audit.measurements.append(Measurement(
                id=f"m_{did}_t", audit_id=audit.id, location_id=did, name="door_wall_thickness_in",
                value=d["wall_thickness_in"], unit="in", method="scan_floorplan", evidence_id=tour.id, notes=note))
    widths = [d["width_in"] for d in found if d["width_in"] is not None]
    emit(audit, "FETCH_SUCCESS", actor,
         f"Measured {len(found)} doorway opening(s) in scan {model_id}'s floor plan"
         + (f", {min(widths):g} to {max(widths):g} in wide." if widths else ".")
         + " These are frame openings; clear width is narrower.",
         tool="matterport.floor_plan", source_id=f"Matterport:{model_id}", payload=found)
    return {"measured": len(found), "doorways": [{"label": f"Scan doorway {i}", "floor": d["floor"], "kind": d["kind"],
            "opening_width_in": d["width_in"]} for i, d in enumerate(found, 1)][:40],
            "note": "Widths are frame openings from the floor plan. run_ada_checks decides what they mean."}


def step_identity(audit: Audit) -> dict:
    prop = audit.property
    assert prop is not None
    providers = sorted({e.provider for e in audit.evidence})
    mp = next((e for e in audit.evidence if e.provider == "Matterport"), None)
    dist = None
    if audit.is_synthetic:
        note = "Synthetic fixture: nothing to cross-check."
    elif mp and prop.lat is not None and (mp.geometry or {}).get("summary", {}).get("lat") is not None:
        s = mp.geometry["summary"]
        dist = (((s["lat"] - prop.lat) * 111_320) ** 2 + ((s["lon"] - prop.lon) * 92_000) ** 2) ** 0.5
        note = (f"Matterport model is about {dist:.0f} m from the entered coordinates"
                + (" (consistent; a person must still confirm it is the same building)." if dist < 60
                   else ". MISMATCH: treat the tour as a different property until a person confirms."))
    else:
        note = f"Located sources: {', '.join(providers) or 'none'}. Cross-source identity is unconfirmed until a person checks it."
    emit(audit, "REVIEW_REQUESTED" if not audit.is_synthetic else "PLANNED", "orchestrator", note)
    return {"providers": providers, "matterport_distance_m": round(dist) if dist is not None else None, "note": note}


def step_rules(audit: Audit) -> dict:
    for obs in audit.observations:
        emit(audit, "OBSERVATION_PROPOSED", "exterior_inspector", f"{obs['title']} (unmeasured, suspected only).", payload=obs)
    reevaluate(audit, announce=True)
    return {"findings": [{"id": f.id, "title": f.title, "location": f.location, "status": f.status, "label": f.label,
                          "required": f.required, "observed": f.observed, "followup": f.followup}
                         for f in audit.findings]}


def step_report(audit: Audit, actor: str = "report_author") -> None:
    emit(audit, "REPORT_READY", actor,
         f"Report ready: {len(audit.findings)} checks. Screening only, not a compliance determination.")


async def _run(audit: Audit, matterport_model_id: str | None) -> None:
    """The fixed scripted pipeline: same steps, fixed order, no model."""
    audit.status = "RUNNING"
    set_plan(audit, list(SCRIPT_PLAN))
    await _step(audit)
    step_coverage(audit)
    await _step(audit)
    async with httpx.AsyncClient() as client:
        if audit.is_synthetic:
            step_fixture(audit)
            await _step(audit)
        else:
            step_record(audit)
            await _step(audit)
            await step_aerial(audit, client)
            await _step(audit)
            await step_interior(audit, client, matterport_model_id)
            step_doorways(audit)
            await _step(audit)
    step_identity(audit)
    await _step(audit)
    step_rules(audit)
    await _step(audit)
    step_report(audit)


def reevaluate(audit: Audit, announce: bool = False) -> None:
    """Re-run the rule engine and log each result."""
    audit.findings = evaluate(audit)
    waiting = []  # scan doorways that only need measuring: one log line for all of them
    for f in audit.findings:
        if f.status == "SUSPECTED_VISUAL_BARRIER" and not f.location_id.startswith("scan_door_"):
            continue
        if (f.location_id.startswith("scan_door_") and f.confidence in ("SCAN_FLOORPLAN", "NO_MEASUREMENT")
                and f.status in ("FIELD_VERIFICATION_REQUIRED", "INSUFFICIENT_DATA")):
            waiting.append(f)
            continue
        emit(audit, "RULE_EVALUATED", "rules_evaluator", f"{f.title} at {f.location}: {f.status}.",
             tool="ada2010", payload={"required": f.required, "observed": f.observed, "status": f.status})
    if waiting:
        band = lambda name: sum(1 for f in waiting if (f.observed or {}).get("triage") == name)  # noqa: E731
        first, either, wide = band("likely_narrow"), band("measure"), band("likely_wide")
        sorted_note = (f" Sorted by scan width: {first} to measure first, {either} that could go either way, "
                       f"{wide} likely wide enough.") if first + either + wide else ""
        emit(audit, "RULE_EVALUATED", "rules_evaluator",
             f"Door clear opening width at {len(waiting)} other scan doorway(s): needs measurement "
             f"(a floor-plan opening cannot pass a door).{sorted_note}", tool="ada2010",
             payload=[{"location": f.location, "status": f.status, "observed": f.observed} for f in waiting])
    if announce:
        pending = [f for f in audit.findings if f.label != "measured"]
        if pending:
            emit(audit, "REVIEW_REQUESTED", "orchestrator", f"{len(pending)} check(s) need a person: measurements missing or unverified.")
    store.save(audit)


def default_layout() -> tuple[list[Facility], list[Door]]:
    """Minimum things to check at a real property when no record tells us more."""
    return ([Facility(id="lot_main", label="Parking lot (boundary unconfirmed)")],
            [Door(id="door_entrance", label="Main public entrance", priority=1)])
