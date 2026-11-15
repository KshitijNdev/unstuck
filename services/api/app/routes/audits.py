from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import uuid

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from fastapi.responses import StreamingResponse

from .. import integrations, store
from ..models import (MEASUREMENT_NAMES, Audit, CreateAudit, Measurement, MeasurementIn, Property,
                      SourceRef, VerifyIn, now_iso)
from ..pipeline import runner
from ..models import AcceptEstimatesIn, Door, Facility, ModelIn, PinsIn, UseScanWidthIn
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
    rows = integrations.integrations()  # cheap: reads config and the last explicit check, never calls a provider
    vexcel_ai = os.environ.get("VEXCEL_ALLOW_AI_PROCESSING") == "1"
    if orchestrator.available():
        return {"sources": sources_status(), "integrations": rows, "vexcel_ai_allowed": vexcel_ai,
                "engine": "deep_agent", "model": orchestrator.model_name(),
                "engine_note": f"A LangChain Deep Agent ({orchestrator.model_name()}) plans each audit and delegates "
                               "to property, exterior, and interior specialists, including scan-doorway screening. "
                               "Every ADA result is calculated by the tested rule engine, not the model."}
    return {"sources": sources_status(), "integrations": rows, "vexcel_ai_allowed": vexcel_ai,
            "engine": "scripted_pipeline",
            "engine_note": "Fixed scripted pipeline (no model key configured). Same checks, fixed order."}


@router.post("/integrations/{provider}/check")
async def check_integration(provider: str):
    """Explicit live check: one cheap real call to the provider. Only runs when a person asks for it."""
    if provider not in integrations.PROVIDERS:
        raise HTTPException(404, f"Unknown integration. Known: {', '.join(integrations.PROVIDERS)}")
    return await integrations.check(provider)


@router.get("/integrations/matterport/sdk")
def matterport_sdk():
    """The Matterport SDK application key for the embedded tour. SDK keys are meant for the browser and are
    restricted by Matterport to the domains registered for them; the Model API token never leaves the server."""
    key = os.environ.get("MATTERPORT_SDK_KEY") or None
    return {"available": bool(key), "application_key": key}


@router.get("/properties/demo")
def demo_properties():
    return {"properties": [fixture.demo_listing()]}


@router.get("/properties/search")
def search_properties(q: str = "", city: str | None = None, limit: int = 25):
    """Non-residential CoStar properties that have a Matterport scan. Hackathon data, hackathon use only."""
    rows = [{**r, "vexcel_region": vexcel.geofence_region(r["lat"], r["lon"]) if r.get("lat") is not None and r.get("lon") is not None else None}
            for r in costar.search(q, city, min(max(limit, 1), 50))]
    return {"properties": rows, "rights": costar.RIGHTS, "available": costar.status().state != "unavailable"}


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


@router.post("/audits/{audit_id}/doors/accept-scan-estimates")
def accept_scan_estimates(audit_id: str, body: AcceptEstimatesIn):
    """A person accepts the scan's lower-bound clear width for every doorway the 3D mesh shows comfortably wide,
    in place of measuring each one. Only doorways whose check offers an estimate (observed.accept_clear_in) are
    touched; the rule engine then screens them like any other recorded width. Nothing is accepted automatically."""
    audit = _audit(audit_id)
    if audit.status != "COMPLETE":
        raise HTTPException(409, "Wait for the audit to finish before accepting estimates.")
    offers = [f for f in audit.findings if (f.observed or {}).get("accept_clear_in") is not None]
    if not offers:
        raise HTTPException(404, "No doorway in this audit has a scan estimate to accept.")
    for f in offers:
        o = f.observed or {}
        audit.measurements.append(Measurement(
            id=f"m_{uuid.uuid4().hex[:8]}", audit_id=audit_id, location_id=f.location_id, name="door_clear_width_in",
            value=o["accept_clear_in"], unit="in", method="scan_mesh", reviewed_by=body.reviewed_by,
            evidence_id=(f.evidence_ids or [None])[0],
            notes=f"Clear width is a lower-bound estimate accepted by {body.reviewed_by}: the {o.get('mesh_gap_in')} in "
                  "gap measured in the scan's 3D mesh, less a door allowance and scan tolerance. The door was not measured."))
    runner.emit(audit, "OBSERVATION_PROPOSED", "human_reviewer",
                f"{body.reviewed_by} accepted the scan's lower-bound clear width for {len(offers)} doorway(s) "
                "in place of measuring them.", payload=[f.location_id for f in offers])
    runner.reevaluate(audit)
    return {"accepted": len(offers), "findings": audit.findings}


@router.post("/audits/{audit_id}/doors/{door_id}/use-scan-width")
def use_scan_width(audit_id: str, door_id: str, body: UseScanWidthIn):
    """A person looks at one scan doorway in the 3D tour, says what is there, and takes the scan's width for it.

    No door in the opening: the opening is the clear width, so the scan's width is recorded as it is.
    A single hinged door: the leaf and stop come off first (rules.DOOR_LEAF_AND_STOP_IN).
    The value is the narrower of the floor-plan width and the mesh gap when both exist. The person vouches for
    what kind of doorway it is, not for the number, and the record says so."""
    audit = _audit(audit_id)
    if audit.status != "COMPLETE":
        raise HTTPException(409, "Wait for the audit to finish before recording door widths.")
    door = next((d for d in audit.property.doors if d.id == door_id and d.source == "matterport_floorplan"), None)
    if door is None:
        raise HTTPException(404, "That is not a doorway from this audit's scan.")
    latest = {m.name: m for m in audit.measurements if m.location_id == door_id}
    opening, gap = latest.get("door_opening_width_in"), latest.get("door_mesh_gap_in")
    if opening is None or opening.value < ada2010.SCAN_OPENING_MIN_PLAUSIBLE_IN:
        raise HTTPException(400, "The scan has no usable width for this doorway. Measure it in the 3D tour instead.")
    basis = min(opening.value, gap.value) if gap else opening.value
    source = (f"the narrower of the floor plan's {opening.value:g} in and the 3D mesh's {gap.value:g} in"
              if gap else f"the floor plan's {opening.value:g} in opening")
    if body.door == "none":
        value = basis
        note = (f"Clear width taken as {source}: {body.reviewed_by} looked in the 3D tour and saw no door in this "
                "opening, so the opening is the clear width. Scan dimension, not tape-measured.")
    else:
        value = basis - ada2010.DOOR_LEAF_AND_STOP_IN
        note = (f"Clear width estimated as {source} less {ada2010.DOOR_LEAF_AND_STOP_IN:g} in for the door leaf and stop: "
                f"{body.reviewed_by} looked in the 3D tour and saw a single hinged door. Scan dimension, not tape-measured.")
    audit.measurements.append(Measurement(
        id=f"m_{uuid.uuid4().hex[:8]}", audit_id=audit_id, location_id=door_id, name="door_clear_width_in",
        value=math.floor(value * 10) / 10, unit="in", method="scan_mesh", reviewed_by=body.reviewed_by,
        evidence_id=opening.evidence_id, notes=note))
    runner.emit(audit, "OBSERVATION_PROPOSED", "human_reviewer",
                f"{body.reviewed_by} took the scan's width for {door.label} "
                f"({'no door in the opening' if body.door == 'none' else 'single hinged door'}).",
                payload={"door": door_id, "kind": body.door, "value": value})
    runner.reevaluate(audit)
    return {"finding": next((f for f in audit.findings if f.location_id == door_id), None)}


@router.post("/audits/{audit_id}/markups")
def save_markups(audit_id: str, body: PinsIn):
    """A person marks accessible stalls on the aerial image. The marks become the observed counts (method: manual)
    and stay attached to the image as evidence. Zero marks is a valid answer: "I looked and found none"."""
    audit = _audit(audit_id)
    ev = aerial_evidence(audit, body.evidence_id)
    return apply_pins(audit, ev, [p.model_dump() for p in body.pins], body.reviewed_by,
                      f"Counted by a person from marks on the {ev.provider} image.")


def aerial_evidence(audit: Audit, evidence_id: str | None = None):
    if audit.status != "COMPLETE":
        raise HTTPException(409, "Wait for the audit to finish before marking the image.")
    ev = next((e for e in audit.evidence if e.asset_type == "aerial_image" and (evidence_id is None or e.id == evidence_id)), None)
    if ev is None or not audit.property.facilities:
        raise HTTPException(404, "This audit has no aerial image to mark.")
    return ev


def apply_pins(audit: Audit, ev, pins: list[dict], reviewer: str, note: str) -> dict:
    """Store the person's stall marks on the image and turn them into counts (method: manual), then re-run the rules.
    Shared by hand marking and by accepted Gemini stall candidates, so both are judged by the same rules."""
    lot = audit.property.facilities[0].id
    before = (dict(ev.geometry or {}), list(audit.measurements))
    ev.geometry = {**(ev.geometry or {}), "pins": pins, "pins_by": reviewer, "pins_at": now_iso()}
    counts = {"parking_accessible_spaces": len(pins),
              "parking_van_spaces": sum(1 for p in pins if p["kind"] == "van")}
    for name, value in counts.items():
        audit.measurements.append(Measurement(
            id=f"m_{uuid.uuid4().hex[:8]}", audit_id=audit.id, location_id=lot, name=name, value=value, unit="spaces",
            method="manual", evidence_id=ev.id, reviewed_by=reviewer, notes=note))
    try:
        from_ai = sum(1 for p in pins if p.get("candidate_id") or p.get("suggested"))
        ai_note = f"; {from_ai} began as accepted AI suggestions" if from_ai else ""
        runner.emit(audit, "OBSERVATION_PROPOSED", "human_reviewer",
                    f"{reviewer} marked {counts['parking_accessible_spaces']} accessible stall(s), "
                    f"{counts['parking_van_spaces']} of them van-accessible, on the {ev.provider} image{ai_note}.",
                    payload=counts)
        runner.reevaluate(audit)
    except ValueError as e:
        fresh = _audit(audit.id)
        ev2 = next(e2 for e2 in fresh.evidence if e2.id == ev.id)
        ev2.geometry, fresh.measurements = before
        store.save(fresh)
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
    # Do not transmit sponsor imagery to any AI service unless permission was confirmed.
    # The operator may enable this only after receiving the required written rights clearance.
    if os.environ.get("VEXCEL_ALLOW_AI_PROCESSING") != "1":
        raise HTTPException(403, "Vexcel imagery is not approved for third-party AI processing. "
                             "Use Gemini on the public USGS image or mark stalls manually.")
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
