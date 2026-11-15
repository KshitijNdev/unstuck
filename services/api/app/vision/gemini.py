"""Gemini vision: candidate parking-accessibility features on an aerial image.

Candidates are visual suggestions for a person to review. They are never measurements and never
feed the ADA rules directly: only stall candidates a person accepts become counted marks.

Coordinates: Gemini returns `box_2d` as [ymin, xmin, ymax, xmax], each normalised to 0-1000 over the
image it was shown (Google "image understanding" docs). We convert to {x, y, w, h} in 0-1 of the FULL
image (top-left origin), which is what the web UI renders. Crops are mapped back with their offset.
"""
from __future__ import annotations

import asyncio
import io
import os
import uuid
from dataclasses import dataclass
from typing import Literal

from PIL import Image
from pydantic import BaseModel, Field, ValidationError

CATEGORIES = ("accessible_symbol", "parking_stall", "access_aisle", "curb_ramp")
Category = Literal["accessible_symbol", "parking_stall", "access_aisle", "curb_ramp"]
DEFAULT_MODEL = "gemini-3.5-flash"
TIMEOUT_S = 60.0
RETRY_WAIT_S = 8.0  # back-off after a 429, doubled on the second retry
MAX_PER_VIEW = 40

PROMPT = """You are helping a person screen a parking lot for accessibility features on a top-down aerial photo.
Report only features you can actually see. If you are not sure, leave it out. An empty list is a good answer.
Categories:
- accessible_symbol: a painted International Symbol of Accessibility (wheelchair pictogram) on the pavement.
- parking_stall: one individual painted parking stall that contains an accessible symbol or blue paint.
  Do NOT box ordinary stalls.
- access_aisle: a striped (hatched) access aisle next to a stall.
- curb_ramp: a curb ramp or cut where a sidewalk meets the parking surface.
Return box_2d as [ymin, xmin, ymax, xmax] normalised to 0-1000. Keep each note short and say what is visible."""


class RawDetection(BaseModel):
    category: Category
    box_2d: list[int] = Field(min_length=4, max_length=4)
    confidence: Literal["high", "medium", "low"]
    note: str = Field(max_length=300)


class RawResponse(BaseModel):
    detections: list[RawDetection] = Field(max_length=MAX_PER_VIEW)
    image_notes: str = Field(default="", max_length=600)


class _Detection(BaseModel):
    """Request schema sent to Gemini. The API rejects length constraints, so they live in RawResponse instead."""
    category: Category
    box_2d: list[int]
    confidence: Literal["high", "medium", "low"]
    note: str


class _Schema(BaseModel):
    detections: list[_Detection]
    image_notes: str


class VisionError(Exception):
    def __init__(self, kind: Literal["not_configured", "timeout", "rate_limited", "api_error", "malformed"], message: str):
        super().__init__(message)
        self.kind = kind


@dataclass(frozen=True)
class View:
    """A region of the full image sent to the model, as fractions of the full image."""
    name: str
    x0: float
    y0: float
    w: float
    h: float


def views(width: int, height: int) -> list[View]:
    """The whole frame, plus a 2x2 grid of overlapping crops so small pavement markings get more pixels."""
    out = [View("full frame", 0, 0, 1, 1)]
    if min(width, height) >= 600:
        size, step = 0.6, 0.4
        for r in range(2):
            for c in range(2):
                out.append(View(f"crop {r * 2 + c + 1} of 4", c * step, r * step, size, size))
    return out


def to_image_box(box_2d: list[int], view: View) -> dict[str, float] | None:
    """[ymin, xmin, ymax, xmax] in 0-1000 of `view` -> {x, y, w, h} in 0-1 of the full image. None if invalid."""
    if len(box_2d) != 4 or any(not isinstance(v, int) for v in box_2d):
        return None
    ymin, xmin, ymax, xmax = box_2d
    if not all(0 <= v <= 1000 for v in box_2d) or ymin >= ymax or xmin >= xmax:
        return None
    w, h = (xmax - xmin) / 1000, (ymax - ymin) / 1000
    if w * h > 0.5:  # half the view or more is not a pavement marking
        return None
    return {"x": round(view.x0 + xmin / 1000 * view.w, 5), "y": round(view.y0 + ymin / 1000 * view.h, 5),
            "w": round(w * view.w, 5), "h": round(h * view.h, 5)}


def _iou(a: dict, b: dict) -> float:
    ix = max(0.0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
    iy = max(0.0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
    inter = ix * iy
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union else 0.0


RANK = {"high": 3, "medium": 2, "low": 1}


def merge(candidates: list[dict]) -> list[dict]:
    """Drop duplicates seen in overlapping views: same category and IoU >= 0.4 keeps the more confident one."""
    kept: list[dict] = []
    for c in sorted(candidates, key=lambda c: -RANK[c["confidence"]]):
        if not any(k["category"] == c["category"] and _iou(k["box"], c["box"]) >= 0.4 for k in kept):
            kept.append(c)
    return kept


def parse(text: str, view: View) -> tuple[list[dict], int, str]:
    """Validate one model response. Returns (candidates, rejected_count, notes). Raises on malformed JSON."""
    try:
        raw = RawResponse.model_validate_json(text)
    except ValidationError as e:
        raise VisionError("malformed", f"Gemini returned a response that does not match the schema ({e.error_count()} errors)") from e
    out, rejected = [], 0
    for d in raw.detections:
        box = to_image_box(d.box_2d, view)
        if box is None:
            rejected += 1
            continue
        out.append({"category": d.category, "box": box, "confidence": d.confidence, "note": d.note.strip(), "view": view.name})
    return out, rejected, raw.image_notes.strip()


def _crop_jpeg(img: Image.Image, v: View) -> bytes:
    W, H = img.size
    box = (round(v.x0 * W), round(v.y0 * H), round((v.x0 + v.w) * W), round((v.y0 + v.h) * H))
    buf = io.BytesIO()
    img.crop(box).convert("RGB").save(buf, "JPEG", quality=92)
    return buf.getvalue()


def model_name() -> str:
    return os.environ.get("GEMINI_VISION_MODEL", DEFAULT_MODEL)


def configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


async def _ask(client, data: bytes) -> str:
    from google.genai import errors, types
    try:
        r = await asyncio.wait_for(client.aio.models.generate_content(
            model=model_name(),
            contents=[types.Part.from_bytes(data=data, mime_type="image/jpeg"), PROMPT],
            config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=_Schema,
                                               temperature=0),
        ), timeout=TIMEOUT_S)
    except asyncio.TimeoutError as e:
        raise VisionError("timeout", f"Gemini did not answer within {TIMEOUT_S:.0f} s") from e
    except errors.APIError as e:
        if e.code == 429:
            raise VisionError("rate_limited", "Gemini rate limit reached. Try again in a minute.") from e
        raise VisionError("api_error", f"Gemini API error {e.code}") from e
    if not r.text:
        raise VisionError("malformed", "Gemini returned an empty response")
    return r.text


async def analyze(image_bytes: bytes, on_progress=None) -> dict:
    """Run every view, validate, merge. Returns the run record with candidates (status 'suggested')."""
    if not configured():
        raise VisionError("not_configured", "GEMINI_API_KEY is not set on the API server")
    from google import genai
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except Exception as e:  # noqa: BLE001 - any decode failure means no usable image
        raise VisionError("malformed", "The imagery provider did not return a readable image") from e
    W, H = img.size
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    vs = views(W, H)
    found, rejected, notes = [], 0, []
    for i, v in enumerate(vs):
        if on_progress:
            on_progress(i, len(vs), v.name)
        for attempt in range(3):
            try:
                text = await _ask(client, _crop_jpeg(img, v))
                break
            except VisionError as e:
                if e.kind != "rate_limited" or attempt == 2:
                    raise
                await asyncio.sleep(RETRY_WAIT_S * (attempt + 1))
        c, r, n = parse(text, v)
        found += c
        rejected += r
        if n:
            notes.append(f"{v.name}: {n}")
    candidates = [{"id": f"cand_{uuid.uuid4().hex[:8]}", "status": "suggested", **c} for c in merge(found)]
    from importlib.metadata import version
    return {"model": model_name(), "sdk": f"google-genai {version('google-genai')}",
            "image_width": W, "image_height": H, "views": [v.name for v in vs],
            "rejected_boxes": rejected, "notes": notes, "candidates": candidates}
