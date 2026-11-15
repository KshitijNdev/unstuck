"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { builtBeforeAda, ErrorNote, PreAdaNote, rovingKeys } from "@/components/ui";
import { TourMeasure } from "@/components/TourMeasure";
import { CATEGORY_LABEL, doorwayNumber, feetInches, chooseModel, evidenceUrl, getSources, saveMarkups, suggestMarkups, type Audit, type StallSuggestion, type Candidate, type Evidence, type Finding, type Pin,
  type Region } from "@/lib/api";

export type Layer = "aerial" | "interior" | "record";

type Cam = { k: number; x: number; y: number };
const HOME: Cam = { k: 1, x: 0, y: 0 };
const MAX_ZOOM = 8;
const PAD = 64;  // keeps the image clear of the floating controls

const MARKER_TONE = (f: Finding) =>
  f.status === "NUMERIC_SCREEN_FAIL" ? "#ff7a6e" : f.status === "NUMERIC_SCREEN_PASS" ? "#62d49c" : "#f2c230";

/** Short hopper labels; full titles and citations stay in the inspector. */
const SHORT: Record<string, string> = {
  ADA_2010_208_2: "Accessible spaces", ADA_2010_208_2_4: "Van space", ADA_2010_404_2_3: "Clear door",
  ADA_2010_403_5_1: "Route width", ADA_2010_303: "Level change",
};

/** Which layer holds the evidence for a check: door and route checks are inside, everything else is from above. */
export const layerOf = (f: Finding): Layer =>
  /door|entrance|route|403|404/i.test(`${f.rule_id} ${f.title}`) && !/parking/i.test(f.title) ? "interior" : "aerial";

type ScanDoor = { door_id?: string; floor: string; center?: [number, number] | null; width_in: number | null };

/** The floor plan Matterport drew, with every scan doorway on that floor; the selected one is ringed. Positions come
 *  from the wall vertices and each opening's place along its wall, never from a guess. */
function ScanPlan({ walls, doors, selectedDoor, onPick, numbers }: {
  walls: number[][]; doors: ScanDoor[]; selectedDoor: string; onPick: (doorId: string) => void;
  /** Doorway number by door id, so the plan can be read against the findings list. */
  numbers: Record<string, number>;
}) {
  const xs = walls.flatMap((w) => [w[0], w[2]]), ys = walls.flatMap((w) => [w[1], w[3]]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05;
  const vb = `${x0 - pad} ${-(y1 + pad)} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;  // y flipped so the plan reads like a drawing
  const unit = Math.max(x1 - x0, y1 - y0) / 100;
  const on = doors.find((d) => d.door_id === selectedDoor);
  return (
    <svg className="st-plan-svg" viewBox={vb} role="img" aria-label="Matterport floor plan with each scan doorway numbered and the selected one ringed">
      {walls.map((w, i) => <line key={i} x1={w[0]} y1={-w[1]} x2={w[2]} y2={-w[3]} className="st-plan-wall" strokeWidth={unit * 0.7} />)}
      {doors.filter((d) => d.center && d.door_id !== selectedDoor).map((d) => (
        <circle key={d.door_id} cx={d.center![0]} cy={-d.center![1]} r={unit * 1.4} className="st-plan-door"
          onClick={() => d.door_id && onPick(d.door_id)}>
          <title>{`Scan doorway ${numbers[d.door_id ?? ""] ?? "?"}, ${d.width_in ?? "?"} in frame opening`}</title>
        </circle>
      ))}
      {doors.filter((d) => d.center && d.door_id && numbers[d.door_id] != null).map((d) => (
        <text key={`n-${d.door_id}`} x={d.center![0] + unit * 2.2} y={-d.center![1] + unit * 1.3} fontSize={unit * 3.4}
          className={`st-plan-num ${d.door_id === selectedDoor ? "on" : ""}`} strokeWidth={unit * 0.9}
          onClick={() => onPick(d.door_id!)}>{numbers[d.door_id!]}</text>
      ))}
      {on?.center && (
        <g>
          <circle cx={on.center[0]} cy={-on.center[1]} r={unit * 4.5} className="st-plan-ring" strokeWidth={unit * 0.8} />
          <circle cx={on.center[0]} cy={-on.center[1]} r={unit * 1.8} className="st-plan-on" />
        </g>
      )}
    </svg>
  );
}

function Unavailable({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="st-empty" role="status">
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <rect x="6" y="6" width="32" height="32" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" />
        <path d="M14 30l6-8 5 5 5-7" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

function Hud({ ev, extra }: { ev: Evidence; extra?: string }) {
  const scale = ev.scale as { native_resolution?: number; units?: string; note?: string } | null;
  const bits = [
    ev.provider,
    ev.is_synthetic ? "synthetic" : ev.is_sponsor_source ? "sponsor data" : "public fallback",
    ev.capture_date ? `captured ${ev.capture_date}` : null,
    scale?.native_resolution ? `${scale.native_resolution} ${scale.units?.toLowerCase() ?? ""}/px` : scale?.note ?? null,
  ].filter(Boolean);
  return (
    <div className="st-hud" title={[bits.join(", "), extra, ev.rights, ev.quality].filter(Boolean).join(". ")}>
      <span className={`st-hud-dot ${ev.is_synthetic ? "warn" : ""}`} aria-hidden="true" />
      <span>{bits.join(", ")}</span>
      {extra && <strong>{extra}</strong>}
    </div>
  );
}

/** Pannable, zoomable plane. Children are laid out in a 0..1 box; markers counter-scale so they stay readable. */
function Plane({ aspect, cam, setCam, animate, onPlace, inset, children }: {
  aspect: number; cam: Cam; setCam: (c: Cam) => void; animate: boolean; inset: number;
  onPlace?: (x: number, y: number) => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const camRef = useRef(cam);
  useEffect(() => { camRef.current = cam; });
  // Keyboard crosshair for placing marks, in image fractions. Arrow keys move it, Enter or Space places a mark.
  const [cur, setCur] = useState({ x: 0.5, y: 0.5 });
  const keyboard = !!onPlace || cam.k > 1;
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (onPlace) {
      if (d) setCur((c) => ({ x: Math.min(1, Math.max(0, c.x + d[0] * step)), y: Math.min(1, Math.max(0, c.y + d[1] * step)) }));
      else if (e.key === "Enter" || e.key === " ") onPlace(cur.x, cur.y);
      else return;
    } else if (d && cam.k > 1) {
      const px = e.shiftKey ? 160 : 48;
      setCam({ ...cam, x: cam.x - d[0] * px, y: cam.y - d[1] * px });
    } else return;
    e.preventDefault();
    e.stopPropagation();  // keep the stage's arrow-key check hopper from also firing
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The floating inspector covers the right edge, so the image fits and centres in the space left of it.
  const cw = Math.max(0, Math.min(size.w - inset - PAD * 2, (size.h - PAD * 2) * aspect));
  const ch = cw / aspect;
  const bx = (size.w - inset - cw) / 2;
  const by = (size.h - ch) / 2;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const c = camRef.current;
      const k = Math.min(MAX_ZOOM, Math.max(1, c.k * Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0015)));
      const sx = e.clientX - r.left - bx, sy = e.clientY - r.top - by;
      const px = (sx - c.x) / c.k, py = (sy - c.y) / c.k;
      setCam(k === 1 ? HOME : { k, x: sx - px * k, y: sy - py * k });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bx, by, setCam]);

  return (
    <div ref={ref} className={`st-plane ${onPlace ? "placing" : ""}`}
      tabIndex={keyboard ? 0 : undefined} role={keyboard ? "application" : undefined} onKeyDown={keyboard ? onKeyDown : undefined}
      aria-label={!keyboard ? undefined : onPlace
        ? "Stall marking area. Arrow keys move the crosshair, Shift moves it further, Enter or Space places a mark."
        : "Zoomed image. Arrow keys pan, Shift pans further."}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        if (camRef.current.k > 1) setCam({ ...camRef.current, x: d.cx + dx, y: d.cy + dy });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved || !onPlace || !boxRef.current) return;
        const r = boxRef.current.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPlace(x, y);
      }}>
      {cw > 0 && (
        <div ref={boxRef} className="st-box" style={{
          left: bx, top: by, width: cw, height: ch,
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`,
          transition: animate ? "transform 520ms cubic-bezier(.22,1,.36,1)" : "none",
          ["--inv" as string]: 1 / cam.k,
        }}>
          {children}
          {onPlace && <span className="st-crosshair" aria-hidden="true" style={{ left: `${cur.x * 100}%`, top: `${cur.y * 100}%` }} />}
        </div>
      )}
    </div>
  );
}

function Marker({ x, y, tone, label, on, onClick, shape = "round", title }: {
  x: number; y: number; tone: string; label: string; on?: boolean; onClick?: () => void; shape?: "round" | "square"; title: string;
}) {
  return (
    <button type="button" className={`st-marker ${on ? "on" : ""} ${shape}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, ["--tone" as string]: tone }}
      aria-label={title} title={title} aria-pressed={onClick ? !!on : undefined} disabled={!onClick}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      {label}
    </button>
  );
}

type Box = { x: number; y: number; w: number; h: number };

export const aerialSources = (audit: Audit) =>
  audit.evidence.filter((e) => e.asset_type === "aerial_image" || e.asset_type === "schematic");

/** Gemini candidates on the image. Suggested: dashed paint-yellow. Accepted: solid sign-blue. Rejected: hidden. */
function CandidateBoxes({ candidates, focusId, onFocus }: {
  candidates: Candidate[]; focusId: string | null; onFocus: (id: string) => void;
}) {
  return (
    <>
      {candidates.filter((c) => c.status !== "rejected").map((c) => (
        <button key={c.id} type="button" className={`st-cand ${c.status} ${focusId === c.id ? "on" : ""}`}
          style={{ left: `${c.box.x * 100}%`, top: `${c.box.y * 100}%`, width: `${c.box.w * 100}%`, height: `${c.box.h * 100}%` }}
          aria-label={`${c.status === "accepted" ? "Accepted" : "AI-suggested"} ${CATEGORY_LABEL[c.category].toLowerCase()}, ${c.confidence} confidence`}
          aria-pressed={focusId === c.id} onClick={(e) => { e.stopPropagation(); onFocus(c.id); }}>
          <span className="st-cand-tag">{CATEGORY_LABEL[c.category]}</span>
        </button>
      ))}
    </>
  );
}

export function SpatialStage({ audit, auditId, selected, onSelect, layer, setLayer, onChanged,
  aerialId, setAerialId, focusId, onFocus, analysis, inset }: {
  audit: Audit; auditId: string; selected: Finding | null; onSelect: (id: string) => void;
  layer: Layer; setLayer: (l: Layer) => void; onChanged: () => Promise<void>;
  aerialId: string | null; setAerialId: (id: string) => void;
  focusId: string | null; onFocus: (id: string | null) => void;
  analysis: React.ReactNode; inset: number;
}) {
  const sources = aerialSources(audit);
  const site = sources.find((e) => e.id === aerialId) ?? sources[0];
  const tour = audit.evidence.find((e) => e.asset_type === "tour");
  const record = audit.evidence.find((e) => e.asset_type === "record");
  const regions: Region[] = site?.asset_type === "schematic" ? site.geometry?.regions ?? [] : [];
  const saved = site?.geometry?.pins ?? null;
  const candidates = site?.geometry?.ai?.candidates ?? [];

  const [cam, setCamState] = useState<Cam>(HOME);
  const [animate, setAnimate] = useState(false);
  const [marking, setMarking] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [kind, setKind] = useState<Pin["kind"]>("accessible");
  const [who, setWho] = useState(site?.geometry?.pins_by ?? "");
  // Claude stall suggestions are proposals only: they stay apart from the marks until a person accepts each one.
  const [ideas, setIdeas] = useState<StallSuggestion[] | null>(null);
  const [ideaNote, setIdeaNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [vexcelAi, setVexcelAi] = useState<boolean | null>(null);  // null until the status is read
  useEffect(() => {
    getSources().then((r) => setVexcelAi(!!r.integrations.find((i) => i.provider === "vexcel")?.ai_permitted)).catch(() => setVexcelAi(null));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [img, setImg] = useState<{ url: string | null; state: "ready" | "failed" | "timeout"; aspect: number }>({ url: null, state: "ready", aspect: 1 });
  const [attempt, setAttempt] = useState(0);
  const [tourLoaded, setTourLoaded] = useState<string | null>(null);  // the model whose embed has fired load  // bumps the image request on Retry
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [switching, setSwitching] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isImage = site?.asset_type === "aerial_image";
  const imgState = img.url === (site?.view_url ?? null) ? img.state : "loading";
  // A provider that never answers would leave the spinner up forever; after 25 s offer Retry instead.
  useEffect(() => {
    if (!isImage || imgState !== "loading" || !site?.view_url) return;
    const url = site.view_url;
    const t = setTimeout(() => setImg((v) => (v.url === url ? v : { url, state: "timeout", aspect: 1 })), 25000);
    return () => clearTimeout(t);
  }, [isImage, imgState, site?.view_url, attempt]);
  const retry = <button type="button" className="btn btn-sm st-retry" onClick={() => { setImg({ url: null, state: "ready", aspect: 1 }); setAttempt((a) => a + 1); }}>Retry</button>;
  // The plane takes the image's real proportions, so boxes in 0-1 image space land on the right pixels.
  const aspect = !site ? 1 : isImage ? (img.url === site.view_url ? img.aspect : 1) : 1.5;
  const vw = size.w - inset;  // visible width, left of the floating inspector
  const fitW = Math.max(0, Math.min(vw - PAD * 2, (size.h - PAD * 2) * aspect));
  const fitH = fitW / aspect;

  // Keep the zoomed plane covering its own footprint: no panning the evidence off-screen.
  const clamp = useCallback((c: Cam): Cam => (c.k <= 1.001 ? HOME : {
    k: c.k,
    x: Math.min(0, Math.max(fitW * (1 - c.k), c.x)),
    y: Math.min(0, Math.max(fitH * (1 - c.k), c.y)),
  }), [fitW, fitH]);
  const setCam = useCallback((c: Cam) => { setAnimate(false); setCamState(clamp(c)); }, [clamp]);
  const flyTo = useCallback((c: Cam) => { setAnimate(true); setCamState(clamp(c)); }, [clamp]);
  const zoomBy = (f: number) => {
    const k = Math.min(MAX_ZOOM, Math.max(1, cam.k * f));
    const sx = fitW / 2, sy = fitH / 2;
    flyTo({ k, x: sx - (sx - cam.x) * (k / cam.k), y: sy - (sy - cam.y) * (k / cam.k) });
  };

  // Camera shot: a focused candidate wins, then the selected check's drawn region, otherwise the overview.
  const focused = candidates.find((c) => c.id === focusId);
  const region = regions.find((r) => r.id === selected?.location_id);
  // A parking check on real imagery points at the stalls people have marked or accepted.
  const stallBoxes: Box[] = selected?.rule_id.startsWith("ADA_2010_208") && isImage
    ? [...(saved ?? []).map((p) => ({ x: p.x - 0.02, y: p.y - 0.02, w: 0.04, h: 0.04 })),
       ...candidates.filter((c) => c.status === "accepted" && c.category === "parking_stall").map((c) => c.box)]
    : [];
  const stalls: Box | null = stallBoxes.length ? (() => {
    const x = Math.min(...stallBoxes.map((b) => b.x)), y = Math.min(...stallBoxes.map((b) => b.y));
    return { x, y, w: Math.max(...stallBoxes.map((b) => b.x + b.w)) - x, h: Math.max(...stallBoxes.map((b) => b.y + b.h)) - y };
  })() : null;
  const target: Box | null = focused?.box ?? region ?? stalls;
  const targetKey = target ? `${target.x},${target.y},${target.w},${target.h}` : "home";
  useEffect(() => {
    if (layer !== "aerial" || marking || !fitW) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the camera follows the selected evidence
    if (!target) { flyTo(HOME); return; }
    const maxK = focused ? 4.5 : 2.2;  // small pavement markings deserve a closer look than a whole lot
    const k = Math.min(maxK, Math.max(1, Math.min((vw * 0.4) / (target.w * fitW), (size.h * 0.4) / (target.h * fitH))));
    flyTo({
      k,
      x: vw / 2 - (vw - fitW) / 2 - k * (target.x + target.w / 2) * fitW,
      y: size.h / 2 - (size.h - fitH) / 2 - k * (target.y + target.h / 2) * fitH,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-aim only when the target or layout changes
  }, [targetKey, layer, fitW, fitH, marking, site?.id, inset]);

  // Finding hopper: step through checks with the arrow keys, as HeatHunter steps through rooms.
  const findings = audit.findings;
  const idx = Math.max(0, findings.findIndex((f) => f.id === selected?.id));
  const hop = (d: number) => findings.length && onSelect(findings[(idx + d + findings.length) % findings.length].id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || marking
        || t.closest("input, textarea, select, [contenteditable], iframe, [role=tablist], [role=radiogroup], [role=dialog], [role=application]")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); hop(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); hop(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const startMarking = () => { setPins(saved ?? []); setIdeas(null); setIdeaNote(null); setMarking(true); onFocus(null); flyTo(HOME); };

  async function suggest() {
    setLooking(true);
    setError(null);
    try {
      const res = await suggestMarkups(auditId);
      // Skip anything sitting on a mark already placed (within about one stall).
      setIdeas(res.suggestions.filter((s) => !pins.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 0.012)));
      setIdeaNote(res.notes);
    } catch (err) { setError((err as Error).message); }
    finally { setLooking(false); }
  }
  const acceptIdeas = (list: StallSuggestion[]) => {
    setPins((p) => [...p, ...list.map((s) => ({ x: s.x, y: s.y, kind: s.kind, suggested: true }))]);
    setIdeas((cur) => (cur ?? []).filter((s) => !list.includes(s)));
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await saveMarkups(auditId, pins, who, site?.id); setMarking(false); await onChanged(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const linked = ((record?.geometry?.summary as { model_ids?: string[] } | undefined)?.model_ids) ?? [];
  const tourInfo = tour?.geometry?.summary as { model_id?: string; name?: string; panos?: number;
    doorways?: ScanDoor[]; floor_plan?: Record<string, number[][]> } | undefined;
  async function pick(modelId: string) {
    setSwitching(true);
    setError(null);
    try { await chooseModel(auditId, modelId); await onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setSwitching(false); }
  }

  // A scan doorway lives in one linked model: open that model. The floor plan gives no position, so say so instead of guessing.
  const doorModel = audit.property.doors.find((d) => d.id === selected?.location_id)?.model_id ?? null;
  const wrongModel = layer === "interior" && !!doorModel && !!tourInfo?.model_id && doorModel !== tourInfo.model_id && linked.includes(doorModel);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the tour follows the selected doorway's scan
    if (wrongModel && !switching) void pick(doorModel!);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- switch once per selected doorway, not on every pick identity change
  }, [wrongModel, doorModel]);

  const layers: { id: Layer; label: string; ok: boolean }[] = [
    { id: "aerial", label: site?.asset_type === "schematic" ? "Site plan" : "Aerial", ok: !!site },
    { id: "interior", label: "3D interior", ok: !!tour },
    { id: "record", label: "Record", ok: !!record },
  ];
  const shown = marking ? pins : saved ?? [];
  const pinNote = saved?.length ? `${saved.length} stall${saved.length === 1 ? "" : "s"} counted by ${site?.geometry?.pins_by}` : undefined;

  return (
    <div className="st-stage">
      <div className="st-top">
        <div className="st-group st-left">
        <div className="st-switch" role="tablist" aria-label="Evidence view" onKeyDown={rovingKeys("tab")}>
          {layers.map((l) => (
            <button key={l.id} id={`st-tab-${l.id}`} role="tab" type="button" aria-selected={layer === l.id} aria-controls="st-view"
              tabIndex={layer === l.id ? 0 : -1} onClick={() => { setMarking(false); setLayer(l.id); }}>
              {layer === l.id && <motion.span layoutId="st-view-pill" className="st-pill" transition={{ type: "spring", bounce: 0.18, duration: 0.45 }} />}
              <span className="st-switch-label">
                <span className={`st-led ${l.ok ? "ok" : ""}`} aria-hidden="true" />{l.label}
                {!l.ok && <span className="sr-only"> (unavailable)</span>}
              </span>
            </button>
          ))}
        </div>
          {layer === "aerial" && sources.length > 1 && (
            <div className="st-seg quiet" role="radiogroup" aria-label="Aerial source" onKeyDown={rovingKeys("radio")}>
              {sources.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={s.id === site?.id} tabIndex={s.id === site?.id ? 0 : -1}
                  onClick={() => { setMarking(false); onFocus(null); setAerialId(s.id); }}>
                  {s.provider}
                </button>
              ))}
            </div>
          )}
        </div>
        {layer === "interior" && tour && linked.length > 1 && (
          <div className="st-group">
            <div className="st-seg quiet" role="radiogroup" aria-label={`Linked Matterport scans (${linked.length})`}>
              <span className="st-seg-label">Scan</span>
              {linked.map((m, i) => (
                <button key={m} type="button" role="radio" aria-checked={m === tourInfo?.model_id} disabled={switching}
                  title={`Matterport scan ${m}`} onClick={() => m !== tourInfo?.model_id && pick(m)}>{i + 1}</button>
              ))}
            </div>
          </div>
        )}
        {layer === "aerial" && !marking && (
          <div className="st-group">
            {isImage && imgState === "ready" && (
              <button type="button" className="st-tool" onClick={startMarking}>{saved ? "Edit stall marks" : "Mark stalls"}</button>
            )}
            {analysis}
          </div>
        )}
      </div>

      <div ref={canvas} id="st-view" className="st-canvas" role="tabpanel" aria-labelledby={`st-tab-${layer}`}>
        {layer === "aerial" && !site && (
          <Unavailable title="No aerial view for this property">
            Neither Vexcel imagery nor a site plan is available. A person needs to record exterior conditions on site.
          </Unavailable>
        )}

        {layer === "aerial" && site && (
          <>
            <Plane aspect={aspect} cam={cam} setCam={setCam} animate={animate} inset={inset}
              onPlace={marking ? (x, y) => setPins((p) => [...p, { x, y, kind }]) : undefined}>
              {isImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote provider imagery */}
                  <img key={`${site.view_url}#${attempt}`} className="st-img" draggable={false}
                    src={attempt ? `${evidenceUrl(site.view_url!)}${evidenceUrl(site.view_url!).includes("?") ? "&" : "?"}retry=${attempt}` : evidenceUrl(site.view_url!)}
                    onLoad={(e) => setImg({ url: site.view_url, state: "ready",
                      aspect: e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 1 })}
                    onError={() => setImg({ url: site.view_url, state: "failed", aspect: 1 })}
                    alt={`Aerial image from ${site.provider} centred on the property, captured ${site.capture_date ?? "on an unknown date"}.`} />
                  {!marking && <CandidateBoxes candidates={candidates} focusId={focusId} onFocus={onFocus} />}
                  {marking && ideas?.map((s, i) => (
                    <Marker key={`idea${i}`} x={s.x} y={s.y} tone="#f2c230" label="?" shape="round"
                      title={`AI suggestion ${i + 1}, not yet verified: possible ${s.kind === "van" ? "van-accessible" : "accessible"} stall. The model saw: ${s.cue}. Activate to accept.`}
                      onClick={() => acceptIdeas([s])} />
                  ))}
                  {shown.map((p, i) => (
                    <Marker key={i} x={p.x} y={p.y} tone={p.kind === "van" ? "#a99bf0" : "#6db2f5"} label={p.kind === "van" ? "V" : "A"}
                      shape={p.kind === "van" ? "square" : "round"}
                      title={`Stall mark ${i + 1}: ${p.kind === "van" ? "van-accessible" : "accessible"}${p.candidate_id ? ", from an accepted AI suggestion" : ""}${marking ? ". Activate to remove." : ""}`}
                      onClick={marking ? () => setPins(pins.filter((_, j) => j !== i)) : undefined} />
                  ))}
                </>
              ) : (
                <>
                  <svg className="st-svg" viewBox="0 0 1 1" preserveAspectRatio="none" role="img"
                    aria-label={`Synthetic site plan.${region ? ` Highlighted: ${region.label}.` : ""}`}>
                    {regions.map((r) => (
                      <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h} vectorEffect="non-scaling-stroke"
                        className={`st-region ${r.kind} ${r.id === selected?.location_id ? "on" : ""}`} />
                    ))}
                  </svg>
                  {regions.filter((r) => fitW * cam.k > 560 || r.id === selected?.location_id).map((r) => (
                    <span key={r.id} className={`st-rlabel ${r.id === selected?.location_id ? "on" : ""}`}
                      style={{ left: `${(r.x + r.w / 2) * 100}%`, top: `${(r.y + (r.kind === "door" ? -0.045 : r.h / 2)) * 100}%` }}>
                      {r.label}
                    </span>
                  ))}
                  {audit.findings.map((f, i) => {
                    const r = regions.find((x) => x.id === f.location_id);
                    if (!r) return null;
                    // Doors are small: pin the marker on the door itself and keep its label above. Areas get a corner pin.
                    const door = r.kind === "door";
                    return <Marker key={f.id} x={door ? r.x + r.w / 2 : r.x + r.w} y={door ? r.y + r.h / 2 : r.y} tone={MARKER_TONE(f)} label={String(i + 1)}
                      on={selected?.id === f.id} title={`Check ${i + 1}: ${f.title}, ${f.location}`} onClick={() => onSelect(f.id)} />;
                  })}
                </>
              )}
            </Plane>
            {isImage && imgState === "loading" && <div className="st-overlay" role="status"><span className="st-spin" /><span>Loading imagery</span></div>}
            {isImage && imgState === "failed" && (
              <Unavailable title="The aerial image didn’t load" action={retry}>
                The provider didn’t return the image, so stalls can’t be marked yet. Retry, or switch to another aerial source.
              </Unavailable>
            )}
            {isImage && imgState === "timeout" && (
              <Unavailable title="The aerial image is taking too long" action={retry}>
                The provider hasn’t answered in 25 seconds. Retry, or switch to another aerial source.
              </Unavailable>
            )}
            <div className="st-zoom" role="group" aria-label="Camera">
              <button type="button" aria-label="Zoom in" title="Zoom in" disabled={cam.k >= MAX_ZOOM} onClick={() => zoomBy(1.6)}>+</button>
              <button type="button" aria-label="Zoom out" title="Zoom out" disabled={cam.k <= 1} onClick={() => zoomBy(1 / 1.6)}>−</button>
              <button type="button" aria-label="Fit to view" title="Fit to view" disabled={cam.k === 1} onClick={() => { onFocus(null); flyTo(HOME); }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" /></svg>
              </button>
            </div>
          </>
        )}

        {layer === "interior" && !tour && (
          <Unavailable title="No authorized 3D scan for this property">
            No Matterport model is linked to this CoStar record. Door widths need a tape measure on site. Nothing is
            estimated from a scan of a different building.
          </Unavailable>
        )}
        {layer === "interior" && tour && (tour.view_url ? (
          <>
            <TourMeasure key={tour.provider_asset_id} src={tour.view_url} modelId={tour.provider_asset_id}
              title={`Matterport 3D tour of ${tourInfo?.name ?? "the property"}`}
              audit={audit} auditId={auditId} selected={selected} onChanged={onChanged}
              onLoad={() => setTourLoaded(tour.provider_asset_id)} />
            {tourLoaded !== tour.provider_asset_id && (
              <div className="st-tour st-tour-wait" role="status"><span className="st-spin" /><span>Loading 3D tour</span></div>
            )}
          </>
        ) : (
          <Unavailable title="This scan is private">The model exists but can’t be embedded. Open it in Matterport with the owner’s access.</Unavailable>
        ))}
        {layer === "interior" && tour && doorModel && selected && (() => {
          const ready = !switching && !wrongModel;
          const door = ready ? tourInfo?.doorways?.find((d) => d.door_id === selected.location_id) : undefined;
          const walls = door ? tourInfo?.floor_plan?.[door.floor] : undefined;
          const placed = !!(door?.center && walls?.length);
          return (
            <div className="st-locnote" role="status">
              {placed && (
                <ScanPlan walls={walls!} doors={tourInfo!.doorways!.filter((d) => d.floor === door!.floor)} selectedDoor={selected.location_id}
                  numbers={Object.fromEntries(audit.property.doors.flatMap((d) => { const n = doorwayNumber(d.label); return n == null ? [] : [[d.id, n]]; }))}
                  onPick={(id) => { const f = audit.findings.find((x) => x.location_id === id); if (f) onSelect(f.id); }} />
              )}
              <p>
                <strong>{selected.location.replace(/ \(door-[^)]*\)$/, "")}</strong>
                {selected.observed?.triage && ` · ${feetInches(selected.observed.value)} opening`}
                {ready ? ` · scan ${linked.indexOf(doorModel) + 1 || ""} (${doorModel})` : ` · opening scan ${doorModel}…`}
              </p>
              {ready && (
                <span>
                  {placed
                    ? "Ringed on Matterport’s floor plan, from the wall it sits in. The 3D tour can’t be steered to it from here; find it in the tour by its place on the plan."
                    : "Location not available from this scan: its floor plan doesn’t give a position for this opening, so it isn’t drawn."}
                </span>
              )}
            </div>
          );
        })()}

        {layer === "record" && !record && (
          <Unavailable title="No property record">CoStar didn’t return a record for this property, so its use type and size are unknown.</Unavailable>
        )}
        {layer === "record" && record && (
          <div className="st-record" role="region" aria-labelledby="st-record-h" tabIndex={0}>
            <h2 id="st-record-h">{audit.property.name}</h2>
            {builtBeforeAda(audit.property.year_built) && <PreAdaNote year={audit.property.year_built} className="dark" />}
            <dl>
              {Object.entries(record.geometry?.summary ?? {}).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => (
                <div key={k}><dt>{k.replaceAll("_", " ")}</dt><dd>{String(v)}</dd></div>
              ))}
              <div><dt>linked 3D scans</dt><dd>{linked.length}</dd></div>
            </dl>
            <p>{record.provider}, retrieved {record.retrieved_at ? new Date(record.retrieved_at).toLocaleDateString() : "on an unknown date"}. {record.rights}</p>
          </div>
        )}
      </div>

      {marking && (
        <form onSubmit={save} className="st-dock">
          <fieldset>
            <legend className="sr-only">Next mark</legend>
            <label><input type="radio" name="kind" checked={kind === "accessible"} onChange={() => setKind("accessible")} /> Accessible stall</label>
            <label><input type="radio" name="kind" checked={kind === "van"} onChange={() => setKind("van")} /> Van-accessible</label>
          </fieldset>
          <p aria-live="polite">
            {pins.length} marked, {pins.filter((p) => p.kind === "van").length} van-accessible. Click a stall to add a mark, or focus the image and use the arrow keys and Enter. Activate a mark to remove it.
            {ideas && (ideas.length ? ` ${ideas.length} AI suggestion${ideas.length === 1 ? "" : "s"} shown as “?”: click each one you agree with.` : " No AI suggestions left to review.")}
            {ideaNote && ` ${ideaNote}`}
            {site?.provider === "Vexcel" && vexcelAi === false && " AI stall suggestions are off: Vexcel imagery isn’t approved for AI processing."}
          </p>
          <label className="st-name">Your name
            <input className="field" required maxLength={80} value={who} onChange={(e) => setWho(e.target.value)} />
          </label>
          {site?.provider === "Vexcel" && (
            <button className="btn btn-sm" type="button" onClick={suggest} disabled={looking || vexcelAi === false}
              title={vexcelAi === false ? "Not available: Vexcel imagery is not approved for AI processing. Mark stalls by hand, or use Analyze parking on the public USGS image."
                : "Claude looks for painted accessible stalls on this image."}>
              {looking ? "Looking at the image…" : ideas ? "Suggest again" : "Suggest stalls with AI"}
            </button>
          )}
          {ideas && ideas.length > 1 && <button className="btn btn-sm" type="button" onClick={() => acceptIdeas(ideas)}>Accept all {ideas.length}</button>}
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Save counts</button>
          <button className="btn btn-sm" type="button" onClick={() => setMarking(false)}>Cancel</button>
        </form>
      )}
      {error && <div className="st-err"><ErrorNote message={error} /></div>}

      <div className="st-bl">
      {layer === "aerial" && site && (
        <Hud ev={site} extra={!isImage ? "Schematic, not imagery" : [pinNote, site.provider === "USGS NAIP" ? "AI analysis permitted (public domain)" : "Not sent to AI services"].filter(Boolean).join(". ")} />
      )}
      {layer === "interior" && tour && <Hud ev={tour} extra={`${tourInfo?.panos ?? 0} scan positions`} />}
      </div>

      {findings.length > 0 && !marking && (
        <nav className="st-hopper" aria-label="Step through checks (left and right arrow keys)">
          <button type="button" aria-label="Previous check" onClick={() => hop(-1)}>‹</button>
          {findings.length <= 7 ? findings.map((f, i) => (
            <button key={f.id} type="button" aria-current={f.id === selected?.id ? "true" : undefined} onClick={() => onSelect(f.id)}
              title={`${f.title}, ${f.location}`}>
              <span className="st-hop-dot" style={{ background: MARKER_TONE(f) }} aria-hidden="true" />
              {i + 1}<span className="st-hop-text">{SHORT[f.rule_id] ?? f.title}</span>
            </button>
          )) : selected && (
            // Many checks (for example every doorway in a scan): one compact chip with position, not dozens of buttons.
            <button type="button" aria-current="true" title={`${selected.title}, ${selected.location}`} className="st-hop-compact">
              <span className="st-hop-dot" style={{ background: MARKER_TONE(selected) }} aria-hidden="true" />
              {SHORT[selected.rule_id] ?? selected.title}<span className="st-hop-count">{idx + 1} of {findings.length}</span>
            </button>
          )}
          <button type="button" aria-label="Next check" onClick={() => hop(1)}>›</button>
        </nav>
      )}
    </div>
  );
}
