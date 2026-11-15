"""Gemini candidate detection on aerial evidence, and the human review of each candidate.

Rights gate: imagery is only sent to Gemini when its terms allow third-party processing.
USGS NAIP is a US government work in the public domain. Vexcel's hackathon terms ("hackathon use
only") do not say third-party AI processing is allowed, so it is refused unless the operator sets
VEXCEL_ALLOW_AI_PROCESSING=1 after confirming it with Vexcel. The public NAIP image of the same site
can be analysed instead; candidates always stay attached to the image they were found on.
"""
from __future__ import annotations

import os
import time
from typing import Literal

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from .. import store
from ..models import Audit, Evidence, now_iso
from ..pipeline import runner
from ..providers import usgs, vexcel
from ..vision import gemini
from .audits import _audit, aerial_evidence, apply_pins

router = APIRouter(prefix="/api")

VEXCEL_BLOCK = ("Vexcel imagery is licensed for hackathon use only, and its terms do not say it may be sent to a "
                "third-party AI service, so it was not sent to Gemini.")


def ai_permitted(ev: Evidence) -> tuple[bool, str | None]:
    if ev.is_synthetic or ev.asset_type != "aerial_image":
        return False, "Only real aerial imagery can be analysed. A synthetic schematic is not imagery."
    if ev.provider == "USGS NAIP":
        return True, None
    if ev.provider == "Vexcel" and os.environ.get("VEXCEL_ALLOW_AI_PROCESSING") == "1":
        return True, None
    return False, VEXCEL_BLOCK if ev.provider == "Vexcel" else f"{ev.provider} terms for AI processing are unknown."


class AnalysisIn(BaseModel):
    evidence_id: str | None = None
    use_public_imagery: bool = False   # analyse the public NAIP image of the same site


class CandidateReviewIn(BaseModel):
    action: Literal["accept", "reject", "relabel", "reset"]
    reviewer: str = Field(min_length=1, max_length=80)
    category: gemini.Category | None = None
    van: bool = False


class ApplyIn(BaseModel):
    evidence_id: str
    reviewer: str = Field(min_length=1, max_length=80)


def _set_ai(audit_id: str, evidence_id: str, **patch) -> None:
    """Re-read before writing so a long analysis never overwrites a person's newer edits."""
    audit = store.get(audit_id)
    ev = next(e for e in audit.evidence if e.id == evidence_id)
    ev.geometry = {**(ev.geometry or {}), "ai": {**((ev.geometry or {}).get("ai") or {}), **patch}}
    store.save(audit)


async def _image_bytes(audit: Audit, ev: Evidence) -> bytes:
    lat, lon = audit.property.lat, audit.property.lon
    async with httpx.AsyncClient() as client:
        if ev.provider == "Vexcel":
            return await vexcel.fetch_image(client, lat, lon)
        for attempt in range(2):  # the NAIP image server is slow and returns occasional transient 5xx
            try:
                r = await client.get(usgs.image_url(lat, lon), timeout=75, follow_redirects=True)
            except httpx.TimeoutException:
                if attempt:
                    raise
                continue
            if r.status_code < 500:
                break
        r.raise_for_status()
        if not r.headers.get("content-type", "").startswith("image/"):
            raise ValueError("NAIP did not return an image")
        return r.content


async def _run(audit_id: str, evidence_id: str) -> None:
    audit = store.get(audit_id)
    ev = next(e for e in audit.evidence if e.id == evidence_id)
    kept = [c for c in ((ev.geometry or {}).get("ai") or {}).get("candidates", []) if c["status"] != "suggested"]
    t0 = time.monotonic()
    try:
        data = await _image_bytes(audit, ev)
        result = await gemini.analyze(data, on_progress=lambda i, n, name: _set_ai(
            audit_id, evidence_id, progress={"done": i, "total": n, "view": name}))
    except gemini.VisionError as e:
        _set_ai(audit_id, evidence_id, status="failed", error={"kind": e.kind, "message": str(e)}, finished_at=now_iso())
        runner.emit(store.get(audit_id), "FETCH_FAILURE", "vision_inspector", f"Gemini analysis failed: {e}",
                    tool="gemini.generate_content", error_class=e.kind)
        return
    except Exception as e:  # noqa: BLE001 - imagery fetch failures are reported, not raised
        _set_ai(audit_id, evidence_id, status="failed",
                error={"kind": "imagery", "message": f"Could not fetch the image ({type(e).__name__})."}, finished_at=now_iso())
        return
    # A re-run replaces only unreviewed suggestions; a person's decisions are kept.
    fresh = [c for c in result.pop("candidates")
             if not any(c["category"] == k["category"] and gemini._iou(c["box"], k["box"]) >= 0.4 for k in kept)]
    _set_ai(audit_id, evidence_id, **result, status="complete", progress=None, error=None,
            candidates=kept + fresh, finished_at=now_iso())
    by: dict[str, int] = {}
    for c in fresh:
        by[c["category"]] = by.get(c["category"], 0) + 1
    summary = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in by.items()) or "no reliable detections"
    runner.emit(store.get(audit_id), "OBSERVATION_PROPOSED", "vision_inspector",
                f"Gemini ({result['model']}) suggested {summary} on the {ev.provider} image. Candidates await review.",
                tool="gemini.generate_content", latency_ms=int((time.monotonic() - t0) * 1000))


@router.post("/audits/{audit_id}/analysis", status_code=202)
async def start_analysis(audit_id: str, body: AnalysisIn, background: BackgroundTasks):
    audit = _audit(audit_id)
    if not gemini.configured():
        raise HTTPException(503, "Gemini is not configured on the API server (GEMINI_API_KEY).")
    if body.use_public_imagery:
        prop = audit.property
        if audit.status != "COMPLETE":
            raise HTTPException(409, "Wait for the audit to finish before analysing imagery.")
        if prop is None or prop.lat is None or prop.lon is None:
            raise HTTPException(400, "This property has no coordinates, so no public image can be fetched.")
        ev = next((e for e in audit.evidence if e.provider == "USGS NAIP"), None)
        if ev is None:
            for attempt in range(2):  # the public NAIP index is often slow; one retry before giving up
                try:
                    async with httpx.AsyncClient() as client:
                        ev = await usgs.fetch_aerial(client, prop.id, prop.lat, prop.lon)
                    break
                except Exception as e:  # noqa: BLE001
                    if attempt:
                        raise HTTPException(502, f"USGS NAIP did not answer twice ({type(e).__name__}). Try again shortly.")
            audit.evidence.append(ev)
            runner.emit(audit, "FETCH_SUCCESS", "vision_inspector",
                        "Added the public USGS NAIP image of the same site for AI analysis.", tool="usgs.naip_query")
    else:
        ev = aerial_evidence(audit, body.evidence_id)
    ok, reason = ai_permitted(ev)
    if not ok:
        raise HTTPException(403, reason)
    if ((ev.geometry or {}).get("ai") or {}).get("status") == "running":
        raise HTTPException(409, "An analysis of this image is already running.")
    _set_ai(audit_id, ev.id, status="running", started_at=now_iso(), error=None,
            progress={"done": 0, "total": len(gemini.views(1000, 1000)), "view": "fetching image"})
    background.add_task(_run, audit_id, ev.id)
    return {"evidence_id": ev.id, "status": "running"}


@router.post("/audits/{audit_id}/candidates/apply")
def apply_candidates(audit_id: str, body: ApplyIn):
    """Count accepted accessible-stall candidates as marks on their image. Hand marks without a candidate are kept.
    Only `parking_stall` candidates count: symbols, aisles and ramps are supporting evidence, never counts."""
    audit = _audit(audit_id)
    ev = aerial_evidence(audit, body.evidence_id)
    geo = ev.geometry or {}
    hand = [p for p in geo.get("pins") or [] if not p.get("candidate_id")]
    stalls = [c for c in (geo.get("ai") or {}).get("candidates", []) if c["status"] == "accepted" and c["category"] == "parking_stall"]
    pins = hand + [{"x": round(c["box"]["x"] + c["box"]["w"] / 2, 5), "y": round(c["box"]["y"] + c["box"]["h"] / 2, 5),
                    "kind": "van" if c.get("van") else "accessible", "candidate_id": c["id"]} for c in stalls]
    return apply_pins(audit, ev, pins, body.reviewer,
                      f"{len(stalls)} Gemini stall candidate(s) accepted by {body.reviewer}, plus {len(hand)} hand mark(s), on the {ev.provider} image.")


@router.post("/audits/{audit_id}/candidates/{candidate_id}")
def review_candidate(audit_id: str, candidate_id: str, body: CandidateReviewIn):
    audit = _audit(audit_id)
    for ev in audit.evidence:
        ai = (ev.geometry or {}).get("ai") or {}
        c = next((c for c in ai.get("candidates", []) if c["id"] == candidate_id), None)
        if c is None:
            continue
        if body.action == "relabel":
            if body.category is None:
                raise HTTPException(400, "Choose the corrected category.")
            c.setdefault("original_category", c["category"])
            c["category"], c["status"] = body.category, "accepted"
        else:
            c["status"] = {"accept": "accepted", "reject": "rejected", "reset": "suggested"}[body.action]
        c["van"] = body.van if c["status"] == "accepted" and c["category"] == "parking_stall" else False
        c["reviewed_by"], c["reviewed_at"] = (None, None) if body.action == "reset" else (body.reviewer, now_iso())
        runner.emit(audit, "OBSERVATION_PROPOSED", "human_reviewer",
                    f"{body.reviewer} {c['status']} a Gemini {c['category'].replace('_', ' ')} candidate on the {ev.provider} image.")
        return c
    raise HTTPException(404, "Candidate not found")
