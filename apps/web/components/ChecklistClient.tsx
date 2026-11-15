"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { placeLabel } from "@/components/FindingCard";
import { QrCode } from "@/components/QrCode";
import { ErrorNote, StatusBadge, SyntheticBanner } from "@/components/ui";
import { addMeasurement, getAudit, TRIAGE, type Audit, type Finding } from "@/lib/api";

type Area = "parking" | "route" | "entrance" | "inside";
interface Field { name: string; label: string; unit: "spaces" | "in"; step: number | "any" }
interface Item {
  key: string;
  area: Area;
  location_id: string;
  place: string;
  findings: Finding[];
  fields: Field[];
  measure: string;   // what to do with the tape measure
  why: string;       // why it is on the list, in order of urgency
  rank: number;
}

const AREAS: { id: Area; title: string; blurb: string }[] = [
  { id: "parking", title: "Parking", blurb: "Count every stall in the lot, then the marked accessible and van-accessible stalls." },
  { id: "route", title: "Route to the door", blurb: "Walk the route a visitor takes from the accessible stalls to the entrance." },
  { id: "entrance", title: "Entrance", blurb: "Open the door to 90° and measure from the face of the door to the stop." },
  { id: "inside", title: "Inside, from the 3D scan", blurb: "Doorways the scan's floor plan could not show to be wide enough. Narrowest first." },
];

const PARKING: Field[] = [
  { name: "parking_total_spaces", label: "Total spaces in this lot", unit: "spaces", step: 1 },
  { name: "parking_accessible_spaces", label: "Marked accessible spaces", unit: "spaces", step: 1 },
  { name: "parking_van_spaces", label: "Van-accessible spaces", unit: "spaces", step: 1 },
];
const DOOR: Field[] = [
  { name: "door_clear_width_in", label: "Clear width, door open 90° (in)", unit: "in", step: "any" },
  { name: "door_opening_depth_in", label: "Depth of the opening, through the wall (in)", unit: "in", step: "any" },
];
const TRIAGE_RANK = { narrow: 0, likely_narrow: 1, measure: 2, likely_wide: 3 } as const;

const isParking = (f: Finding) => f.rule_id.startsWith("ADA_2010_208");
const isDoor = (f: Finding) => f.rule_id === "ADA_2010_404_2_3";
const fmt = (v: { value: number; unit: string }) => `${v.value} ${v.value === 1 ? v.unit.replace(/spaces$/, "space") : v.unit}`;

/** A check still needs someone on site unless it rests on a trusted measurement taken there and is not borderline. */
function needsVisit(f: Finding) {
  if (f.status === "OUT_OF_SCOPE") return false;
  if (f.label !== "measured" || f.borderline) return true;
  return f.status === "NUMERIC_SCREEN_FAIL" && f.observed?.method !== "field";
}

function whyLine(fs: Finding[]): { text: string; rank: number } {
  const fail = fs.find((f) => f.status === "NUMERIC_SCREEN_FAIL");
  if (fail) return { text: `Recorded ${fail.observed ? fmt(fail.observed) : "value"} is below the minimum. Confirm on site before acting.`, rank: 0 };
  const close = fs.find((f) => f.borderline);
  if (close) return { text: "The reading is within half an inch of the minimum. Measure again.", rank: 1 };
  // A reading exists but is not enough on its own (for example a width with no depth): the rules say what is missing.
  const partial = fs.find((f) => f.observed && f.observed.method !== "scan_floorplan" && f.label !== "measured");
  if (partial) return { text: partial.rationale, rank: 1 };
  const scan = fs.find((f) => f.observed?.triage);
  if (scan?.observed?.triage) {
    const est = scan.observed.clear_estimate_in;
    return {
      text: `${TRIAGE[scan.observed.triage]}.${est ? ` The scan's floor plan suggests about ${est[0]} to ${est[1]} in clear; that is an estimate, not a measurement.` : ""}`,
      rank: 2 + TRIAGE_RANK[scan.observed.triage],
    };
  }
  const visual = fs.find((f) => f.status === "SUSPECTED_VISUAL_BARRIER");
  if (visual) return { text: "Seen in imagery as a possible barrier, never measured.", rank: 6 };
  return { text: "No trusted measurement yet.", rank: 7 };
}

function buildItems(audit: Audit): { open: Item[]; done: Finding[] } {
  const groups = new Map<string, Finding[]>();
  const done: Finding[] = [];
  for (const f of audit.findings) {
    if (f.status === "OUT_OF_SCOPE") continue;
    if (!needsVisit(f)) { done.push(f); continue; }
    // Both parking rules share one lot count, so one stop per lot; every other check is its own stop.
    const key = isParking(f) ? `parking:${f.location_id}` : `${f.rule_id}:${f.location_id}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const open = [...groups.entries()].map(([key, fs]): Item => {
    const f = fs[0];
    const area: Area = isParking(f) ? "parking" : !isDoor(f) ? "route" : f.location_id.startsWith("scan_door_") ? "inside" : "entrance";
    const why = whyLine(fs);
    const reqs = fs.filter((x) => x.required).map((x) => `${x.title}: at least ${fmt(x.required!)}${x.required!.condition ? ` (${x.required!.condition})` : ""}`);
    return {
      key, area, location_id: f.location_id, place: placeLabel(f.location), findings: fs,
      fields: isParking(f) ? PARKING : isDoor(f) ? DOOR : [],
      measure: reqs.length ? reqs.join(". ") : f.followup,
      why: why.text, rank: why.rank * 100 + f.priority,
    };
  });
  open.sort((a, b) => AREAS.findIndex((x) => x.id === a.area) - AREAS.findIndex((x) => x.id === b.area) || a.rank - b.rank || a.place.localeCompare(b.place, undefined, { numeric: true }));
  return { open, done };
}

function Stop({ item, n, auditId, who, onSaved }: { item: Item; n: number; auditId: string; who: string; onSaved: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!who.trim()) { setError("Add your name at the top of the checklist first, for the audit trail."); return; }
    const filled = item.fields.filter((f) => (values[f.name] ?? "") !== "");
    if (!filled.length) { setError("Enter at least one reading."); return; }
    setBusy(true);
    try {
      for (const f of filled) {
        await addMeasurement(auditId, { location_id: item.location_id, name: f.name, value: Number(values[f.name]), unit: f.unit, method: "field", reviewed_by: who.trim() });
      }
      setValues({});
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      await onSaved();
    }
  }

  return (
    <li className="ck-stop">
      <span className="ck-n" aria-hidden="true">{n}</span>
      <div className="ck-body">
        <div className="ck-stop-head">
          <h3>{item.findings.length > 1 ? "Parking counts" : item.findings[0].title}<span>{item.place}</span></h3>
          <div className="ck-badges">{[...new Set(item.findings.map((f) => f.status))].map((s) => <StatusBadge key={s} status={s} />)}</div>
        </div>
        <p className="ck-why">{item.why}</p>
        <p className="ck-req"><strong>Minimum.</strong> {item.measure}.</p>
        {item.fields.length > 0 ? (
          <form className="ck-form" onSubmit={save} aria-label={`Readings for stop ${n}`}>
            {item.fields.map((f) => (
              <label key={f.name}>
                {f.label}
                <input className="field" type="number" inputMode="decimal" min={0} step={f.step}
                  value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              </label>
            ))}
            <div className="ck-save no-print">
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and recheck"}</button>
              {saved && !error && <span role="status">Saved and rechecked.</span>}
            </div>
          </form>
        ) : (
          <p className="ck-manual"><span className="ck-box" aria-hidden="true" /> Checked on site. Notes: <span className="ck-line" aria-hidden="true" /></p>
        )}
        {error && <ErrorNote message={error} />}
      </div>
    </li>
  );
}

export function ChecklistClient({ id }: { id: string }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Same name the inspection workspace remembers; read lazily because the server has no storage.
  const [who, setWho] = useState(() => {
    try { return typeof window === "undefined" ? "" : localStorage.getItem("unstuck.reviewer") ?? ""; } catch { return ""; }
  });

  const refresh = useCallback(async () => {
    try { setAudit(await getAudit(id)); } catch (e) { setError((e as Error).message); }
  }, [id]);

  useEffect(() => { getAudit(id).then(setAudit).catch((e: Error) => setError(e.message)); }, [id]);

  const items = useMemo(() => (audit ? buildItems(audit) : null), [audit]);
  // Only rendered once the audit has loaded in the browser, so reading the origin here never differs from the server HTML.
  const url = audit && typeof window !== "undefined" ? `${window.location.origin}/audits/${id}/checklist` : "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);

  function remember(name: string) {
    setWho(name);
    try { localStorage.setItem("unstuck.reviewer", name); } catch { /* not essential */ }
  }

  if (error && !audit) return <div className="rp"><ErrorNote message={error} /></div>;
  if (!audit || !items) return <p role="status" className="rp text-muted">Loading the field checklist…</p>;
  let n = 0;

  return (
    <article className="rp ck">
      <div className="rp-actions no-print">
        <Link className="btn btn-sm" href={`/audits/${id}`}>Back to inspection</Link>
        <Link className="btn btn-sm" href={`/audits/${id}/report`}>Action plan</Link>
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Print checklist</button>
      </div>

      <header className="ck-head">
        <div>
          <p className="rp-kicker">Field checklist</p>
          <h1>{audit.property.name}</h1>
          <p className="rp-sub-head">{[audit.property.address ?? "Address not recorded", audit.id, `screened ${new Date(audit.started_at).toLocaleDateString()}`].join(" · ")}</p>
          <p className="ck-intro">
            Bring a tape measure. Stops follow a visitor&apos;s route from the parking lot to the door and inside, and each area lists
            the checks most likely to fall short first. Write each reading in its box, or scan the code to enter it on a phone:
            every saved reading re-runs the check.
          </p>
        </div>
        {url && (
          <figure className="ck-qr">
            <QrCode value={url} label={`QR code linking to this checklist: ${url}`} />
            <figcaption>{local ? "This code points to this computer. Open the checklist from the public site to use it on a phone." : "Scan to enter readings on a phone"}</figcaption>
          </figure>
        )}
      </header>

      {audit.is_synthetic && <SyntheticBanner />}
      {audit.status !== "COMPLETE" && <ErrorNote message="This screening has not finished, so the list may be incomplete. Readings can be saved once it finishes." />}

      <div className="ck-who">
        <label>
          Measured by
          <input className="field" maxLength={80} value={who} onChange={(e) => remember(e.target.value)} placeholder="Your name" autoComplete="name" />
        </label>
        <p className="ck-date">Date <span className="ck-line" aria-hidden="true" /></p>
      </div>

      {items.open.length === 0 ? (
        <p className="ck-empty">Nothing left to measure: every check rests on a reading taken on site. The action plan has the results.</p>
      ) : AREAS.map((area) => {
        const stops = items.open.filter((i) => i.area === area.id);
        return stops.length === 0 ? null : (
          <section key={area.id} className="ck-area" aria-labelledby={`ck-${area.id}`}>
            <h2 id={`ck-${area.id}`}>{area.title}</h2>
            <p className="ck-area-blurb">{area.blurb}</p>
            <ol className="ck-list">
              {stops.map((item) => <Stop key={item.key} item={item} n={++n} auditId={id} who={who} onSaved={refresh} />)}
            </ol>
          </section>
        );
      })}

      {items.done.length > 0 && (
        <section className="ck-area ck-done" aria-labelledby="ck-done">
          <h2 id="ck-done">Already measured on site</h2>
          <ul>
            {items.done.map((f) => (
              <li key={f.id}><StatusBadge status={f.status} /> {f.title}, {placeLabel(f.location)}{f.observed ? `: ${fmt(f.observed)}` : ""}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="ck-foot">A screening checklist, not a certified inspection. Slopes and cross slopes need a level or a surveyor, never this list.</p>
    </article>
  );
}
