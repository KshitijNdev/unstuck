"""Synthetic fixture provider. Everything it returns is flagged is_synthetic."""
from __future__ import annotations

import json
from pathlib import Path

from ..models import Evidence, Measurement, Property

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures"
FIXTURE_PROPERTY_ID = "property_demo_001"


def load(audit_id: str) -> tuple[Property, list[Evidence], list[Measurement], list[dict]]:
    raw = json.loads((FIXTURE_DIR / "synthetic_demo_property.json").read_text())
    prop = Property(**raw["property"])
    assert prop.is_synthetic, "fixture property must be flagged synthetic"
    evidence = [Evidence(property_id=prop.id, **e) for e in raw["evidence"]]
    measurements = [
        Measurement(id=f"m_fixture_{i}", audit_id=audit_id, method="synthetic_demo_only",
                    evidence_id=evidence[0].id, **m)
        for i, m in enumerate(raw["measurements"])
    ]
    return prop, evidence, measurements, raw["observations"]


def demo_listing() -> dict:
    raw = json.loads((FIXTURE_DIR / "synthetic_demo_property.json").read_text())
    p = raw["property"]
    return {"id": p["id"], "name": p["name"], "address": p["address"], "is_synthetic": True,
            "note": "Synthetic fixture. Not a real building."}
