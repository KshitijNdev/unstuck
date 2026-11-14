"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Illustrated site plan used on the start page. It follows the steps of a screening:
 * 0 overview, 1 record, 2 from above, 3 inside, 4 report.
 * Example values match the copy: 120 spaces -> 5 accessible required (Table 208.2), 4 marked; door 31 in vs 32 in.
 */

const W = 600;
const H = 520;
const STALL = 32;
const X0 = 60;
const ROW_A = { y: 222, h: 80 };
const ROW_B = { y: 388, h: 80 };
const SLOTS = 15;
const DOOR = { x1: 314, x2: 350, y: 170 };

// Row A, slots 5..11 near the entrance: accessible bays, hatched aisles, and the missing fifth bay.
const ACCESSIBLE = [5, 7, 8, 10];
const AISLES = [6, 9];
const MISSING = 11;

const slotX = (i: number) => X0 + i * STALL;

const VIEW_FULL = `0 0 ${W} ${H}`;
const VIEW_DOOR = "247 96 170 147.33";

const ease = [0.22, 1, 0.36, 1] as const;

export const CAPTIONS = [
  "Illustrated site plan: a retail building above a parking lot with two rows of stalls.",
  "The CoStar record: retail centre, built 1984, 120 surface parking spaces.",
  "From above: four stalls marked accessible near the entrance; Table 208.2 asks for five.",
  "Inside: the entrance door measures 31 inches clear against a 32 inch minimum.",
  "The action plan: two checks below threshold, the entrance door and the accessible stall count.",
];

export function SitePlan({ step }: { step: number }) {
  const reduce = useReducedMotion();
  const t = (d: number, delay = 0) => (reduce ? { duration: 0 } : { duration: d, delay, ease });
  const zoomed = step === 3;
  const painted = step >= 2;

  return (
    <motion.svg
      role="img"
      aria-label={CAPTIONS[step]}
      className="block h-auto w-full"
      initial={false}
      animate={{ viewBox: zoomed ? VIEW_DOOR : VIEW_FULL }}
      transition={t(1.1)}
      viewBox={VIEW_FULL}
    >
      <defs>
        <pattern id="aisle" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#2f353b" />
          <rect width="2.2" height="7" fill="#ffffff" />
        </pattern>
      </defs>

      {/* Asphalt */}
      <rect x={40} y={210} width={520} height={270} fill="#2f353b" />
      <motion.rect
        x={40} y={210} width={520} height={270} fill="none" stroke="var(--sign)" strokeWidth={4}
        initial={false} animate={{ opacity: step === 1 ? 1 : 0 }} transition={t(0.4)}
      />

      {/* Sidewalk between building and lot */}
      <rect x={40} y={170} width={520} height={40} fill="#d4d6cf" />

      {/* Stall lines, painted on load */}
      {[ROW_A, ROW_B].map((row, r) =>
        Array.from({ length: SLOTS + 1 }, (_, i) => (
          <motion.line
            key={`${r}-${i}`}
            x1={slotX(i)} x2={slotX(i)} y1={row.y} y2={row.y + row.h}
            stroke="#f7f7f3" strokeWidth={2.2}
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={t(0.5, 0.25 + (r * (SLOTS + 1) + i) * 0.025)}
          />
        )),
      )}

      {/* Accessible bays and aisles, revealed when counting from above */}
      {AISLES.map((i) => (
        <motion.rect
          key={`aisle-${i}`} x={slotX(i) + 1.2} y={ROW_A.y} width={STALL - 2.4} height={ROW_A.h} fill="url(#aisle)"
          initial={false} animate={{ opacity: painted ? 1 : 0 }} transition={t(0.4, painted ? 0.1 : 0)}
        />
      ))}
      {ACCESSIBLE.map((i, n) => (
        <motion.g key={`acc-${i}`} initial={false} animate={{ opacity: painted ? 1 : 0 }} transition={t(0.35, painted ? 0.15 + n * 0.12 : 0)}>
          <rect x={slotX(i) + 1.2} y={ROW_A.y} width={STALL - 2.4} height={ROW_A.h} fill="var(--sign)" />
          <Wheelchair cx={slotX(i) + STALL / 2} cy={ROW_A.y + ROW_A.h / 2 + 6} />
        </motion.g>
      ))}
      <motion.g initial={false} animate={{ opacity: painted && step !== 3 ? 1 : 0 }} transition={t(0.4, painted ? 0.75 : 0)}>
        <rect
          x={slotX(MISSING) + 2.5} y={ROW_A.y + 2} width={STALL - 5} height={ROW_A.h - 4}
          fill="none" stroke="var(--fail)" strokeWidth={2.5} strokeDasharray="6 4"
        />
        <rect x={slotX(MISSING) + STALL + 2} y={ROW_A.y + 12} width={92} height={44} fill="#2f353b" />
        <text x={slotX(MISSING) + STALL + 8} y={ROW_A.y + 30} fontSize={15} fontWeight={600} fill="#f7f7f3">5th stall</text>
        <text x={slotX(MISSING) + STALL + 8} y={ROW_A.y + 48} fontSize={15} fill="#f7f7f3">required</text>
      </motion.g>

      {/* Accessible route from the aisle to the door */}
      <motion.path
        d={`M${slotX(6) + STALL / 2} ${ROW_A.y} V190 H${(DOOR.x1 + DOOR.x2) / 2} V${DOOR.y}`}
        fill="none" stroke="var(--sign)" strokeWidth={2.5} strokeDasharray="5 5"
        initial={false} animate={{ opacity: step === 2 ? 1 : 0 }} transition={t(0.4)}
      />

      {/* Building */}
      <rect x={60} y={40} width={480} height={130} fill="#f7f7f3" />
      <motion.rect
        x={60} y={40} width={480} height={130} fill="var(--sign-wash)"
        initial={false} animate={{ opacity: step === 1 ? 1 : 0 }} transition={t(0.4)}
      />
      <path d={`M${DOOR.x1} ${DOOR.y} H60 V40 H540 V${DOOR.y} H${DOOR.x2}`} fill="none" stroke="var(--ink)" strokeWidth={3} />

      {/* Door leaf and swing */}
      <line x1={DOOR.x1} y1={DOOR.y} x2={DOOR.x1} y2={DOOR.y - 36} stroke="var(--ink)" strokeWidth={2} />
      <path d={`M${DOOR.x2} ${DOOR.y} A36 36 0 0 0 ${DOOR.x1} ${DOOR.y - 36}`} fill="none" stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" />

      {/* Record labels */}
      <AnimatePresence>
        {step === 1 && (
          <motion.g key="record" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t(0.35)}>
            <text x={84} y={82} fontSize={22} fontWeight={700} fill="var(--ink)" fontFamily="Barlow Condensed">Retail centre</text>
            <text x={84} y={106} fontSize={16} fill="var(--ink)">Built 1984</text>
            <text x={84} y={127} fontSize={16} fill="var(--ink)">From the CoStar record</text>
            <text x={300} y={353} fontSize={26} fontWeight={700} fill="#f7f7f3" textAnchor="middle" fontFamily="Barlow Condensed">120 surface spaces</text>
          </motion.g>
        )}
      </AnimatePresence>

      {/* Door measurement, readable only when zoomed in */}
      <motion.g initial={false} animate={{ opacity: zoomed ? 1 : 0 }} transition={t(0.4, zoomed ? 0.7 : 0)}>
        <line x1={DOOR.x1} x2={DOOR.x1} y1={DOOR.y + 2} y2={DOOR.y + 20} stroke="var(--fail)" strokeWidth={0.7} />
        <line x1={DOOR.x2} x2={DOOR.x2} y1={DOOR.y + 2} y2={DOOR.y + 20} stroke="var(--fail)" strokeWidth={0.7} />
        <line x1={DOOR.x1} x2={DOOR.x2} y1={DOOR.y + 15} y2={DOOR.y + 15} stroke="var(--fail)" strokeWidth={0.9} />
        <line x1={DOOR.x1 - 2.5} x2={DOOR.x1 + 2.5} y1={DOOR.y + 17.5} y2={DOOR.y + 12.5} stroke="var(--fail)" strokeWidth={1.1} />
        <line x1={DOOR.x2 - 2.5} x2={DOOR.x2 + 2.5} y1={DOOR.y + 17.5} y2={DOOR.y + 12.5} stroke="var(--fail)" strokeWidth={1.1} />
        <text x={(DOOR.x1 + DOOR.x2) / 2} y={DOOR.y + 28} fontSize={7.5} fontWeight={700} fill="var(--fail)" textAnchor="middle">31 in clear</text>
        <text x={(DOOR.x1 + DOOR.x2) / 2} y={DOOR.y + 37} fontSize={5.5} fill="var(--ink)" textAnchor="middle">32 in minimum, §404.2.3</text>
        <text x={DOOR.x1 - 4} y={DOOR.y - 20} fontSize={5.5} fill="var(--ink)" textAnchor="end">door open 90°</text>
      </motion.g>

      {/* Report callouts */}
      <AnimatePresence>
        {step === 4 && (
          <motion.g key="callouts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t(0.35)}>
            <Callout x={(DOOR.x1 + DOOR.x2) / 2} y={DOOR.y - 58} n={1} />
            <Callout x={slotX(MISSING) + STALL / 2} y={ROW_A.y + ROW_A.h + 30} n={2} />
          </motion.g>
        )}
      </AnimatePresence>

      <text x={W - 8} y={H - 6} fontSize={12} fill="var(--muted)" textAnchor="end" opacity={zoomed ? 0 : 1}>
        Illustration, not a real property
      </text>
    </motion.svg>
  );
}

function Callout({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={14} fill="var(--fail)" stroke="#f7f7f3" strokeWidth={3} />
      <text x={x} y={y + 5.5} fontSize={16} fontWeight={700} fill="#fff" textAnchor="middle">{n}</text>
    </g>
  );
}

/** Simplified International Symbol of Access, drawn in white on a blue bay. */
function Wheelchair({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g transform={`translate(${cx - 8} ${cy - 11})`} fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round">
      <circle cx={7} cy={2.5} r={2.2} fill="#fff" stroke="none" />
      <path d="M7 6v7h6l2.5 5" />
      <path d="M7 9.5h4.5" />
      <path d="M4.6 10.6a5.6 5.6 0 1 0 7.7 6.9" />
    </g>
  );
}
