"""Deterministic 2010 ADA Standards numeric screening.

Screening only. A result here is a comparison of a structured measurement against a
dimensional threshold. It is NOT a legal compliance determination: applicability,
exceptions, construction/alteration history and state rules (CA Title 24, Texas TAS)
need professional review.

Source of every threshold: https://www.ada.gov/law-and-regs/design-standards/2010-stds/

Rules of this module:
  * No value is ever defaulted. A missing input yields FIELD_VERIFICATION_REQUIRED.
  * Image estimates never produce a numeric pass/fail.
  * No LLM is involved in any comparison.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from math import ceil
from typing import Any

STANDARD_PROFILE = "ADA_2010_SCREEN"
STANDARDS_URL = "https://www.ada.gov/law-and-regs/design-standards/2010-stds/"

# Finding states (handoff §5.2)
FAIL = "NUMERIC_SCREEN_FAIL"
PASS = "NUMERIC_SCREEN_PASS"
SUSPECTED = "SUSPECTED_VISUAL_BARRIER"
FIELD = "FIELD_VERIFICATION_REQUIRED"
INSUFFICIENT = "INSUFFICIENT_DATA"
OUT_OF_SCOPE = "OUT_OF_SCOPE"

# Measurement methods
# "record" = a value taken from a provider record (e.g. CoStar parking count), not measured by us.
TRUSTED_METHODS = {"field", "manual", "model_metric", "record"}
SYNTHETIC_METHOD = "synthetic_demo_only"
UNTRUSTED_METHODS = {"image_estimate"}
KNOWN_METHODS = TRUSTED_METHODS | UNTRUSTED_METHODS | {SYNTHETIC_METHOD}

# Non-field measurements this close to a threshold are sent to field review
# instead of being called pass/fail (handoff §6.2: "force review near thresholds").
BORDERLINE_TOLERANCE_IN = 0.5

FACILITY_KINDS = {"standard", "hospital_outpatient", "rehabilitation", "outpatient_physical_therapy"}

_PARKING_TABLE = [(25, 1), (50, 2), (75, 3), (100, 4), (150, 5), (200, 6), (300, 7), (400, 8), (500, 9)]


@dataclass
class RuleResult:
    rule_id: str
    citation: str
    title: str
    status: str
    required: dict[str, Any] | None
    observed: dict[str, Any] | None
    rationale: str
    followup: str
    borderline: bool = False
    assumptions: list[str] = field(default_factory=list)
    legal_compliance_determination: bool = False  # always False; screening only

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --------------------------------------------------------------------------- helpers
def _count(value: Any, name: str) -> int | None:
    """Validate a count. None stays None (unknown); bools, floats and negatives are errors."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be a whole number or None")
    if value < 0:
        raise ValueError(f"{name} must not be negative")
    return value


def _inches(value: Any, name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number of inches or None")
    if value < 0:
        raise ValueError(f"{name} must not be negative")
    return float(value)


def _method(method: str | None) -> str | None:
    if method is not None and method not in KNOWN_METHODS:
        raise ValueError(f"unknown measurement method: {method!r}")
    return method


def _can_compare(method: str | None) -> bool:
    return method in TRUSTED_METHODS or method == SYNTHETIC_METHOD


# --------------------------------------------------------------------------- §208.2
def required_accessible_spaces(total: int, kind: str = "standard") -> int:
    """Minimum accessible spaces for ONE parking facility (Table 208.2, §208.2.1, §208.2.2)."""
    total = _count(total, "total")
    if total is None:
        raise ValueError("total is required")
    if kind not in FACILITY_KINDS:
        raise ValueError(f"unknown facility kind: {kind!r}")
    if total == 0:
        return 0
    base = next((n for cap, n in _PARKING_TABLE if total <= cap), None)
    if base is None:
        base = ceil(total * 0.02) if total <= 1000 else 20 + ceil((total - 1000) / 100)
    if kind == "hospital_outpatient":  # §208.2.1: 10% of patient/visitor spaces
        return max(base, ceil(total * 0.10))
    if kind in ("rehabilitation", "outpatient_physical_therapy"):  # §208.2.2: 20%
        return max(base, ceil(total * 0.20))
    return base


def required_van_spaces(accessible_required: int) -> int:
    """§208.2.4: one van space for every six accessible spaces or fraction of six."""
    n = _count(accessible_required, "accessible_required")
    if n is None:
        raise ValueError("accessible_required is required")
    return ceil(n / 6)


def check_parking_facility(
    total_spaces: int | None,
    accessible_observed: int | None,
    van_observed: int | None,
    kind: str = "standard",
    method: str | None = None,
) -> list[RuleResult]:
    """Screen one parking facility. Returns [accessible-count result, van-count result].

    §208.2 applies per parking facility: never pass a parcel-wide sum for several lots.
    """
    total = _count(total_spaces, "total_spaces")
    acc = _count(accessible_observed, "accessible_observed")
    van = _count(van_observed, "van_observed")
    method = _method(method)
    if kind not in FACILITY_KINDS:
        raise ValueError(f"unknown facility kind: {kind!r}")
    if total is not None and acc is not None and acc > total:
        raise ValueError("accessible_observed cannot exceed total_spaces")
    if acc is not None and van is not None and van > acc:
        raise ValueError("van_observed cannot exceed accessible_observed")

    assumptions = [
        "Counted for a single parking facility, not the whole parcel.",
        f"Facility kind assumed '{kind}'; special facility types change the minimum.",
        "Exceptions and existing-facility provisions not evaluated.",
    ]
    cite_count = "2010 ADA Standards §208.2 (Table 208.2)"
    cite_van = "2010 ADA Standards §208.2.4"
    title_count = "Accessible parking space count"
    title_van = "Van-accessible parking space count"

    def unknown(rule_id, cite, title, required, why, follow, status=FIELD):
        return RuleResult(rule_id, cite, title, status, required, None, why, follow, assumptions=assumptions)

    if total is None:
        why = "Total number of spaces in this parking facility is unknown."
        follow = "Count every marked space in this one lot (or confirm the count on current aerial imagery)."
        return [
            unknown("ADA_2010_208_2", cite_count, title_count, None, why, follow),
            unknown("ADA_2010_208_2_4", cite_van, title_van, None, why, follow),
        ]

    need = required_accessible_spaces(total, kind)
    need_van = required_van_spaces(need)
    req_count = {"value": need, "unit": "spaces", "condition": f"{total} total spaces, facility kind '{kind}'"}
    req_van = {"value": need_van, "unit": "van spaces", "condition": f"{need} accessible spaces required"}

    if not _can_compare(method):
        why = (
            "Counts come from an image estimate that has not been confirmed by a person."
            if method in UNTRUSTED_METHODS
            else "No trusted measurement method recorded for the counts."
        )
        follow = "Have a person confirm the marked accessible and van spaces on site or on current imagery."
        return [
            unknown("ADA_2010_208_2", cite_count, title_count, req_count, why, follow),
            unknown("ADA_2010_208_2_4", cite_van, title_van, req_van, why, follow),
        ]

    results: list[RuleResult] = []
    if acc is None:
        results.append(unknown(
            "ADA_2010_208_2", cite_count, title_count, req_count,
            "Number of marked accessible spaces is unknown.",
            "Count spaces marked with the International Symbol of Accessibility in this lot.",
        ))
    else:
        ok = acc >= need
        results.append(RuleResult(
            "ADA_2010_208_2", cite_count, title_count, PASS if ok else FAIL, req_count,
            {"value": acc, "unit": "spaces", "method": method},
            f"{acc} accessible space(s) observed; the table minimum for {total} spaces is {need}.",
            "No action from this check." if ok else
            "Confirm the count on site, then get a quote from a striping and signage contractor for the missing space(s). Check with the city whether the work needs a permit; rules vary by city.",
            assumptions=assumptions,
        ))
    if van is None:
        results.append(unknown(
            "ADA_2010_208_2_4", cite_van, title_van, req_van,
            "Number of van-accessible spaces is unknown.",
            "Count spaces signed 'van accessible' and check their aisle on site.",
        ))
    else:
        ok = van >= need_van
        results.append(RuleResult(
            "ADA_2010_208_2_4", cite_van, title_van, PASS if ok else FAIL, req_van,
            {"value": van, "unit": "van spaces", "method": method},
            f"{van} van space(s) observed; {need_van} needed for {need} required accessible space(s).",
            "No action from this check." if ok else
            "Confirm on site, then get a quote from a striping and signage contractor for a van-accessible space (width and aisle per §502). Check with the city whether the work needs a permit; rules vary by city.",
            assumptions=assumptions,
        ))
    return results


# --------------------------------------------------------------------------- §404.2.3
def check_door(
    clear_width_in: float | None,
    opening_depth_in: float | None,
    measurement_method: str | None,
    evidence_id: str | None = None,
) -> RuleResult:
    """Door clear opening: 32 in minimum; 36 in when the opening is more than 24 in deep.

    Clear width is measured between the face of the door and the stop with the door open
    90 degrees. Frame width, wall opening width and 3D bounding boxes are NOT clear width.
    """
    width = _inches(clear_width_in, "clear_width_in")
    depth = _inches(opening_depth_in, "opening_depth_in")
    method = _method(measurement_method)
    rule_id, cite, title = "ADA_2010_404_2_3", "2010 ADA Standards §404.2.3", "Door clear opening width"
    assumptions = [
        "Clear width measured with the door open 90 degrees, between door face and opposite stop.",
        "Manual swinging/sliding/folding door; automatic doors and exceptions not evaluated.",
    ]
    measure = "Measure the clear opening with the door open 90 degrees, and the depth of the opening."

    def result(status, required, observed, why, follow, borderline=False):
        return RuleResult(rule_id, cite, title, status, required, observed, why, follow, borderline, assumptions)

    if width is None:
        return result(FIELD, {"value": 32, "unit": "in", "condition": "36 in if opening depth > 24 in"}, None,
                      "No clear-width measurement for this door.", measure)
    observed = {"value": width, "unit": "in", "method": method, "opening_depth_in": depth, "evidence_id": evidence_id}
    if not _can_compare(method):
        return result(FIELD, {"value": 32, "unit": "in", "condition": "36 in if opening depth > 24 in"}, observed,
                      "Width is an uncalibrated estimate (or has no recorded method); it cannot be screened numerically.",
                      measure)

    # Decide the applicable minimum without ever assuming a depth.
    if depth is None:
        if width < 32:
            minimum, cond = 32, "below the 32 in minimum that applies at any opening depth"
        elif width >= 36:
            minimum, cond = 36, "meets 36 in, the larger minimum, so depth does not matter"
        else:
            return result(FIELD, {"value": 32, "unit": "in", "condition": "36 in if opening depth > 24 in"}, observed,
                          f"{width:g} in passes only if the opening is 24 in deep or less, and the depth is unknown.",
                          "Measure the depth of the door opening (wall/frame thickness along the direction of travel).")
    elif depth > 24:
        minimum, cond = 36, "opening depth > 24 in"
    else:
        minimum, cond = 32, "opening depth <= 24 in"
    required = {"value": minimum, "unit": "in", "condition": cond}

    borderline = abs(width - minimum) < BORDERLINE_TOLERANCE_IN and width != minimum
    if borderline and method != "field":
        return result(FIELD, required, observed,
                      f"{width:g} in is within {BORDERLINE_TOLERANCE_IN} in of the {minimum} in minimum and was not field-measured.",
                      "Tape-measure the clear opening on site before treating this as pass or fail.", borderline=True)
    ok = width >= minimum
    return result(
        PASS if ok else FAIL, required, observed,
        f"{width:g} in clear width against a {minimum} in minimum ({cond}).",
        "No action from this check." if ok else
        "Tape-measure on site to confirm, then review options (offset hinges, wider door or frame) with a door contractor. Widening an opening usually needs a building permit; rules vary by city.",
        borderline=borderline,
    )


# --------------------------------------------------------------------------- §404.2.3 from a scan
# A Matterport floor plan stores each doorway as an opening in a wall: the framed gap. Clear width
# (door open 90 degrees, door face to stop) is always narrower than that gap, because the door leaf
# and the stops sit inside it. So a scan opening can show a doorway is too narrow, but never that it
# is wide enough.
SCAN_OPENING_TOLERANCE_IN = 1.0   # our margin for floor-plan drawing error; not a Matterport accuracy spec
SCAN_OPENING_MIN_PLAUSIBLE_IN = 20.0  # narrower "doorways" in the wall graph are drawing artefacts
SCAN_METHOD = "scan_floorplan"


def screen_doorway_opening(opening_width_in: float | None, wall_thickness_in: float | None) -> RuleResult:
    """Screen a doorway using only the opening width drawn in a 3D scan's floor plan.

    Outcomes: SUSPECTED (opening clearly under 32 in, so clear width must be too),
    FIELD (opening wide enough that clear width could meet the minimum: a person must measure),
    INSUFFICIENT (no width, or an implausible one). Never PASS or FAIL: the scan does not measure clear width.
    """
    width = _inches(opening_width_in, "opening_width_in")
    depth = _inches(wall_thickness_in, "wall_thickness_in")
    rule_id, cite, title = "ADA_2010_404_2_3", "2010 ADA Standards §404.2.3", "Door clear opening width"
    required = {"value": 32, "unit": "in", "condition": "36 in if opening depth > 24 in"}
    assumptions = [
        "Width is the doorway opening drawn in the Matterport floor plan, not clear width measured with the door open.",
        "Clear width is narrower than the opening: the door leaf and stops take part of it.",
        f"A {SCAN_OPENING_TOLERANCE_IN:g} in margin is allowed for floor-plan drawing error.",
    ]
    measure = "Measure the clear opening with the door open 90 degrees, in the 3D tour or with a tape on site."

    def result(status, observed, why, follow):
        return RuleResult(rule_id, cite, title, status, required, observed, why, follow, False, assumptions)

    if width is None:
        return result(INSUFFICIENT, None, "The scan has no width for this doorway.", measure)
    observed = {"value": round(width, 1), "unit": "in", "method": SCAN_METHOD, "measures": "doorway opening (frame gap)",
                "wall_thickness_in": round(depth, 1) if depth is not None else None}
    if width < SCAN_OPENING_MIN_PLAUSIBLE_IN:
        return result(INSUFFICIENT, observed,
                      f"The scan draws this doorway {width:.1f} in wide, too narrow to be a real doorway: likely a floor-plan drawing error.",
                      "Check this spot in the 3D tour; if there is a door, measure its clear opening.")
    deep = depth is not None and depth > 24
    if width < 32 - SCAN_OPENING_TOLERANCE_IN:
        return result(SUSPECTED, observed,
                      f"The scan's doorway opening is {width:.1f} in. Clear width cannot be wider than the opening, "
                      f"so it is probably below the 32 in minimum.",
                      "Tape-measure the clear opening with the door open 90 degrees to confirm. If it is under 32 in, "
                      "review options (offset hinges, wider door or frame) with a door contractor. Widening an opening "
                      "usually needs a building permit; rules vary by city.")
    note = " The wall is over 24 in thick here, so the 36 in minimum may apply." if deep else ""
    return result(FIELD, observed,
                  f"The scan's doorway opening is {width:.1f} in. Clear width is narrower than the opening, so this "
                  f"cannot be screened until someone measures it.{note}", measure)


# --------------------------------------------------------------------------- §403.5.1
def check_route_width(
    clear_width_in: float | None,
    reduced_length_in: float | None,
    measurement_method: str | None,
) -> RuleResult:
    """Walking surface clear width: 36 in minimum; may reduce to 32 in for at most 24 in of length.

    The 48 in separation between reduced segments (§403.5.1 exception) is not evaluated.
    """
    width = _inches(clear_width_in, "clear_width_in")
    length = _inches(reduced_length_in, "reduced_length_in")
    method = _method(measurement_method)
    rule_id, cite, title = "ADA_2010_403_5_1", "2010 ADA Standards §403.5.1", "Accessible route clear width"
    assumptions = ["Separation between reduced-width segments (48 in) not evaluated.", "Turning and passing space not evaluated."]
    required = {"value": 36, "unit": "in", "condition": "32 in allowed for a length of 24 in max"}

    def result(status, observed, why, follow, borderline=False):
        return RuleResult(rule_id, cite, title, status, required, observed, why, follow, borderline, assumptions)

    if width is None:
        return result(FIELD, None, "No clear-width measurement for this route.", "Measure the narrowest point of the route.")
    observed = {"value": width, "unit": "in", "method": method, "reduced_length_in": length}
    if not _can_compare(method):
        return result(FIELD, observed, "Width is an uncalibrated estimate; it cannot be screened numerically.",
                      "Measure the narrowest point of the route on site.")
    for threshold in (32, 36):
        if abs(width - threshold) < BORDERLINE_TOLERANCE_IN and width != threshold and method != "field":
            return result(FIELD, observed, f"{width:g} in is within {BORDERLINE_TOLERANCE_IN} in of the {threshold} in threshold and was not field-measured.",
                          "Tape-measure the narrowest point on site.", borderline=True)
    if width >= 36:
        return result(PASS, observed, f"{width:g} in meets the 36 in minimum.", "No action from this check.")
    if width < 32:
        return result(FAIL, observed, f"{width:g} in is below 32 in, the smallest width allowed anywhere on the route.",
                      "Confirm on site, then review how to widen or reroute with a contractor. If the route crosses sloped ground, have a licensed surveyor measure the grade first. Fixes usually need a building permit; rules vary by city.")
    if length is None:
        return result(FIELD, observed, f"{width:g} in is allowed only for a stretch of 24 in or less, and the length of the narrow stretch is unknown.",
                      "Measure how long the route stays narrower than 36 in.")
    ok = length <= 24
    return result(PASS if ok else FAIL, observed,
                  f"{width:g} in for a length of {length:g} in (reduced width is allowed for 24 in max).",
                  "No action from this check." if ok else "Confirm on site, then review how to widen the narrow stretch with a contractor. Fixes usually need a building permit; rules vary by city.")
