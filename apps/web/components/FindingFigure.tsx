"use client";

import { motion, useReducedMotion } from "motion/react";
import type { Finding } from "@/lib/api";

/**
 * Draws the measurement behind a check, in the language of a site drawing:
 * parking counts as a row of painted bays, widths as a dimension line against the minimum.
 * Drawn in once when it scrolls into view.
 */
export function FindingFigure({ finding: f }: { finding: Finding }) {
  if (f.rule_id.startsWith("ADA_2010_208")) return <Bays finding={f} van={f.rule_id === "ADA_2010_208_2_4"} />;
  if (f.rule_id === "ADA_2010_404_2_3" || f.rule_id === "ADA_2010_403_5_1") return <Dimension finding={f} />;
  return null;
}

const tone = (f: Finding) =>
  f.status === "NUMERIC_SCREEN_FAIL" ? "var(--fail)" : f.status === "NUMERIC_SCREEN_PASS" ? "var(--pass)" : "var(--review)";

const MAX_BAYS = 14;

function Bays({ finding: f, van }: { finding: Finding; van: boolean }) {
  const reduce = useReducedMotion();
  const req = f.required?.value ?? null;
  const obs = f.observed?.value ?? null;
  const n = Math.max(req ?? 0, obs ?? 0);
  if (n === 0) return null;
  const shown = Math.min(n, MAX_BAYS);
  const bw = van ? 34 : 26;
  const gap = 4;
  const H = 54;
  const W = shown * (bw + gap) + 4;

  const describe = [
    obs != null ? `${obs} marked` : "not counted yet",
    req != null ? `${req} required` : null,
  ].filter(Boolean).join(", ");

  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img"
        aria-label={`${van ? "Van-accessible" : "Accessible"} stalls: ${describe}.`}>
        {Array.from({ length: shown }, (_, i) => {
          const x = 2 + i * (bw + gap);
          const marked = obs != null && i < obs;
          const missing = !marked && req != null && i < req;
          return (
            <motion.g
              key={i}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.8 }}
              transition={{ duration: 0.3, delay: i * 0.045 }}
            >
              {marked ? (
                <>
                  <rect x={x} y={2} width={bw} height={H - 4} fill="var(--sign)" />
                  {van && <text x={x + bw / 2} y={H / 2 + 5} fontSize={14} fontWeight={700} fill="#fff" textAnchor="middle">V</text>}
                </>
              ) : (
                <rect x={x + 1} y={3} width={bw - 2} height={H - 6} fill="none" stroke={missing ? tone(f) : "var(--line)"}
                  strokeWidth={2} strokeDasharray="5 4" />
              )}
            </motion.g>
          );
        })}
      </svg>
      <figcaption className="mt-1.5 text-sm text-muted">
        {obs != null ? (
          <><strong className="text-ink">{obs}</strong> marked</>
        ) : "Not counted yet"}
        {req != null && <>, <strong className="text-ink">{req}</strong> required</>}
        {n > MAX_BAYS && ` (first ${MAX_BAYS} drawn)`}
      </figcaption>
    </figure>
  );
}

function Dimension({ finding: f }: { finding: Finding }) {
  const reduce = useReducedMotion();
  const req = f.required?.value ?? null;
  const obs = f.observed?.value ?? null;
  if (req == null) return null;

  // Scale from 8 in below the minimum to a little past whichever is larger.
  const lo = Math.max(0, Math.floor(Math.min(req, obs ?? req) - 8));
  const hi = Math.ceil(Math.max(req, obs ?? req) + 4);
  const W = 360;
  const H = 66;
  const pad = 8;
  const sx = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - pad * 2);
  const color = tone(f);
  const draw = (delay = 0) => ({
    initial: reduce ? false : { pathLength: 0 },
    whileInView: { pathLength: 1 },
    viewport: { once: true, amount: 0.8 },
    transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <figure className="mt-4 max-w-[360px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img"
        aria-label={obs != null ? `${f.observed?.method === "scan_floorplan" ? "Frame opening from the scan" : f.observed?.method === "scan_mesh" ? "Estimated from the scan" : "Measured"} ${obs} inches against a ${req} inch minimum clear width.` : `Not measured yet. Minimum ${req} inches.`}>
        {/* Minimum: a dashed reference line with its label */}
        <line x1={sx(req)} x2={sx(req)} y1={6} y2={H - 18} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={sx(req)} y={H - 4} fontSize={12.5} fill="var(--ink)" textAnchor="middle">{req} in minimum</text>

        {obs != null ? (
          <>
            {/* Extension lines and the dimension line, with architectural ticks */}
            <motion.line x1={sx(lo)} x2={sx(lo)} y1={10} y2={34} stroke={color} strokeWidth={1.2} {...draw()} />
            <motion.line x1={sx(obs)} x2={sx(obs)} y1={10} y2={34} stroke={color} strokeWidth={1.2} {...draw(0.1)} />
            <motion.line x1={sx(lo)} x2={sx(obs)} y1={24} y2={24} stroke={color} strokeWidth={2} {...draw(0.2)} />
            <line x1={sx(lo) - 4} x2={sx(lo) + 4} y1={28} y2={20} stroke={color} strokeWidth={1.8} />
            <motion.line x1={sx(obs) - 4} x2={sx(obs) + 4} y1={28} y2={20} stroke={color} strokeWidth={1.8}
              initial={reduce ? false : { opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              transition={{ delay: 0.8 }} />
            <text x={(sx(lo) + sx(obs)) / 2} y={16} fontSize={13} fontWeight={700} fill={color} textAnchor="middle">
              {obs} in {f.observed?.method === "scan_floorplan" ? "frame opening (scan)" : f.observed?.method === "scan_mesh" ? "estimated (scan)" : "measured"}
            </text>
          </>
        ) : (
          <text x={sx(lo)} y={22} fontSize={13} fill="var(--review)">Not measured yet</text>
        )}
      </svg>
    </figure>
  );
}
