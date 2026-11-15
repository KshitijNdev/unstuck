"""Measure the free gap at each floor-plan doorway from the scan's own 3D mesh.

The floor plan says where a doorway is and how wide it was drawn. The mesh is the scanned geometry. For each
doorway we take the slab of space inside the wall, between knee and head height, and find the widest stretch
along the wall that no mesh triangle crosses. When that gap is centred on the doorway and matches the drawn width,
the opening is physically confirmed; when it is smaller, a door leaf or an object was in the opening during the scan.

Limits, found in a trial on 15 Nov 2026 (one Los Angeles scan, 28 doorways, 50k-face mesh):
20 gaps matched the drawn width within about 1 in, 5 were partly blocked, 3 fully blocked (door closed).
A mesh this coarse does not resolve a 1 3/4 in door leaf, so the gap is the opening between the jambs,
NOT clear width with the door open 90 degrees. The rule engine still subtracts a door allowance.

Pure Python on purpose: exact triangle clipping, no sampling, no extra dependency.
"""
from __future__ import annotations

from typing import Any

M_TO_IN = 1 / 0.0254
CELL_M = 1.0                 # grid cell for the triangle index
SIDE_MARGIN_M = 0.35         # how far past the drawn opening to look along the wall
WALL_MARGIN_M = 0.03         # slack either side of the wall thickness
KNEE_M, HEAD_CAP_M, HEAD_CLEAR_M = 0.30, 2.0, 0.15   # skip thresholds/floor clutter and the door header
MATCH_IN = 2.0               # gap within this of the drawn width counts as the same opening
CENTRE_IN = 3.0              # and its middle within this of the drawn centre
BLOCKED_IN = 6.0
MAX_OBJ_BYTES = 40_000_000

Vec3 = tuple[float, float, float]


def parse_obj(data: bytes) -> tuple[list[Vec3], list[tuple[int, int, int]]]:
    """Vertices and triangles from a Wavefront OBJ. Faces with more than three corners are fanned."""
    verts: list[Vec3] = []
    faces: list[tuple[int, int, int]] = []
    for raw in data.splitlines():
        if raw.startswith(b"v "):
            p = raw.split()
            verts.append((float(p[1]), float(p[2]), float(p[3])))
        elif raw.startswith(b"f "):
            idx = [int(tok.split(b"/")[0]) for tok in raw.split()[1:]]
            idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
            for k in range(1, len(idx) - 1):
                faces.append((idx[0], idx[k], idx[k + 1]))
    return verts, faces


class MeshIndex:
    """Triangles bucketed on a horizontal grid so each doorway only looks at what is near it."""

    def __init__(self, verts: list[Vec3], faces: list[tuple[int, int, int]]):
        self.tris: list[tuple[Vec3, Vec3, Vec3]] = []
        self.cells: dict[tuple[int, int], list[int]] = {}
        for a, b, c in faces:
            try:
                tri = (verts[a], verts[b], verts[c])
            except IndexError:
                continue
            i = len(self.tris)
            self.tris.append(tri)
            xs, ys = [p[0] for p in tri], [p[1] for p in tri]
            for cx in range(int(min(xs) // CELL_M), int(max(xs) // CELL_M) + 1):
                for cy in range(int(min(ys) // CELL_M), int(max(ys) // CELL_M) + 1):
                    self.cells.setdefault((cx, cy), []).append(i)

    def near(self, x0: float, y0: float, x1: float, y1: float) -> list[tuple[Vec3, Vec3, Vec3]]:
        seen: set[int] = set()
        for cx in range(int(x0 // CELL_M), int(x1 // CELL_M) + 1):
            for cy in range(int(y0 // CELL_M), int(y1 // CELL_M) + 1):
                seen.update(self.cells.get((cx, cy), ()))
        return [self.tris[i] for i in seen]


def _clip(poly: list[Vec3], axis: int, bound: float, keep_below: bool) -> list[Vec3]:
    """Sutherland-Hodgman clip of a convex polygon against one axis-aligned plane (in doorway coordinates)."""
    out: list[Vec3] = []
    for i, cur in enumerate(poly):
        prev = poly[i - 1]
        cin = cur[axis] <= bound if keep_below else cur[axis] >= bound
        pin = prev[axis] <= bound if keep_below else prev[axis] >= bound
        if cin != pin:
            t = (bound - prev[axis]) / (cur[axis] - prev[axis])
            out.append(tuple(prev[k] + t * (cur[k] - prev[k]) for k in range(3)))  # type: ignore[arg-type]
        if cin:
            out.append(cur)
    return out


def measure_gap(index: MeshIndex, geom: dict[str, Any]) -> dict[str, Any]:
    """Widest free stretch along the wall at one doorway. Returns {"state", "gap_in", "offset_in"}."""
    (ax, ay), (bx, by) = geom["a"], geom["b"]
    length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
    width = geom.get("width_m")
    if not length or not width:
        return {"state": "no_geometry"}
    ux, uy = (bx - ax) / length, (by - ay) / length          # along the wall
    nx, ny = -uy, ux                                          # through the wall
    cx, cy = ax + geom.get("centre", 0.5) * (bx - ax), ay + geom.get("centre", 0.5) * (by - ay)
    half = width / 2 + SIDE_MARGIN_M
    through = (geom.get("thickness_m") or 0.12) / 2 + WALL_MARGIN_M
    lower = geom.get("lower_m") or 0.0
    z0 = lower + KNEE_M
    z1 = lower + min(geom.get("height_m") or HEAD_CAP_M, HEAD_CAP_M) - HEAD_CLEAR_M
    if z1 <= z0:
        return {"state": "no_geometry"}

    reach = half + through
    tris = index.near(cx - reach, cy - reach, cx + reach, cy + reach)
    spans: list[tuple[float, float]] = []
    for tri in tris:
        # Into doorway coordinates: s along the wall, t through it, z up.
        poly: list[Vec3] = [((p[0] - cx) * ux + (p[1] - cy) * uy, (p[0] - cx) * nx + (p[1] - cy) * ny, p[2]) for p in tri]
        for axis, bound, below in ((1, through, True), (1, -through, False), (2, z1, True), (2, z0, False),
                                   (0, half, True), (0, -half, False)):
            poly = _clip(poly, axis, bound, below)
            if not poly:
                break
        if poly:
            spans.append((min(p[0] for p in poly), max(p[0] for p in poly)))
    if not tris:
        return {"state": "no_geometry"}

    spans.sort()
    best, best_mid, cursor = 0.0, 0.0, -half
    for lo, hi in spans:
        if lo - cursor > best:
            best, best_mid = lo - cursor, (lo + cursor) / 2
        cursor = max(cursor, hi)
    if half - cursor > best:
        best, best_mid = half - cursor, (half + cursor) / 2

    gap_in, offset_in, drawn_in = best * M_TO_IN, best_mid * M_TO_IN, width * M_TO_IN
    if gap_in < BLOCKED_IN:
        state = "blocked"
    elif abs(gap_in - drawn_in) <= MATCH_IN and abs(offset_in) <= CENTRE_IN:
        state = "clear"
    elif gap_in < drawn_in - MATCH_IN:
        state = "partly_blocked"
    else:
        state = "unclear"   # wider than drawn or off-centre: the mesh and the floor plan disagree here
    return {"state": state, "gap_in": round(gap_in, 1), "offset_in": round(offset_in, 1)}


def measure_doorways(obj: bytes, doorways: list[dict[str, Any]]) -> int:
    """Add mesh_state / mesh_gap_in to every doorway that carries geometry. Returns how many were confirmed clear."""
    if len(obj) > MAX_OBJ_BYTES:
        raise ValueError("scan mesh is too large to process here")
    index = MeshIndex(*parse_obj(obj))
    confirmed = 0
    for d in doorways:
        geom = d.get("geom")
        if not geom:
            continue
        got = measure_gap(index, geom)
        d["mesh_state"] = got["state"]
        d["mesh_gap_in"] = got.get("gap_in")
        confirmed += got["state"] == "clear"
    return confirmed
