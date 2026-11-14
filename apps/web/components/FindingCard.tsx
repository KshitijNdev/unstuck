"use client";

import { useState } from "react";
import { StatusBadge, ErrorNote } from "@/components/ui";
import { addMeasurement, CONFIDENCE, verifyFinding, type Finding } from "@/lib/api";

const PARKING_FIELDS = [
  { name: "parking_total_spaces", label: "Total spaces in this lot" },
  { name: "parking_accessible_spaces", label: "Marked accessible spaces" },
  { name: "parking_van_spaces", label: "Van-accessible spaces" },
];
const DOOR_FIELDS = [
  { name: "door_clear_width_in", label: "Clear width, door open 90° (in)" },
  { name: "door_opening_depth_in", label: "Opening depth (in)" },
];

function fmt(v: { value: number; unit: string } | null) {
  return v ? `${v.value} ${v.unit}` : "Unknown";
}

export function FindingCard({ finding: f, auditId, selected, onSelect, onChanged }: {
  finding: Finding; auditId: string; selected: boolean; onSelect: () => void; onChanged: () => Promise<void>;
}) {
  const isParking = f.rule_id.startsWith("ADA_2010_208");
  const isDoor = f.rule_id === "ADA_2010_404_2_3";
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
    const reviewer = who || window.prompt("Your name, for the audit trail:") || "";
    if (!reviewer) return;
    setWho(reviewer);
    run(async () => { await verifyFinding(f.id, { action, reviewer }); });
  };

  return (
    <li className={`rounded-2xl border bg-card p-4 ${selected ? "border-brand ring-2 ring-brand" : "border-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Priority {f.priority} · {f.location}
          </p>
          <h3 className="mt-0.5 text-lg font-semibold">{f.title}</h3>
        </div>
        <StatusBadge status={f.status} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Requirement</dt><dd className="font-semibold">{f.required ? `≥ ${fmt(f.required)}` : "Not determined"}</dd></div>
        <div><dt className="text-muted">Observed</dt><dd className="font-semibold">{fmt(f.observed)}</dd></div>
        <div><dt className="text-muted">Basis</dt><dd className="font-semibold capitalize">{f.label}</dd><dd className="text-muted">{CONFIDENCE[f.confidence] ?? f.confidence}</dd></div>
        <div><dt className="text-muted">Review</dt><dd className="font-semibold">{f.review_status.replaceAll("_", " ").toLowerCase()}</dd>{f.reviewed_by && <dd className="text-muted">by {f.reviewed_by}</dd>}</div>
      </dl>

      <p className="mt-3 text-sm">{f.rationale}</p>
      {f.required?.condition && <p className="mt-1 text-sm text-muted">Applies because: {f.required.condition}.</p>}
      {f.borderline && <p className="mt-1 text-sm font-medium text-review">Close to the threshold: re-measure before acting.</p>}
      <p className="mt-2 text-sm"><span className="font-semibold">Next step: </span>{f.followup}</p>
      <p className="mt-1 text-xs text-muted">{f.citation} · screening result, not a compliance determination.</p>

      {error && <div className="mt-3"><ErrorNote message={error} /></div>}

      <div className="no-print mt-3 flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={onSelect} aria-pressed={selected}>
          {selected ? "Showing evidence" : "Show evidence"}
        </button>
        {fields.length > 0 && (
          <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {f.observed ? "Update measurement" : "Add measurement"}
          </button>
        )}
        {f.label === "measured" && f.review_status !== "APPROVED" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => review("approve")}>Confirm reviewed</button>
        )}
        {f.review_status === "NOT_REVIEWED" && f.label !== "measured" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => review("needs_field_visit")}>Flag for field visit</button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="no-print mt-3 grid gap-3 rounded-xl bg-paper p-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.name} className="text-sm font-medium">
              {field.label}
              <input className="field mt-1" type="number" min={0} step={isParking ? 1 : "any"} inputMode="decimal"
                value={values[field.name] ?? ""} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} />
            </label>
          ))}
          <label className="text-sm font-medium">
            How was it measured?
            <select className="field mt-1" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="field">On site (tape measure / counted in person)</option>
              <option value="manual">Entered from another record</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Your name
            <input className="field mt-1" required maxLength={80} value={who} onChange={(e) => setWho(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Save and re-run checks</button>
          </div>
        </form>
      )}
    </li>
  );
}
