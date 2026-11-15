"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { Finding } from "@/lib/api";

/**
 * Replays an arrival by wheelchair as a sequence of stops: park, unload, cross to the entrance, pass the door.
 * Each stop is one check from this audit. Nothing is invented: a stop is "blocked" only when its check is
 * below threshold, "clear" only when it passed, and "not checked yet" otherwise.
 * The drawing shows the order of travel. It is not a drawing of this site.
 */

type State = "fail" | "pass" | "unknown";

interface Stop {
  key: string;
  verb: string;
  finding: Finding;
  state: State;
  /** Where the chair travels to reach this stop, as waypoints on the drawing. */
  path: [number, number][];
}

const W = 600;
const H = 350;
const STALL = { x: 130, w: 40, y: 232, h: 96 };
const DOOR = { x1: 402, x2: 442, y: 130 };

const KINDS: { key: string; rule: string; verb: string; path: [number, number][] }[] = [
  { key: "park", rule: "ADA_2010_208_2", verb: "Find an accessible stall", path: [[150, 284]] },
  { key: "unload", rule: "ADA_2010_208_2_4", verb: "Get out beside the van", path: [[190, 284]] },
  { key: "route", rule: "ADA_2010_403_5_1", verb: "Cross to the entrance", path: [[190, 160], [310, 160]] },
  { key: "door", rule: "ADA_2010_404_2_3", verb: "Go through the door", path: [[422, 160], [422, 136]] },
];
const START: [number, number] = [40, 284];

const stateOf = (f: Finding): State =>
  f.status === "NUMERIC_SCREEN_FAIL" ? "fail" : f.status === "NUMERIC_SCREEN_PASS" ? "pass" : "unknown";

const TONE: Record<State, { color: string; mark: string; label: string }> = {
  fail: { color: "var(--fail)", mark: "✕", label: "Blocked here" },
  pass: { color: "var(--pass)", mark: "✓", label: "Clear" },
  unknown: { color: "var(--review)", mark: "?", label: "Not checked yet" },
};

function detail(f: Finding, state: State) {
  const unit = f.required?.unit ?? f.observed?.unit ?? "";
  const need = f.required ? `at least ${f.required.value} ${unit}` : "a minimum that is not determined yet";
  if (!f.observed) return `Nobody has measured this yet. It needs ${need}.`;
  const got = `${f.observed.value} ${f.observed.unit}`;
  if (state === "fail") return `${got} recorded. It needs ${need}.`;
  if (state === "pass") return `${got} recorded, which meets ${need}.`;
  return `${got} recorded against ${need}. A person still needs to confirm it.`;
}

function buildStops(findings: Finding[]): Stop[] {
  const stops: Stop[] = [];
  for (const k of KINDS) {
    // One stop per kind: the most urgent matching check (the list arrives most urgent first).
    const f = findings.find((x) => x.rule_id === k.rule);
    if (f) stops.push({ key: k.key, verb: k.verb, finding: f, state: stateOf(f), path: k.path });
  }
  return stops;
}

const MOVE_S = 1.1;
const DWELL_MS = 2300;

export function RouteReplay({ findings, compact = false }: { findings: Finding[]; compact?: boolean }) {
  const reduce = useReducedMotion();
  const stops = buildStops(findings);
  // -1 = at the kerb, not started. stops.length = finished.
  const [at, setAt] = useState(-1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (at >= stops.length) return;
    const wait = at === -1 ? 250 : (reduce ? 0 : MOVE_S * 1000) + DWELL_MS;
    const t = setTimeout(() => {
      setAt((a) => a + 1);
      if (at + 1 >= stops.length) setPlaying(false);
    }, wait);
    return () => clearTimeout(t);
  }, [playing, at, stops.length, reduce]);

  if (stops.length === 0) {
    return compact ? <p className="p-5 text-muted">This audit has no parking or door checks to replay.</p> : null;
  }

  const finished = at >= stops.length;
  const current = at >= 0 && !finished ? stops[at] : null;
  const fails = stops.filter((s) => s.state === "fail").length;
  const unknown = stops.filter((s) => s.state === "unknown").length;

  // Chair position: the last waypoint of the stop it is at (or the kerb / the far side of the door).
  const end = (i: number): [number, number] => (i < 0 ? START : stops[Math.min(i, stops.length - 1)].path.at(-1)!);
  const from = end(at - 1);
  const leg: [number, number][] = current ? [from, ...current.path] : [end(at)];
  const xs = leg.map((p) => p[0]);
  const ys = leg.map((p) => p[1]);

  const play = () => { setAt(-1); setPlaying(true); };
  const jump = (i: number) => { setPlaying(false); setAt(i); };

  const verdict =
    fails > 0
      ? `This trip is blocked at ${fails} ${fails === 1 ? "point" : "points"}${
          unknown > 0 ? `, and ${unknown} more ${unknown === 1 ? "has" : "have"} not been checked` : ""}.`
      : unknown > 0
        ? `Nothing is known to block this trip, but ${unknown} ${unknown === 1 ? "point has" : "points have"} not been checked.`
        : "Nothing on this trip is below its threshold.";

  return (
    <div className={compact ? "grid gap-px bg-line" : "sheet grid gap-px bg-line lg:grid-cols-[1.25fr_1fr]"}>
      <div className="bg-sheet p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
          aria-label={`Diagram of an arrival by wheelchair in ${stops.length} steps. ${verdict}`}>
          <defs>
            <pattern id="rr-aisle" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="#2f353b" />
              <rect width="2.2" height="7" fill="#ffffff" />
            </pattern>
          </defs>

          {/* Building, sidewalk, lot */}
          <rect x={20} y={20} width={560} height={110} fill="#f7f7f3" />
          <path d={`M${DOOR.x1} ${DOOR.y} H20 V20 H580 V${DOOR.y} H${DOOR.x2}`} fill="none" stroke="var(--ink)" strokeWidth={3} />
          <line x1={DOOR.x1} y1={DOOR.y} x2={DOOR.x1} y2={DOOR.y - 38} stroke="var(--ink)" strokeWidth={2} />
          <path d={`M${DOOR.x2} ${DOOR.y} A40 40 0 0 0 ${DOOR.x1} ${DOOR.y - 38}`} fill="none" stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" />
          <rect x={20} y={130} width={560} height={60} fill="#d4d6cf" />
          <rect x={20} y={190} width={560} height={150} fill="#2f353b" />

          {/* Stalls */}
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={50 + i * 40} x2={50 + i * 40} y1={STALL.y} y2={STALL.y + STALL.h} stroke="#f7f7f3" strokeWidth={2.2} />
          ))}
          <rect x={STALL.x + 1.2} y={STALL.y} width={STALL.w - 2.4} height={STALL.h} fill="var(--sign)" />
          <rect x={STALL.x + STALL.w + 1.2} y={STALL.y} width={STALL.w - 2.4} height={STALL.h} fill="url(#rr-aisle)" />

          {/* The route */}
          <path d="M40 284 H190 V160 H422 V136" fill="none" stroke="#f7f7f3" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="5 6" />
          <path d="M190 190 V160 H422 V136" fill="none" stroke="var(--sign)" strokeWidth={2.5} strokeDasharray="5 6" />

          {/* A marker at each stop, coloured once the chair has reached it */}
          {stops.map((s, i) => {
            const [x, y] = s.path.at(-1)!;
            const reached = at >= i;
            const tone = TONE[s.state];
            const off = s.key === "door" ? [34, -2] : s.key === "route" ? [0, -26] : [0, -66];
            return (
              <motion.g key={s.key} initial={false}
                animate={{ opacity: reached ? 1 : 0.35, scale: at === i ? 1.12 : 1 }}
                style={{ transformOrigin: `${x + off[0]}px ${y + off[1]}px` }}
                transition={{ duration: 0.3, delay: at === i && !reduce ? MOVE_S : 0 }}>
                <circle cx={x + off[0]} cy={y + off[1]} r={15} fill={reached ? tone.color : "#8a9197"} stroke="#f7f7f3" strokeWidth={3} />
                <text x={x + off[0]} y={y + off[1] + 5.5} fontSize={16} fontWeight={700} fill="#fff" textAnchor="middle">
                  {reached ? tone.mark : i + 1}
                </text>
              </motion.g>
            );
          })}

          {/* The chair */}
          <motion.g initial={false} animate={{ x: xs, y: ys }}
            transition={{ duration: reduce ? 0 : MOVE_S * Math.max(1, leg.length - 1) * 0.6, ease: "easeInOut" }}>
            <circle r={13} fill="#fff" stroke="var(--sign)" strokeWidth={3} />
            <g transform="translate(-8 -10)" fill="none" stroke="var(--sign)" strokeWidth={1.9} strokeLinecap="round">
              <circle cx={7} cy={2.5} r={2.1} fill="var(--sign)" stroke="none" />
              <path d="M7 6v6.5h5.5l2.3 4.6" />
              <path d="M7 9h4.2" />
              <path d="M4.8 10.2a5.3 5.3 0 1 0 7.3 6.6" />
            </g>
          </motion.g>

          <text x={32} y={42} fontSize={12} fill="var(--muted)">
            Shows the order of travel, not the layout of this site
          </text>
        </svg>
      </div>

      <div className="flex flex-col bg-sheet p-5">
        <ol className="space-y-1">
          {stops.map((s, i) => {
            const reached = at >= i;
            const tone = TONE[s.state];
            return (
              <li key={s.key}>
                <button type="button" onClick={() => jump(i)} aria-current={at === i ? "step" : undefined}
                  className={`grid w-full grid-cols-[1.75rem_1fr] gap-2 px-2 py-2 text-left ${at === i ? "bg-sign-wash" : "hover:bg-concrete"}`}>
                  <span aria-hidden="true" className="font-display text-lg font-bold" style={{ color: reached ? tone.color : "var(--muted)" }}>
                    {reached ? tone.mark : i + 1}
                  </span>
                  <span>
                    <span className="font-semibold">{s.verb}</span>
                    <span className="block text-sm" style={{ color: reached ? tone.color : "var(--muted)" }}>
                      {reached ? tone.label : s.finding.title}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div aria-live="polite" className="mt-4 min-h-[6.5rem] border-t border-line-soft pt-4">
          <AnimatePresence mode="wait" initial={false}>
            {current ? (
              <motion.div key={current.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.25, delay: reduce ? 0 : MOVE_S * 0.8 }}>
                <p className="font-display text-[1.5rem] font-bold leading-tight" style={{ color: TONE[current.state].color }}>
                  {TONE[current.state].label}
                </p>
                <p className="mt-1">{detail(current.finding, current.state)}</p>
                <p className="mt-1 text-sm text-muted">{current.finding.location}. {current.finding.citation}.</p>
              </motion.div>
            ) : finished ? (
              <motion.div key="verdict" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <p className="font-display text-[1.5rem] font-bold leading-tight">{verdict}</p>
                <p className="mt-1 text-sm text-muted">A screening result, not a compliance determination.</p>
              </motion.div>
            ) : (
              <motion.p key="idle" className="text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Follow one visitor from the parking stall to the door, and see where the checks in this audit stop them.
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className="no-print mt-auto pt-4">
          <button type="button" className="btn btn-primary btn-sm" onClick={play} disabled={playing}>
            {playing ? "Playing…" : at === -1 ? "Play the trip" : "Play again"}
          </button>
        </div>
      </div>
    </div>
  );
}
