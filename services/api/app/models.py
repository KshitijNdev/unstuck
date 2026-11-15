"""Canonical data model (handoff §5). Every observation carries provenance."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

FindingStatus = Literal[
    "NUMERIC_SCREEN_FAIL", "NUMERIC_SCREEN_PASS", "SUSPECTED_VISUAL_BARRIER",
    "FIELD_VERIFICATION_REQUIRED", "INSUFFICIENT_DATA", "OUT_OF_SCOPE",
]
MeasurementMethod = Literal["field", "manual", "model_metric", "record", "image_estimate", "synthetic_demo_only"]
ReviewStatus = Literal["NOT_REVIEWED", "APPROVED", "REJECTED", "NEEDS_FIELD_VISIT"]
SourceState = Literal["connected", "limited", "unavailable"]
EventType = Literal[
    "PLANNED", "FETCH_STARTED", "FETCH_SUCCESS", "FETCH_FAILURE", "SOURCE_MISSING",
    "OBSERVATION_PROPOSED", "RULE_EVALUATED", "REVIEW_REQUESTED", "FINDING_APPROVED", "REPORT_READY",
    "AGENT_NOTE",  # free text the agent wrote between tool calls; never a finding
]
AuditStatus = Literal["QUEUED", "RUNNING", "COMPLETE", "FAILED"]

# Measurement names understood by the rule evaluator.
MEASUREMENT_NAMES = {
    "parking_total_spaces", "parking_accessible_spaces", "parking_van_spaces",
    "door_clear_width_in", "door_opening_depth_in",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SourceRef(BaseModel):
    provider: str
    source_record_id: str | None = None
    retrieved_at: str | None = None
    rights: str | None = None


class Facility(BaseModel):
    """A parking facility. §208.2 counts are per facility, never per parcel."""
    id: str
    label: str
    kind: str = "standard"


class Door(BaseModel):
    id: str
    label: str
    priority: int = 1  # 1 = entry/route/parking, 2 = interior


class Property(BaseModel):
    id: str
    name: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    lat: float | None = None
    lon: float | None = None
    type: str | None = None          # None means UNKNOWN, never guessed
    year_built: int | None = None
    facilities: list[Facility] = []
    doors: list[Door] = []
    ownership_authorized: bool = False
    is_synthetic: bool = False
    source_refs: list[SourceRef] = []


class Evidence(BaseModel):
    id: str
    property_id: str
    provider: str
    provider_asset_id: str | None = None
    asset_type: str                  # aerial_image | schematic | tour | record
    capture_date: str | None = None
    retrieved_at: str | None = None
    view_url: str | None = None
    geometry: dict[str, Any] | None = None   # e.g. regions keyed by location id
    scale: dict[str, Any] | None = None
    coordinate_reference_system: str | None = None
    rights: str | None = None
    quality: str | None = None
    notes: str | None = None
    is_synthetic: bool = False
    is_sponsor_source: bool = False


class Measurement(BaseModel):
    id: str
    audit_id: str
    location_id: str                 # facility id or door id
    name: str
    value: float
    unit: str
    method: MeasurementMethod
    uncertainty: str | None = None
    evidence_id: str | None = None
    reviewed_by: str | None = None
    notes: str | None = None
    recorded_at: str = Field(default_factory=now_iso)


class Finding(BaseModel):
    id: str
    audit_id: str
    property_id: str
    rule_id: str
    citation: str | None = None
    title: str
    location_id: str
    location: str
    required: dict[str, Any] | None = None
    observed: dict[str, Any] | None = None
    status: FindingStatus
    label: Literal["measured", "suspected", "review needed"]
    confidence: str
    borderline: bool = False
    priority: int = 1
    rationale: str
    followup: str
    assumptions: list[str] = []
    evidence_ids: list[str] = []
    review_status: ReviewStatus = "NOT_REVIEWED"
    reviewed_by: str | None = None
    review_note: str | None = None
    reviewed_at: str | None = None
    is_synthetic: bool = False
    legal_compliance_determination: bool = False


class AgentEvent(BaseModel):
    seq: int
    type: EventType
    actor: str
    tool: str | None = None
    timestamp: str = Field(default_factory=now_iso)
    property_id: str | None = None
    source_id: str | None = None
    summary: str
    payload_hash: str | None = None
    latency_ms: int | None = None
    error_class: str | None = None
    retry_count: int = 0


class SourceStatus(BaseModel):
    provider: str
    layer: Literal["property", "aerial", "interior"]
    state: SourceState
    is_sponsor_source: bool
    detail: str
    features: list[str] = []
    capture_date: str | None = None
    match_confidence: str | None = None


class ModelUsage(BaseModel):
    """Tokens the AI agent used on one audit, summed over every model request."""
    model: str
    requests: int = 0
    input_tokens: int = 0            # uncached input
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    output_tokens: int = 0           # includes thinking
    est_cost_usd: float | None = None  # list-price estimate; None if the model's price is unknown
    price_note: str | None = None


class Audit(BaseModel):
    id: str
    property_id: str
    mode: str = "single_property"
    standard_profile: str = "ADA_2010_SCREEN"
    status: AuditStatus = "QUEUED"
    engine: str = "scripted_pipeline"   # or "claude_agent" when a model key is configured
    narrative: str | None = None        # the agent's plain-language summary; never a finding source
    usage: list[ModelUsage] = []        # one entry per model that served requests (a fallback adds one)
    started_at: str = Field(default_factory=now_iso)
    completed_at: str | None = None
    is_synthetic: bool = False
    plan: list[str] = []
    data_availability: list[SourceStatus] = []
    property: Property | None = None
    evidence: list[Evidence] = []
    measurements: list[Measurement] = []
    observations: list[dict[str, Any]] = []   # unmeasured visual hypotheses
    findings: list[Finding] = []
    events: list[AgentEvent] = []


# ---- request bodies ---------------------------------------------------------
class CustomProperty(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=200)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    matterport_model_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{6,20}$")


class CreateAudit(BaseModel):
    property_id: str | None = None
    costar_property_id: int | None = None
    matterport_model_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{6,20}$")
    custom_property: CustomProperty | None = None
    mode: str = "single_property"
    standard_profile: str = "ADA_2010_SCREEN"
    allow_synthetic_fixture: bool = False
    ownership_authorized: bool = False


class MeasurementIn(BaseModel):
    location_id: str
    name: str
    value: float = Field(ge=0)
    unit: str
    # People enter human measurements: on site, from another record, or measured by hand in the 3D tour.
    method: Literal["field", "manual", "model_metric"]
    reviewed_by: str = Field(min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=500)


class VerifyIn(BaseModel):
    action: Literal["approve", "reject", "needs_field_visit"]
    reviewer: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=500)


class Pin(BaseModel):
    """A person's mark on the aerial image, in image-relative coordinates (0-1 from top-left)."""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    kind: Literal["accessible", "van"]   # a van-accessible space is also an accessible space
    candidate_id: str | None = None      # set when the mark is a Gemini candidate a person accepted


class PinsIn(BaseModel):
    pins: list[Pin] = Field(max_length=300)
    reviewed_by: str = Field(min_length=1, max_length=80)
    evidence_id: str | None = None       # which aerial image; defaults to the first one


class ModelIn(BaseModel):
    model_id: str = Field(pattern=r"^[A-Za-z0-9]{6,20}$")
