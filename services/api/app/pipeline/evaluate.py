"""Turn structured measurements into findings by calling the deterministic rule engine.

This is the only place findings are created. Numbers come from rules/ada2010.py; nothing
here (and no LLM anywhere) changes a numeric outcome.
"""
from __future__ import annotations

import re

from ..models import Audit, Finding, Measurement
from ..rules import ada2010 as rules

# Lower rank = weaker provenance. A check that mixes methods is labelled with the weakest.
_RANK = {"synthetic_demo_only": 0, "image_estimate": 1, "scan_floorplan": 1.5, "model_metric": 2, "record": 2.5, "manual": 3, "field": 4}
_CONFIDENCE = {
    "synthetic_demo_only": "DEMO_SYNTHETIC", "image_estimate": "IMAGE_ESTIMATE_UNVERIFIED", "scan_floorplan": "SCAN_FLOORPLAN",
    "model_metric": "MODEL_METRIC", "record": "PROPERTY_RECORD", "manual": "MANUAL_ENTRY", "field": "FIELD_MEASURED", None: "NO_MEASUREMENT",
}
_LABEL = {
    rules.PASS: "measured", rules.FAIL: "measured", rules.SUSPECTED: "suspected",
    rules.FIELD: "review needed", rules.INSUFFICIENT: "review needed", rules.OUT_OF_SCOPE: "review needed",
}


def _natural(text: str) -> list:
    """Sort key that puts 'doorway 2' before 'doorway 10'."""
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.split(r"(\d+)", text)]


def _latest(measurements: list[Measurement], location_id: str) -> dict[str, Measurement]:
    out: dict[str, Measurement] = {}
    for m in measurements:  # later entries override earlier ones
        if m.location_id == location_id:
            out[m.name] = m
    return out


def _weakest(ms: list[Measurement]) -> str | None:
    return min((m.method for m in ms), key=lambda x: _RANK[x]) if ms else None


def _int(m: Measurement | None) -> int | None:
    if m is None:
        return None
    if m.value != int(m.value):
        raise ValueError(f"{m.name} must be a whole number")
    return int(m.value)


def _finding(audit: Audit, result: rules.RuleResult, location_id: str, location: str, priority: int,
             method: str | None, evidence_ids: list[str], previous: dict[str, Finding]) -> Finding:
    fid = f"{audit.id}__{result.rule_id}__{location_id}"
    f = Finding(
        id=fid, audit_id=audit.id, property_id=audit.property_id, rule_id=result.rule_id,
        citation=result.citation, title=result.title, location_id=location_id, location=location,
        required=result.required, observed=result.observed, status=result.status,
        label=_LABEL[result.status], confidence=_CONFIDENCE[method if result.observed else None],
        borderline=result.borderline, priority=priority, rationale=result.rationale,
        followup=result.followup, assumptions=result.assumptions, evidence_ids=evidence_ids,
        is_synthetic=audit.is_synthetic,
    )
    old = previous.get(fid)
    # A human review survives re-evaluation only while the finding it reviewed is unchanged.
    if old and old.status == f.status and old.observed == f.observed:
        f.review_status, f.reviewed_by, f.review_note, f.reviewed_at = (
            old.review_status, old.reviewed_by, old.review_note, old.reviewed_at)
    return f


def evaluate(audit: Audit) -> list[Finding]:
    prop = audit.property
    if prop is None:
        return []
    previous = {f.id: f for f in audit.findings}
    located = [e.id for e in audit.evidence if e.asset_type in ("aerial_image", "schematic")]
    findings: list[Finding] = []

    for fac in prop.facilities:
        ms = _latest(audit.measurements, fac.id)
        used = [ms[n] for n in ("parking_total_spaces", "parking_accessible_spaces", "parking_van_spaces") if n in ms]
        method = _weakest(used)
        results = rules.check_parking_facility(
            _int(ms.get("parking_total_spaces")), _int(ms.get("parking_accessible_spaces")),
            _int(ms.get("parking_van_spaces")), kind=fac.kind, method=method,
        )
        total = ms.get("parking_total_spaces")
        if total is not None and total.method == "record":
            for r in results:
                r.assumptions = [*r.assumptions, "Total is the property record's surface parking count. It may cover more "
                                 "than one lot and has not been counted on imagery; §208.2 applies per lot."]
        # Label each check by how its OBSERVED count was obtained; the total's provenance is in the assumptions.
        observed_by = [ms.get("parking_accessible_spaces"), ms.get("parking_van_spaces")]
        findings += [_finding(audit, r, fac.id, fac.label, 1, o.method if o else method, located, previous)
                     for r, o in zip(results, observed_by)]

    tour = [e.id for e in audit.evidence if e.asset_type == "tour"]
    for door in prop.doors:
        ms = _latest(audit.measurements, door.id)
        width, depth = ms.get("door_clear_width_in"), ms.get("door_opening_depth_in")
        opening = ms.get("door_opening_width_in")
        evidence = tour if door.source == "matterport_floorplan" else located
        if width is None and opening is not None:
            # Only the scan's frame opening is known: it can raise suspicion, never pass the door.
            wall = ms.get("door_wall_thickness_in")
            result = rules.screen_doorway_opening(opening.value, wall.value if wall else None)
            findings.append(_finding(audit, result, door.id, door.label, door.priority, opening.method, evidence, previous))
            continue
        method = _weakest([m for m in (width, depth) if m])
        result = rules.check_door(width.value if width else None, depth.value if depth else None,
                                  width.method if width else None, width.evidence_id if width else None)
        findings.append(_finding(audit, result, door.id, door.label, door.priority, method, evidence, previous))

    for obs in audit.observations:  # visual hypotheses: never numeric
        fid = f"{audit.id}__{obs['rule_id']}__{obs['location_id']}"
        f = Finding(
            id=fid, audit_id=audit.id, property_id=audit.property_id, rule_id=obs["rule_id"],
            citation=obs.get("citation"), title=obs["title"], location_id=obs["location_id"],
            location=obs["location"], required=None, observed=None, status=rules.SUSPECTED,
            label="suspected", confidence="DEMO_SYNTHETIC" if audit.is_synthetic else "VISUAL_UNVERIFIED",
            priority=obs.get("priority", 1), rationale=obs["rationale"], followup=obs["followup"],
            evidence_ids=located, is_synthetic=audit.is_synthetic,
        )
        old = previous.get(fid)
        if old:
            f.review_status, f.reviewed_by, f.review_note, f.reviewed_at = (
                old.review_status, old.reviewed_by, old.review_note, old.reviewed_at)
        findings.append(f)

    order = {rules.FAIL: 0, rules.SUSPECTED: 1, rules.FIELD: 2, rules.INSUFFICIENT: 3, rules.OUT_OF_SCOPE: 4, rules.PASS: 5}
    findings.sort(key=lambda f: (f.priority, order[f.status], _natural(f.location)))
    return findings
