"""Gemini image analysis of a doorway snapshot, through LangChain (langchain-google-genai).

What a photo can and cannot support:
  * Door type, handle type and a visible step or raised threshold: things a person can see.
  * A clear-width ESTIMATE, scaled from the floor-plan opening width we pass in. It is an
    image estimate: the rule engine may use it to suspect a narrow door, never to pass or fail one.

The free Gemini tier allows about 20 requests per model per day, and busy models return 503,
so each call tries a list of models in order with a short timeout and no retries.
"""
from __future__ import annotations

import base64
import os
from typing import Literal

from pydantic import BaseModel, Field

DEFAULT_MODELS = "gemini-3.5-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite"
TIMEOUT_S = 45


class DoorwayPhoto(BaseModel):
    """What Gemini reports about one doorway photo. Every field may be 'unclear'."""
    doorway_visible: bool = Field(description="True only if the doorway described in the prompt is clearly in the photo")
    door_type: Literal["single_swing", "double_swing", "sliding", "folding", "no_door_open_passage", "unclear"]
    door_position: Literal["open", "closed", "partly_open", "no_door", "unclear"]
    hardware: Literal["lever", "knob", "push_bar", "pull_handle", "push_plate", "none_visible", "unclear"] = Field(
        description="Operating hardware on the door leaf")
    threshold: Literal["flush", "low_threshold", "raised_threshold", "step", "unclear"] = Field(
        description="Floor at the doorway: flush, a low threshold strip, a raised threshold, or a step")
    estimated_clear_width_in: float | None = Field(
        description="Estimated clear width in inches with the door open 90 degrees, scaled from the given floor-plan "
                    "opening width. Null if the door or its frame cannot be seen well enough.")
    confidence: Literal["low", "medium", "high"]
    notes: str = Field(description="One or two short sentences on what is visible and what limits the estimate")


PROMPT = """You are helping screen a commercial building for accessibility. This photo is one face of a 360-degree \
panorama from a Matterport 3D scan, taken {distance_m:.1f} m from a doorway. The doorway is roughly straight ahead, \
near the horizontal centre of the image ({hint}).

Matterport's floor plan says this doorway's frame opening is {opening_in:.1f} inches wide. Clear width (door open \
90 degrees, measured from the face of the door to the opposite stop) is always narrower than the frame opening, \
because the door leaf and the stops take up part of it.

Look at that doorway only and report:
- whether it is clearly visible (if not, set doorway_visible false and use "unclear" elsewhere),
- the door type and whether it is open or closed,
- the operating hardware (lever, knob, push bar, pull handle, push plate),
- the floor at the doorway: flush, a low threshold strip, a raised threshold or a step,
- an estimate of the clear width in inches, using the {opening_in:.1f} in frame opening as your scale, or null if you \
cannot see the door leaf and frame well enough.
Do not guess: prefer "unclear" or null. This is a screening estimate, not a measurement."""


def available() -> bool:
    return bool(os.environ.get("GOOGLE_API_KEY")) and os.environ.get("UNSTUCK_GEMINI", "on") != "off"


def models() -> list[str]:
    return [m.strip() for m in os.environ.get("GEMINI_MODELS", DEFAULT_MODELS).split(",") if m.strip()]


def _chat(model: str):
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(model=model, google_api_key=os.environ["GOOGLE_API_KEY"], temperature=0,
                                  max_retries=0, timeout=TIMEOUT_S)


async def analyze_doorway(image_jpeg: bytes, opening_in: float, distance_m: float, hint: str) -> tuple[DoorwayPhoto, str]:
    """Ask Gemini about one doorway photo. Returns (answer, model that answered). Raises if every model fails."""
    from langchain_core.messages import HumanMessage
    msg = HumanMessage(content=[
        {"type": "text", "text": PROMPT.format(distance_m=distance_m, opening_in=opening_in, hint=hint)},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(image_jpeg).decode()}},
    ])
    errors = []
    for m in models():
        try:
            out = await _chat(m).with_structured_output(DoorwayPhoto).ainvoke([msg])
            if isinstance(out, DoorwayPhoto):
                return out, m
            errors.append(f"{m}: no structured answer")
        except Exception as e:  # quota (429), busy (503), retired (404), timeout: try the next model
            errors.append(f"{m}: {type(e).__name__} {str(e)[:80]}")
    raise RuntimeError("every Gemini model failed: " + " | ".join(errors))
