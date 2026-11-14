"""CoStar data extract adapter.

For HackPrinceton 2026 CoStar is a password-protected zip of CSVs (Houston and Los Angeles),
not an API. Point COSTAR_KIT_DIR at the unzipped folder. The CSV schema has not been seen
yet, so no field mapping exists: this adapter only reports what is on disk. It never
invents a property record.
"""
from __future__ import annotations

import os
from pathlib import Path

from ..models import SourceStatus


def _kit_dir() -> Path | None:
    raw = os.environ.get("COSTAR_KIT_DIR")
    if not raw:
        return None
    p = Path(raw).expanduser()
    return p if p.is_dir() else None


def kit_files() -> list[str]:
    d = _kit_dir()
    return sorted(str(p.relative_to(d)) for p in d.rglob("*.csv")) if d else []


def status() -> SourceStatus:
    files = kit_files()
    if not files:
        return SourceStatus(provider="CoStar", layer="property", state="unavailable", is_sponsor_source=True,
                            detail="No extract found. Run /costar-keys in the track Discord, unzip the kit, set COSTAR_KIT_DIR.")
    return SourceStatus(provider="CoStar", layer="property", state="limited", is_sponsor_source=True,
                        detail=f"Extract found ({len(files)} CSV files). Field mapping not written yet, so no record is read.",
                        features=files[:6])
