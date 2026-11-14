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
from ..models import AgentEvent, Audit, Door, Facility, now_iso
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


async def run_audit(audit_id: str, matterport_model_id: str | None = None) -> None:
    audit = store.get(audit_id)
    if audit is None:
        return
    try:
        await _run(audit, matterport_model_id)
        audit.status = "COMPLETE"
    except Exception as e:  # keep the audit readable even if a step blows up
        audit.status = "FAILED"
        emit(audit, "FETCH_FAILURE", "orchestrator", f"Audit stopped: {type(e).__name__}.", error_class=type(e).__name__)
    audit.completed_at = now_iso()
    store.save(audit)


async def _run(audit: Audit, matterport_model_id: str | None) -> None:
    audit.status = "RUNNING"
    prop = audit.property
    assert prop is not None
    audit.plan = [
        "Check which data sources are available for this property",
        "Property investigator: look up the property record",
        "Exterior inspector: fetch aerial imagery of the site",
        "Interior inspector: load the 3D model if one is authorized",
        "Cross-check that every source describes the same property",
        "Run deterministic ADA 2010 numeric screens on structured measurements",
        "Queue anything unmeasured for human review",
        "Assemble the evidence-backed report",
    ]
    emit(audit, "PLANNED", "orchestrator", f"Planned {len(audit.plan)} steps for {prop.name}.", payload=audit.plan)
    await _step(audit)

    # ---- coverage -----------------------------------------------------------
    audit.data_availability = sources_status()
    for s in audit.data_availability:
        if s.state == "unavailable":
            emit(audit, "SOURCE_MISSING", "orchestrator", f"{s.provider} ({s.layer}) unavailable: {s.detail}", source_id=s.provider)
    await _step(audit)

    async with httpx.AsyncClient() as client:
        if audit.is_synthetic:
            _, evidence, measurements, observations = fixture.load(audit.id)
            audit.evidence, audit.measurements, audit.observations = evidence, measurements, observations
            emit(audit, "FETCH_SUCCESS", "property_investigator", "Loaded SYNTHETIC fixture record. Not a real building.",
                 tool="fixture.load", source_id="fixture", payload=prop.model_dump())
            await _step(audit)
            emit(audit, "FETCH_SUCCESS", "exterior_inspector", "Loaded SYNTHETIC site schematic and synthetic counts. No imagery involved.",
                 tool="fixture.load", source_id="fixture")
            await _step(audit)
        else:
            # property record
            if costar.status().state == "unavailable":
                emit(audit, "SOURCE_MISSING", "property_investigator",
                     "No CoStar record: use type, year built and parking count are UNKNOWN, not guessed.", source_id="CoStar")
            else:
                emit(audit, "SOURCE_MISSING", "property_investigator",
                     "CoStar extract is on disk but no field mapping exists yet; record fields stay UNKNOWN.", source_id="CoStar")
            await _step(audit)

            # aerial: sponsor source first, labelled public fallback second
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
            else:
                emit(audit, "SOURCE_MISSING", "exterior_inspector", "No aerial image for this site. Exterior checks need manual input.")
            await _step(audit)

            # interior
            if matterport_model_id and matterport.status().state != "unavailable":
                got = await _fetch(audit, "interior_inspector", "matterport.model_api", f"Matterport model {matterport_model_id}",
                                   lambda: matterport.fetch_model(client, prop.id, matterport_model_id))
                if got:
                    audit.evidence.append(got[0])
            else:
                emit(audit, "SOURCE_MISSING", "interior_inspector",
                     "No authorized Matterport model for this property. Door widths need a field measurement.", source_id="Matterport")
            await _step(audit)

    # ---- identity cross-check ----------------------------------------------
    providers = sorted({e.provider for e in audit.evidence})
    mp = next((e for e in audit.evidence if e.provider == "Matterport"), None)
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
    await _step(audit)

    for obs in audit.observations:
        emit(audit, "OBSERVATION_PROPOSED", "exterior_inspector", f"{obs['title']} (unmeasured, suspected only).", payload=obs)

    reevaluate(audit, announce=True)
    await _step(audit)
    emit(audit, "REPORT_READY", "report_author",
         f"Report ready: {len(audit.findings)} checks. Screening only, not a compliance determination.")


def reevaluate(audit: Audit, announce: bool = False) -> None:
    """Re-run the rule engine and log each result."""
    audit.findings = evaluate(audit)
    for f in audit.findings:
        if f.status == "SUSPECTED_VISUAL_BARRIER":
            continue
        emit(audit, "RULE_EVALUATED", "rules_evaluator", f"{f.title} at {f.location}: {f.status}.",
             tool="ada2010", payload={"required": f.required, "observed": f.observed, "status": f.status})
    if announce:
        pending = [f for f in audit.findings if f.label != "measured"]
        if pending:
            emit(audit, "REVIEW_REQUESTED", "orchestrator", f"{len(pending)} check(s) need a person: measurements missing or unverified.")
    store.save(audit)


def default_layout() -> tuple[list[Facility], list[Door]]:
    """Minimum things to check at a real property when no record tells us more."""
    return ([Facility(id="lot_main", label="Parking lot (boundary unconfirmed)")],
            [Door(id="door_entrance", label="Main public entrance", priority=1)])
