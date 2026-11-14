"""Provider adapters. Each returns normalized models with provenance, or says plainly that it has nothing.

Sponsor sources (CoStar, Vexcel, Matterport) are never substituted silently: when one is
unavailable the status says so and any fallback is labelled as a public fallback.
"""
from __future__ import annotations

from ..models import SourceStatus
from . import costar, matterport, usgs, vexcel


def sources_status() -> list[SourceStatus]:
    return [costar.status(), vexcel.status(), usgs.status(), matterport.status()]
