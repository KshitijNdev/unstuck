from __future__ import annotations

import asyncio
import hashlib
import json
import uuid

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from fastapi.responses import StreamingResponse

from .. import store
from ..models import (MEASUREMENT_NAMES, Audit, CreateAudit, Measurement, MeasurementIn, Property,
                      SourceRef, VerifyIn, now_iso)
from ..pipeline import runner
from ..models import Door, Facility, ModelIn, PinsIn
from ..providers import costar, fixture, matterport, sources_status, vexcel
from ..rules import ada2010

router = APIRouter(prefix="/api")

DISCLAIMER = (
    "Unstuck is an accessibility screening and evidence tool. It is not a certified ADA inspection, "
    "a legal compliance determination, or a substitute for a CASp, RAS or qualified accessibility "
    "consultant and field measurements."
)


def _audit(audit_id: str) -> Audit:
    audit = store.get(audit_id)
    if audit is None:
        raise HTTPException(404, "Audit not found")
    return audit


@router.get("/usage")
def get_usage():
    """Running total of AI model tokens across every audit on this server."""
    return store.usage_totals()


@router.get("/sources/status")
def get_sources_status():
    from ..agents import orchestrator
    if orchestrator.available():
        return {"sources": sources_status(), "engine": "deep_agent", "model": orchestrator.model_name(),
                "engine_note": f"A LangChain Deep Agent ({orchestrator.model_name()}) plans each audit and delegates to three "
                               "subagents: property investigator, exterior inspector and interior inspector, which measures "
                               "doorway openings in the Matterport floor plan. Every check result comes from the tested "
                               "rule engine, not the model."}
    return {"sources": sources_status(), "engine": "scripted_pipeline",
            "engine_note": "Fixed scripted pipeline (no model key configured). Same checks, fixed order."}


@router.get("/properties/demo")
def demo_properties():
    return {"properties": [fixture.demo_listing()]}


@router.get("/properties/search")
def search_properties(q: str = "", city: str | None = None, limit: int = 25):
    """Non-residential CoStar properties that have a Matterport scan. Hackathon data, hackathon use only."""
    return {"properties": costar.search(q, city, min(max(limit, 1), 50)), "rights": costar.RIGHTS,
            "available": costar.status().state != "unavailable"}


@router.post("/audits", status_code=202)
def create_audit(body: CreateAudit, background: BackgroundTasks):
    if body.standard_profile != ada2010.STANDARD_PROFILE:
        raise HTTPException(400, f"Unsupported standard profile. Only {ada2010.STANDARD_PROFILE} is implemented.")
    audit_id = f"audit_{uuid.uuid4().hex[:10]}"
    model_id = None
    if body.property_id == fixture.FIXTURE_PROPERTY_ID:
        if not body.allow_synthetic_fixture:
            raise HTTPException(400, "This is a synthetic fixture. Set allow_synthetic_fixture to run it.")
        prop, *_ = fixture.load(audit_id)
        synthetic = True
    elif body.costar_property_id is not None:
        if not body.ownership_authorized:
            raise HTTPException(403, "Confirm you are authorized to screen this property.")
        rec = costar.get(body.costar_property_id)
        if rec is None:
            raise HTTPException(404, "No such property in the CoStar extract (or the extract is not loaded).")
        if body.matterport_model_id and body.matterport_model_id not in rec["model_ids"]:
            raise HTTPException(400, "That Matterport model is not linked to this property in the CoStar crosswalk.")
        prop = Property(
            id=f"costar_{rec['id']}", name=rec["name"],
            address=", ".join(x for x in (rec["address"], rec["city"], rec["state"]) if x) or None,
            city=rec["city"], state=rec["state"], lat=rec["lat"], lon=rec["lon"], type=rec["type"],
            year_built=rec["year_built"],
            facilities=[Facility(id="lot_main", label="Surface parking (property-wide, lots not yet separated)")],
            doors=[Door(id="door_entrance", label="Main public entrance", priority=1)],
            ownership_authorized=True,
            source_refs=[SourceRef(provider="CoStar", source_record_id=str(rec["id"]), retrieved_at=now_iso(), rights=costar.RIGHTS)])
        synthetic = False
        model_id = body.matterport_model_id or (rec["model_ids"][0] if rec["model_ids"] else None)
    elif body.custom_property is not None:
        if not body.ownership_authorized:
            raise HTTPException(403, "Confirm you own this property or are authorized to audit it.")
        c = body.custom_property
        facilities, doors = runner.default_layout()
        pid = "prop_" + hashlib.sha256(f"{c.name}|{c.lat:.6f}|{c.lon:.6f}".encode()).hexdigest()[:10]
        prop = Property(id=pid, name=c.name, address=c.address, lat=c.lat, lon=c.lon, facilities=facilities,
                        doors=doors, ownership_authorized=True,
                        source_refs=[SourceRef(provider="user_entered", retrieved_at=now_iso())])
        synthetic, model_id = False, c.matterport_model_id
    else:
        raise HTTPException(400, "Provide the demo property_id or a custom_property.")

    from ..agents import orchestrator
    audit = Audit(id=audit_id, property_id=prop.id, mode=body.mode, standard_profile=body.standard_profile,
                  is_synthetic=synthetic, property=prop,
                  # set up front so the page never shows "scripted" for an agent audit while it is queued
                  engine="deep_agent" if orchestrator.available() else "scripted_pipeline")
    store.save(audit)
    # The agent is told about a scan only when the user picked it; the script falls back to the first linked scan.
    background.add_task(runner.run_audit, audit_id, model_id, bool(body.matterport_model_id))
    return {"audit_id": audit_id, "status": "QUEUED", "status_url": f"/api/audits/{audit_id}"}


@router.get("/audits/{audit_id}")
def get_audit(audit_id: str):
    return _audit(audit_id)


@router.get("/audits/{audit_id}/findings")
def get_findings(audit_id: str):
    return {"audit_id": audit_id, "findings": _audit(audit_id).findings, "disclaimer": DISCLAIMER}


@router.get("/audits/{audit_id}/events")
async def stream_events(audit_id: str, after: int = 0):
    _audit(audit_id)

    async def gen():
        sent = after
        while True:
            audit = store.get(audit_id)
            if audit is None:
                break
            for e in audit.events[sent:]:
                yield f"id: {e.seq}\nevent: agent_event\ndata: {e.model_dump_json()}\n\n"
            sent = max(sent, len(audit.events))
            if audit.status in ("COMPLETE", "FAILED"):
                yield f"event: done\ndata: {json.dumps({'status': audit.status})}\n\n"
                break
            await asyncio.sleep(0.25)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/audits/{audit_id}/measurements")
def add_measurement(audit_id: str, body: MeasurementIn):
    audit = _audit(audit_id)
    if audit.status not in ("COMPLETE",):
        raise HTTPException(409, "Wait for the audit to finish before adding measurements.")
    if body.name not in MEASUREMENT_NAMES:
        raise HTTPException(400, f"Unknown measurement name. Allowed: {sorted(MEASUREMENT_NAMES)}")
    prop = audit.property
    is_parking = body.name.startswith("parking_")
    valid = {f.id for f in prop.facilities} if is_parking else {d.id for d in prop.doors}
    if body.location_id not in valid:
        raise HTTPException(400, "location_id does not match this kind of measurement for this property.")
    if is_parking and body.value != int(body.value):
        raise HTTPException(400, "Parking counts must be whole numbers.")
    expected_unit = "spaces" if is_parking else "in"
    if body.unit != expected_unit:
        raise HTTPException(400, f"Unit for {body.name} must be '{expected_unit}'.")

    m = Measurement(id=f"m_{uuid.uuid4().hex[:8]}", audit_id=audit_id, **body.model_dump())
    audit.measurements.append(m)
    try:
        runner.emit(audit, "OBSERVATION_PROPOSED", "human_reviewer",
                    f"{body.reviewed_by} recorded {body.name} = {body.value:g} {body.unit} ({body.method}).", payload=m.model_dump())
        runner.reevaluate(audit)
    except ValueError as e:  # e.g. accessible count larger than total
        audit = _audit(audit_id)
        audit.measurements = [x for x in audit.measurements if x.id != m.id]
        store.save(audit)
        raise HTTPException(400, f"Measurement rejected: {e}")
    return {"measurement": m, "findings": audit.findings}


@router.post("/audits/{audit_id}/markups")
def save_markups(audit_id: str, body: PinsIn):
    """A person marks accessible stalls on the aerial image. The marks become the observed counts (method: manual)
    and stay attached to the image as evidence. Zero marks is a valid answer: "I looked and found none"."""
    audit = _audit(audit_id)
    if audit.status != "COMPLETE":
        raise HTTPException(409, "Wait for the audit to finish before marking the image.")
    ev = next((e for e in audit.evidence if e.asset_type == "aerial_image"), None)
    if ev is None or not audit.property.facilities:
        raise HTTPException(404, "This audit has no aerial image to mark.")
    lot = audit.property.facilities[0].id
    before = (dict(ev.geometry or {}), list(audit.measurements))
    ev.geometry = {**(ev.geometry or {}), "pins": [p.model_dump() for p in body.pins],
                   "pins_by": body.reviewed_by, "pins_at": now_iso()}
    counts = {"parking_accessible_spaces": len(body.pins),
              "parking_van_spaces": sum(1 for p in body.pins if p.kind == "van")}
    for name, value in counts.items():
        audit.measurements.append(Measurement(
            id=f"m_{uuid.uuid4().hex[:8]}", audit_id=audit_id, location_id=lot, name=name, value=value, unit="spaces",
            method="manual", evidence_id=ev.id, reviewed_by=body.reviewed_by,
            notes=f"Counted by a person from marks on the {ev.provider} image."))
    try:
        from_ai = sum(1 for p in body.pins if p.suggested)
        runner.emit(audit, "OBSERVATION_PROPOSED", "human_reviewer",
                    f"{body.reviewed_by} marked {counts['parking_accessible_spaces']} accessible stall(s), "
                    f"{counts['parking_van_spaces']} of them van-accessible, on the {ev.provider} image"
                    + (f"; {from_ai} began as AI suggestions that {body.reviewed_by} accepted." if from_ai else "."),
                    payload=counts)
        runner.reevaluate(audit)
    except ValueError as e:
        audit = _audit(audit_id)
        ev = next(e2 for e2 in audit.evidence if e2.asset_type == "aerial_image")
        ev.geometry, audit.measurements = before
        store.save(audit)
        raise HTTPException(400, f"Marks rejected: {e}")
    return {"evidence": ev, "findings": audit.findings}


@router.post("/audits/{audit_id}/markups/suggest")
async def suggest_markups(audit_id: str):
    """Ask the vision model where accessible stalls might be on the aerial image. Returns suggestions only:
    nothing is saved as a mark or a count until a person accepts them and saves through /markups."""
    from ..agents import orchestrator, stalls  # local import: the agent is optional

    audit = _audit(audit_id)
    if audit.status != "COMPLETE":
        raise HTTPException(409, "Wait for the audit to finish before asking for suggestions.")
    ev = next((e for e in audit.evidence if e.asset_type == "aerial_image"), None)
    if ev is None or ev.provider != "Vexcel" or audit.property is None:
        raise HTTPException(404, "This audit has no aerial image to look at.")
    if not orchestrator.available():
        raise HTTPException(503, "No AI model is configured, so suggestions are unavailable. Mark the stalls by hand.")
    try:
        async with httpx.AsyncClient() as client:
            image = await vexcel.fetch_image(client, audit.property.lat, audit.property.lon)
    except Exception as e:
        raise HTTPException(502, f"Imagery provider unavailable ({type(e).__name__})")
    try:
        found, notes, resp = await stalls.suggest(image)
    except Exception as e:
        runner.emit(audit, "FETCH_FAILURE", "vision_model", f"Stall suggestions failed ({type(e).__name__}).",
                    tool="suggest_stalls", error_class=type(e).__name__)
        raise HTTPException(502, f"The AI model could not read the image ({type(e).__name__}). Mark the stalls by hand.")
    audit = _audit(audit_id)  # re-read: the request above takes several seconds
    orchestrator.record_usage(audit, resp)
    runner.emit(audit, "AGENT_NOTE", "vision_model",
                f"Suggested {len(found)} possible accessible stall(s) on the {ev.provider} image. "
                "Suggestions are not counted until a person accepts them.", tool="suggest_stalls", payload=found)
    return {"suggestions": found, "notes": notes, "model": (resp.response_metadata or {}).get("model_name")}


@router.post("/audits/{audit_id}/model")
async def choose_model(audit_id: str, body: ModelIn):
    """Switch which linked Matterport scan is shown. Only scans the CoStar crosswalk links to this property are allowed."""
    audit = _audit(audit_id)
    record = next((e for e in audit.evidence if e.provider == "CoStar"), None)
    linked = ((record.geometry or {}).get("summary") or {}).get("model_ids", []) if record else []
    if body.model_id not in linked:
        raise HTTPException(400, "That scan is not linked to this property in the CoStar crosswalk.")
    try:
        async with httpx.AsyncClient() as client:
            ev, summary = await matterport.fetch_model(client, audit.property_id, body.model_id)
    except Exception as e:
        raise HTTPException(502, f"Matterport unavailable ({type(e).__name__})")
    audit.evidence = [e for e in audit.evidence if e.provider != "Matterport"] + [ev]
    runner.emit(audit, "FETCH_SUCCESS", "interior_inspector", f"Switched to Matterport scan {body.model_id} ({summary.get('name')}).",
                tool="matterport.model_api", source_id=f"Matterport:{body.model_id}")
    runner.step_doorways(audit)  # doorway checks follow the scan being shown
    runner.reevaluate(audit)
    return ev


@router.post("/findings/{finding_id}/verify")
def verify_finding(finding_id: str, body: VerifyIn):
    audit = store.find_by_finding(finding_id)
    finding = next((f for f in (audit.findings if audit else []) if f.id == finding_id), None)
    if finding is None:
        raise HTTPException(404, "Finding not found")
    if body.action == "approve" and finding.label != "measured":
        raise HTTPException(409, "Only a finding backed by a trusted measurement can be approved. Add a measurement first.")
    finding.review_status = {"approve": "APPROVED", "reject": "REJECTED", "needs_field_visit": "NEEDS_FIELD_VISIT"}[body.action]
    finding.reviewed_by, finding.review_note, finding.reviewed_at = body.reviewer, body.note, now_iso()
    runner.emit(audit, "FINDING_APPROVED" if body.action == "approve" else "REVIEW_REQUESTED", "human_reviewer",
                f"{body.reviewer} marked '{finding.title}' at {finding.location} as {finding.review_status}.")
    return finding


@router.get("/audits/{audit_id}/export")
def export_audit(audit_id: str):
    audit = _audit(audit_id)
    return {
        "disclaimer": DISCLAIMER,
        "legal_compliance_determination": False,
        "generated_at": now_iso(),
        "contains_synthetic_data": audit.is_synthetic,
        "engine": audit.engine,
        "standard_profile": audit.standard_profile,
        "standards_source": ada2010.STANDARDS_URL,
        "property": audit.property,
        "data_availability": audit.data_availability,
        "evidence": audit.evidence,
        "measurements": audit.measurements,
        "findings": audit.findings,
        "audit_trail": audit.events,
    }


@router.get("/audits/{audit_id}/evidence/{evidence_id}/image")
async def evidence_image(audit_id: str, evidence_id: str):
    """Server-side proxy for sponsor imagery so the API key never reaches the browser. Nothing is stored."""
    audit = _audit(audit_id)
    ev = next((e for e in audit.evidence if e.id == evidence_id), None)
    if ev is None or ev.provider != "Vexcel" or audit.property is None:
        raise HTTPException(404, "No proxied image for this evidence")
    try:
        async with httpx.AsyncClient() as client:
            data = await vexcel.fetch_image(client, audit.property.lat, audit.property.lon)
    except Exception as e:
        raise HTTPException(502, f"Imagery provider unavailable ({type(e).__name__})")
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})
