"use client";

import Link from "next/link";
import { RouteReplay } from "@/components/RouteReplay";
import { useEffect, useState } from "react";
import { placeLabel } from "@/components/FindingCard";
import { builtBeforeAda, ErrorNote, PreAdaNote, StatusBadge, SyntheticBanner } from "@/components/ui";
import { API, CONFIDENCE, getAudit, type Audit, type Finding, isScanEstimate } from "@/lib/api";

const GROUPS: { id: string; title: string; blurb: string; tone: string; pick: (f: Finding) => boolean }[] = [
  { id: "act", title: "Act on", tone: "fail", blurb: "A trusted measurement is under the numeric minimum. Confirm on site, then plan the fix with a qualified professional.",
    pick: (f) => f.status === "NUMERIC_SCREEN_FAIL" },
  { id: "verify", title: "Verify", tone: "review", blurb: "No trusted measurement yet. These cannot be called either way until someone measures.",
    pick: (f) => f.label !== "measured" },
  { id: "passed", title: "Passed a check", tone: "pass", blurb: "Meets the one dimension checked. This is not overall compliance.",
    pick: (f) => f.status === "NUMERIC_SCREEN_PASS" },
];

const fmt = (v: { value: number; unit: string } | null) => (v ? `${v.value} ${v.value === 1 ? v.unit.replace(/spaces$/, "space") : v.unit}` : "not recorded");
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "");

function FindingDetail({ f, audit }: { f: Finding; audit: Audit }) {
  const prefix = f.rule_id.startsWith("ADA_2010_208") ? "parking_" : "door_";
  const measured = (audit.measurements ?? []).filter((m) => m.location_id === f.location_id && m.name.startsWith(prefix));
  const evidence = audit.evidence.filter((e) => f.evidence_ids.includes(e.id));
  return (
    <li className="rp-finding" id={f.id}>
      <div className="rp-finding-head">
        <h3>{f.title}<span>{placeLabel(f.location)}</span></h3>
        <StatusBadge status={f.status} />
      </div>
      <dl className="rp-grid">
        <div><dt>Requirement</dt><dd>{f.required ? `At least ${fmt(f.required)}` : "Not determined"}</dd></div>
        {f.observed?.method === "scan_floorplan"
          ? <div><dt>Frame opening (scan)</dt><dd>{fmt(f.observed)}. Clear width not verified</dd></div>
          : isScanEstimate(f)
            ? <div><dt>Estimated from the scan</dt><dd>{fmt(f.observed)}. Accepted by a person, not measured</dd></div>
            : <div><dt>Observed</dt><dd>{fmt(f.observed)}</dd></div>}
        <div><dt>Basis</dt><dd>{CONFIDENCE[f.confidence] ?? f.confidence}</dd></div>
        <div><dt>Review</dt><dd>{f.review_status.replaceAll("_", " ").toLowerCase()}{f.reviewed_by ? ` by ${f.reviewed_by}` : ""}</dd></div>
      </dl>
      <p><strong>Next step:</strong> {f.followup}</p>
      {measured.length > 0 && (
        <div className="rp-sub">
          <h4>Measurements</h4>
          <ul>
            {measured.map((m) => (
              <li key={m.id}>
                {m.name.replace(prefix, "").replaceAll("_", " ")}: {m.value} {m.unit}, {m.method === "scan_mesh" ? "scan estimate" : m.method.replace("_", " ")}
                {m.reviewed_by ? ` by ${m.reviewed_by}` : ""}, {day(m.recorded_at)}{m.notes ? `. ${m.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="rp-meta">
        {f.citation}.{evidence.length > 0 && ` Evidence: ${evidence.map((e) => `${e.provider} ${e.asset_type.replace("_", " ")}`).join(", ")}.`}
        {f.reviewed_at && ` Reviewed ${day(f.reviewed_at)}${f.review_note ? `: ${f.review_note}` : ""}.`}
      </p>
    </li>
  );
}

export function ReportClient({ id }: { id: string }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAudit(id).then(setAudit).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div className="rp"><ErrorNote message={error} /></div>;
  if (!audit) return <p role="status" className="rp text-muted">Loading the action plan…</p>;
  const aiRuns = audit.evidence.filter((e) => e.geometry?.ai);

  return (
    <article className="rp">
      <div className="rp-actions no-print">
        <Link className="btn btn-sm" href={`/audits/${id}`}>Back to inspection</Link>
        <Link className="btn btn-sm" href={`/audits/${id}/checklist`}>Field checklist</Link>
        <a className="btn btn-sm" href={`${API}/api/audits/${id}/export`} target="_blank" rel="noreferrer">Download JSON</a>
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>

      <div className="rp-body">
        <div className="rp-main">
          <header>
            <p className="rp-kicker">Action plan</p>
            <h1>{audit.property.name}</h1>
            <p className="rp-sub-head">
              {[audit.property.address ?? "Address not recorded", audit.id, new Date(audit.started_at).toLocaleDateString()].join(" · ")}
            </p>
          </header>
          {audit.is_synthetic && <SyntheticBanner />}
          {builtBeforeAda(audit.property.year_built) && <PreAdaNote year={audit.property.year_built} />}

          <section className="rp-outcome" aria-label="Outcome">
            {GROUPS.map((g) => {
              const items = audit.findings.filter(g.pick);
              return (
                <div key={g.id} className={`rp-col ${g.tone}`}>
                  <p className="rp-col-head"><b>{items.length}</b>{g.title}</p>
                  <p className="rp-col-blurb">{g.blurb}</p>
                  {Object.entries(Object.groupBy(items, (f) => f.title)).map(([title, fs]) => fs!.length > 3 ? (
                    <details key={title} className="rp-col-group">
                      <summary>{title} <span>{fs!.length}</span></summary>
                      <ul>{fs!.map((f) => <li key={f.id}><a href={`#${f.id}`}>{placeLabel(f.location)}</a></li>)}</ul>
                    </details>
                  ) : (
                    <ul key={title}>{fs!.map((f) => <li key={f.id}><a href={`#${f.id}`}>{f.title}, {placeLabel(f.location)}</a></li>)}</ul>
                  ))}
                </div>
              );
            })}
          </section>

          {GROUPS.map((g) => {
            const items = audit.findings.filter(g.pick);
            return items.length === 0 ? null : (
              <section key={g.id} className="rp-group">
                <h2 className={g.tone}>{g.title}</h2>
                <ul>{items.map((f) => <FindingDetail key={f.id} f={f} audit={audit} />)}</ul>
              </section>
            );
          })}
        </div>

        <section className="rp-side" aria-label="About this report">
          <section className="rp-note">
            <h3>What this is</h3>
            <p>A screening of selected dimensions from the 2010 ADA Standards, with the evidence behind each check. Not a certified
              inspection or a legal compliance determination, and not a substitute for a CASp, RAS or qualified consultant. Whether a
              rule applies to this building, and state rules such as California Title 24, were not evaluated.</p>
          </section>
          <section>
            <h3>Getting it fixed</h3>
            <p>This report is the first step. A typical path from here, which varies by city and by the size of the job:</p>
            <ol className="rp-steps">
              <li><strong>Measure.</strong> Tape-measure doors, routes and stall counts on site. For slopes or grade, hire a licensed surveyor: they know what grade the site is at and what it needs to be.</li>
              <li><strong>Permit.</strong> Most fixes need a building permit. A grading permit applies only if earth is moved. Every city defines these permits differently, so check with your local building department.</li>
              <li><strong>Contractor.</strong> For a small fix, one trade (for example striping, doors or concrete) is usually enough. A general contractor coordinates jobs with several phases, such as grading plus concrete plus electrical.</li>
            </ol>
          </section>
          <section>
            <h3>AI image review</h3>
            {aiRuns.length === 0 ? <p>No imagery was analyzed with Gemini for this audit.</p> : (
              <ul>
                {aiRuns.map((e) => {
                  const ai = e.geometry!.ai!;
                  const c = ai.candidates ?? [];
                  const n = (s: string) => c.filter((x) => x.status === s).length;
                  const counted = (e.geometry?.pins ?? []).filter((p) => p.candidate_id).length;
                  return (
                    <li key={e.id}>
                      {e.provider} image, {ai.status === "complete" ? `analyzed with ${ai.model}` : `analysis ${ai.status}`}.{" "}
                      {ai.status === "failed" ? `${ai.error?.message ?? "No reason recorded."}${c.length ? ` ${c.length} earlier suggestion(s) kept.` : ""}`
                        : ai.status !== "complete" ? "Not finished."
                        : c.length === 0 ? "No reliable detections." : `${c.length} suggestion${c.length === 1 ? "" : "s"}: ${n("accepted")} accepted, ${n("rejected")} rejected, ${n("suggested")} not reviewed.`}
                      {counted > 0 && ` ${counted} accepted stall(s) counted by ${e.geometry?.pins_by}.`}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="rp-fine">Suggestions are not measurements. Only stalls a person accepted and counted affect the parking checks. Vexcel imagery is not sent to AI services.</p>
          </section>
          <section>
            <h3>Cost and tax</h3>
            <p>No cost estimates: there are no sourced price assumptions for this property. Federal programs for barrier removal
              (IRC §44 credit, §190 deduction) depend on eligibility; discuss them with an accountant.</p>
          </section>
          <section>
            <h3>Sources</h3>
            <ul>
              {audit.evidence.length === 0 && <li>No imagery or model was retrieved.</li>}
              {audit.evidence.map((e) => (
                <li key={e.id}>{e.provider} {e.asset_type.replace("_", " ")}, captured {e.capture_date ?? "on an unknown date"}. {e.rights}.</li>
              ))}
              {audit.data_availability.filter((s) => s.state === "unavailable").map((s) => <li key={s.provider}>{s.provider}: unavailable.</li>)}
            </ul>
          </section>
        </section>
      </div>
      <section id="trip-replay" className="mt-10 border-t border-line pt-8" aria-labelledby="trip-replay-heading">
        <h2 id="trip-replay-heading" className="font-display text-[1.9rem] font-bold leading-none">The trip in</h2>
        <p className="mb-4 mt-2 text-muted">Experience the checks in the order a wheelchair user encounters them. This is an illustrative route, not the surveyed site layout.</p>
        <RouteReplay findings={audit.findings} />
      </section>
    </article>
  );
}
