"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { FindingFigure } from "@/components/FindingFigure";
import { StatusBadge, ErrorNote } from "@/components/ui";
import { addMeasurement, CONFIDENCE, verifyFinding, type Finding, TRIAGE } from "@/lib/api";

const PARKING_FIELDS = [
  { name: "parking_total_spaces", label: "Total spaces in this lot" },
  { name: "parking_accessible_spaces", label: "Marked accessible spaces" },
  { name: "parking_van_spaces", label: "Van-accessible spaces" },
];
const DOOR_FIELDS = [
  { name: "door_clear_width_in", label: "Clear opening width, door open 90° (in)" },
  { name: "door_opening_depth_in", label: "Opening depth (in)" },
];

function fmt(v: { value: number; unit: string } | null) {
  // "1 space", "2 spaces": units arrive plural from the rules.
  return v ? `${v.value} ${v.value === 1 ? v.unit.replace(/spaces$/, "space") : v.unit}` : "Unknown";
}

/** "Scan doorway 20, Floor 2 (door-unknown)" -> "Scan doorway 20 · Floor 2 · door type unknown" */
export function placeLabel(loc: string) {
  const m = loc.match(/^(.*?), (.*?) \(door-(.*)\)$/);
  if (!m) return loc;
  return `${m[1]} · ${m[2]} · ${m[3] === "unknown" ? "door type unknown" : `${m[3].replace("-", " ")} door`}`;
}

export function FindingCard({ finding: f, auditId, selected, onSelect, onChanged }: {
  finding: Finding; auditId: string; selected: boolean; onSelect: () => void; onChanged: () => Promise<void>;
}) {
  const isParking = f.rule_id.startsWith("ADA_2010_208");
  const isDoor = f.rule_id === "ADA_2010_404_2_3";
  const scan = f.observed?.method === "scan_floorplan";
  const fields = isParking ? PARKING_FIELDS : isDoor ? DOOR_FIELDS : [];
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [who, setWho] = useState("");
  const [method, setMethod] = useState("field");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await action(); await onChanged(); }
    catch (e) { setError((e as Error).message); await onChanged(); }
    finally { setBusy(false); }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      for (const field of fields) {
        const raw = values[field.name];
        if (raw === undefined || raw === "") continue;
        await addMeasurement(auditId, {
          location_id: f.location_id, name: field.name, value: Number(raw),
          unit: isParking ? "spaces" : "in", method, reviewed_by: who,
        });
      }
      setOpen(false);
      setValues({});
    });
  };

  const review = (action: string) => {
    // Reuse the name given in AI review ("Reviewing as"); ask only when no name is known yet.
    const reviewer = who || localStorage.getItem("unstuck.reviewer") || window.prompt("Your name, for the audit trail:") || "";
    if (!reviewer) return;
    setWho(reviewer);
    run(async () => { await verifyFinding(f.id, { action, reviewer }); });
  };

  return (
    <li className={`sheet p-5 transition-shadow ${selected ? "shadow-[inset_4px_0_0_var(--sign)]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="font-display text-[1.6rem] font-bold leading-tight">{f.title}</h3>
          <p className="text-[0.95rem] text-muted">{placeLabel(f.location)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">Priority {f.priority}</span>
          <motion.span key={f.status} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}>
            <StatusBadge status={f.status} />
          </motion.span>
        </div>
      </div>

      <FindingFigure finding={f} />

      <dl className="fc-grid mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line-soft pt-3 text-[0.95rem]">
        <div><dt className="text-sm text-muted">Requirement</dt><dd className="font-semibold">{f.required ? `At least ${fmt(f.required)}` : "Not determined"}</dd></div>
        {scan ? (
          <>
            <div><dt className="text-sm text-muted">Frame opening (scan)</dt><dd className="font-semibold">{fmt(f.observed)}</dd></div>
            <div><dt className="text-sm text-muted">Clear width</dt><dd className="font-semibold">Not verified</dd><dd className="text-sm text-muted">Needs a hand measurement</dd></div>
          </>
        ) : <div><dt className="text-sm text-muted">Observed</dt><dd className="font-semibold">{fmt(f.observed)}</dd></div>}
        <div><dt className="text-sm text-muted">Basis</dt><dd className="font-semibold first-letter:uppercase">{f.label}</dd><dd className="text-sm text-muted">{CONFIDENCE[f.confidence] ?? f.confidence}</dd></div>
        <div><dt className="text-sm text-muted">Review</dt><dd className="font-semibold first-letter:uppercase">{f.review_status.replaceAll("_", " ").toLowerCase()}</dd>{f.reviewed_by && <dd className="text-sm text-muted">by {f.reviewed_by}</dd>}</div>
      </dl>

      <p className="mt-4 max-w-[46rem]">{f.rationale}</p>
      {f.required?.condition && <p className="mt-1 text-[0.95rem] text-muted">{f.observed ? "Applies because" : "Requirement note"}: {f.required.condition}.</p>}
      {f.observed?.triage && f.observed.clear_estimate_in && (
        <p className="mt-1 text-[0.95rem] text-muted">
          <span className="font-semibold text-ink">{TRIAGE[f.observed.triage]}.</span>{" "}
          A hinged door here would leave about {f.observed.clear_estimate_in[0]} to {f.observed.clear_estimate_in[1]} in
          clear. Estimated from the scan&apos;s floor plan, not measured.
        </p>
      )}
      {f.borderline && <p className="mt-1 text-[0.95rem] font-semibold text-review">Close to the minimum: measure again before acting.</p>}
      <p className="mt-3 max-w-[46rem]"><span className="font-semibold">Next step: </span>{f.followup}</p>
      <p className="mt-2 text-sm text-muted">{f.citation}. A screening result, not a compliance determination.</p>

      <details className="fc-tech mt-2 text-sm text-muted">
        <summary>Source details</summary>
        <p>Rule {f.rule_id} · basis {f.confidence}{f.observed?.method ? ` · method ${f.observed.method}` : ""} · location {f.location_id}
          {typeof (f.observed as { wall_thickness_in?: number } | null)?.wall_thickness_in === "number" ? ` · wall ${(f.observed as { wall_thickness_in?: number }).wall_thickness_in} in` : ""}</p>
      </details>

      {error && <div className="mt-3"><ErrorNote message={error} /></div>}

      <div className="no-print mt-4 flex flex-wrap gap-2">
        {!selected && <button className="btn btn-sm" onClick={onSelect}>Show evidence</button>}
        {fields.length > 0 && (
          <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {f.observed ? "Update measurement" : "Add measurement"}
          </button>
        )}
        {f.label === "measured" && f.review_status !== "APPROVED" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => review("approve")}>Mark as reviewed</button>
        )}
        {f.review_status === "NOT_REVIEWED" && f.label !== "measured" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => review("needs_field_visit")}>Needs a site visit</button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.form key="measure" onSubmit={submit} className="no-print overflow-hidden"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
            <div className="mt-4 grid gap-3 border-l-4 border-sign bg-sign-wash p-4 sm:grid-cols-2">
              {fields.map((field) => (
                <label key={field.name} className="text-[0.95rem] font-medium">
                  {field.label}
                  <input className="field mt-1" type="number" min={0} step={isParking ? 1 : "any"} inputMode="decimal"
                    value={values[field.name] ?? ""} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} />
                </label>
              ))}
              <label className="text-[0.95rem] font-medium">
                How was it measured?
                <select className="field mt-1" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="field">On site (tape measure or counted in person)</option>
                  <option value="manual">{isParking ? "Counted by a person on the aerial image" : "Entered from another record"}</option>
                  {isDoor && <option value="model_metric">Measured by hand in the 3D scan</option>}
                </select>
              </label>
              <label className="text-[0.95rem] font-medium">
                Your name
                <input className="field mt-1" required maxLength={80} value={who} onChange={(e) => setWho(e.target.value)} />
              </label>
              <div className="sm:col-span-2">
                <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Save and recheck</button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </li>
  );
}
