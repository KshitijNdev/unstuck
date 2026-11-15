"""Suggest where accessible stalls are on an aerial image, for a person to confirm.

The model only proposes. Nothing it returns is counted: a suggestion becomes a mark when a person accepts it,
and the count that reaches the rule engine is still "counted by a person" (see routes.save_markups).

Trialled on 15 Nov 2026 against four Houston lots at about 10 cm/pixel: it found the right group of stalls on
every lot, sat up to one stall off, missed an occasional symbol, and its low-confidence guesses were mostly
ordinary cars. So low-confidence guesses are dropped and the person is told to check for missed stalls.
"""
from __future__ import annotations

import base64
import json
from typing import Any

from . import orchestrator

MAX_SUGGESTIONS = 40
KEEP = ("high", "medium")

PROMPT = """This is a square aerial orthophoto of a commercial property, about 10 cm per pixel and 140 m across, north up.
Find every parking stall that is marked as accessible. Count a stall only if you can see one of these:
- a painted wheelchair symbol in the stall (often white on a blue square),
- blue paint filling or outlining the stall,
- the stall sits directly beside a diagonally striped access aisle that also has one of the cues above next to it.

Do not include: the striped access aisle itself (it is not a stall), yellow hatched no-parking areas,
fire lanes, loading zones, or an ordinary stall just because a car in it is next to hatching.

Reply with JSON only, no prose:
{"stalls":[{"x":0.0,"y":0.0,"kind":"accessible","cue":"what you saw, under 12 words","confidence":"high"}],
 "notes":"one sentence on shadows, occlusion or image quality"}
x and y are the centre of the stall as fractions of the image width and height, measured from the top-left corner.
kind is "van" only when the adjacent striped aisle is clearly wider than a normal aisle; otherwise "accessible".
confidence is "high", "medium" or "low". If you see no accessible stalls, return an empty list."""


def parse(text: str) -> tuple[list[dict[str, Any]], str | None]:
    """Pull the stall list out of the model's reply. Bad or out-of-range entries are dropped, never repaired."""
    try:
        data = json.loads(text[text.index("{"):text.rindex("}") + 1])
    except ValueError:
        raise ValueError("the model did not return readable JSON")
    out: list[dict[str, Any]] = []
    for s in data.get("stalls") or []:
        try:
            x, y = float(s["x"]), float(s["y"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (0 <= x <= 1 and 0 <= y <= 1) or s.get("confidence") not in KEEP:
            continue
        out.append({"x": round(x, 4), "y": round(y, 4), "kind": "van" if s.get("kind") == "van" else "accessible",
                    "cue": str(s.get("cue") or "")[:120], "confidence": s["confidence"]})
    notes = data.get("notes")
    return out[:MAX_SUGGESTIONS], (str(notes)[:240] if notes else None)


async def suggest(image: bytes) -> tuple[list[dict[str, Any]], str | None, Any]:
    """One vision request through LangChain (the same Claude model as the Deep Agent).

    Returns (suggestions, model's note on image quality, the AIMessage for usage tracking)."""
    from langchain_core.messages import HumanMessage
    msg = HumanMessage(content=[
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(image).decode()}},
        {"type": "text", "text": PROMPT}])
    resp = await orchestrator.build_model().ainvoke([msg])
    stalls, notes = parse(orchestrator._text(resp))
    return stalls, notes, resp
