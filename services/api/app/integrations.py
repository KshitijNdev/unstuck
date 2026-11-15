"""What each integration can actually do right now.

A key only makes a provider "configured". "verified" or "failed" comes from an explicit live check
(POST /api/integrations/{provider}/check), never from a page load, so no model or imagery call is spent
just by opening the app. Secrets are never returned.
"""
from __future__ import annotations

import asyncio
import os

import httpx

from .models import now_iso
from .providers import costar, matterport, vexcel

PROVIDERS = ("costar", "vexcel", "matterport", "gemini", "claude")
# shortcut: per-process memory, cleared on restart; enough for one local API process, move to the store if it scales out
LAST: dict[str, dict] = {}
PROBE_POINT = (40.3439, -74.6514)  # inside the Princeton geofence box, used only by the explicit Vexcel check


def _row(provider: str, role: str, configured: bool, detail: str, **extra) -> dict:
    last = LAST.get(provider) if configured else None
    state = "unavailable" if not configured else last["state"] if last else "configured"
    return {"provider": provider, "role": role, "state": state, "detail": detail,
            "checked_at": last and last["checked_at"], "check_detail": last and last["detail"], **extra}


def integrations() -> list[dict]:
    from .agents import orchestrator
    from .vision import gemini
    try:
        rows = costar.index() if costar.status().state != "unavailable" else {}
    except Exception:  # noqa: BLE001 - a broken extract is reported, not raised
        rows = {}
    with_scan = sum(1 for r in rows.values() if r["model_ids"])
    return [
        # CoStar is a local file: loading it is the check, so a loaded extract is verified on read.
        {"provider": "costar", "role": "Property records", "state": "verified" if rows else "unavailable",
         "detail": f"{len(rows)} non-residential records, {with_scan} with a Matterport scan" if rows
         else "No extract loaded. Set COSTAR_KIT_DIR to the unzipped hackathon kit.",
         "checked_at": None, "check_detail": None, "record_count": len(rows)},
        _row("vexcel", "Aerial imagery", bool(vexcel._key()),
             f"Orthophoto extract, hackathon geofence: {vexcel.REGIONS}. Not sent to AI services." if vexcel._key()
             else "No VEXCEL_API_KEY set.", ai_permitted=os.environ.get("VEXCEL_ALLOW_AI_PROCESSING") == "1"),
        _row("matterport", "3D interior", matterport._auth() is not None,
             "Model identity, rooms, tour and floor-plan door openings. Openings are frame gaps, not clear widths, so doors still need a tape measure."
             if matterport._auth() else "No MATTERPORT_API_KEY / MATTERPORT_API_TOKEN set."),
        _row("gemini", "Image suggestions", gemini.configured(),
             "Suggests parking features on permitted imagery. Suggestions wait for a person." if gemini.configured()
             else "No GEMINI_API_KEY set. Imagery analysis is off.", model=gemini.model_name()),
        _row("claude", "Audit planning agent", orchestrator.available(),
             "Plans each audit and chooses tool calls. Check results come from the rule engine." if orchestrator.available()
             else "No ANTHROPIC_API_KEY set. Audits run on the fixed scripted pipeline.", model=orchestrator.model_name()),
    ]


async def _probe(provider: str) -> str:
    """One cheap real call per provider. Returns a short success note or raises."""
    if provider == "costar":
        return f"{len(costar.index())} records read from the extract"
    if provider == "vexcel":
        async with httpx.AsyncClient() as client:
            data = await vexcel.fetch_image(client, *PROBE_POINT)
        return f"Orthophoto returned ({len(data) // 1024} KB)"
    if provider == "matterport":
        model_id = next((r["model_ids"][0] for r in costar.index().values() if r["model_ids"]), None)
        if model_id is None:
            raise LookupError("no linked Matterport model to test against")
        async with httpx.AsyncClient() as client:
            _, summary = await matterport.fetch_model(client, "integration_check", model_id)
        return f"Model {model_id} answered ({summary.get('panos', 0)} scan positions)"
    if provider == "gemini":
        from google import genai
        from .vision import gemini
        # A one-token generation: model metadata answers even when the key's generation quota is spent.
        r = await genai.Client(api_key=os.environ["GEMINI_API_KEY"]).aio.models.generate_content(
            model=gemini.model_name(), contents="Reply with OK.", config={"max_output_tokens": 1})
        return f"{gemini.model_name()} generated a reply ({(r.usage_metadata and r.usage_metadata.total_token_count) or 'few'} tokens)"
    if provider == "claude":
        import anthropic
        from .agents import orchestrator
        m = await anthropic.AsyncAnthropic().models.retrieve(orchestrator.model_name())
        return f"{m.id} is available to this key"
    raise ValueError(provider)


def failure_note(e: Exception) -> str:
    """Name the failure without echoing the provider's message, which may include request data."""
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    if code == 429:
        return "Check failed: quota or rate limit reached (HTTP 429)"
    if code in (401, 403):
        return f"Check failed: the key was refused (HTTP {code})"
    if code == 404:
        return "Check failed: this key cannot use the configured model (HTTP 404)"
    if isinstance(e, asyncio.TimeoutError):
        return "Check failed: no answer within 45 seconds"
    return f"Check failed ({type(e).__name__})"


async def check(provider: str) -> dict:
    row = next(r for r in integrations() if r["provider"] == provider)
    if row["state"] == "unavailable":
        return row  # nothing to test without credentials or data
    try:
        note = await asyncio.wait_for(_probe(provider), timeout=45)
        LAST[provider] = {"state": "verified", "detail": note, "checked_at": now_iso()}
    except Exception as e:  # noqa: BLE001 - the failure class is the useful signal; messages may echo request data
        LAST[provider] = {"state": "failed", "detail": failure_note(e), "checked_at": now_iso()}
    return next(r for r in integrations() if r["provider"] == provider)
