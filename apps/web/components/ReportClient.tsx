"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorNote, StatusBadge, SyntheticBanner } from "@/components/ui";
import { API, CONFIDENCE, getAudit, type Audit, type Finding } from "@/lib/api";

const GROUPS: { title: string; blurb: string; pick: (f: Finding) => boolean }[] = [
  { title: "1. Act on: measured below threshold", blurb: "A trusted measurement is under the numeric minimum. Confirm on site, then plan the fix with a qualified professional.",
    pick: (f) => f.status === "NUMERIC_SCREEN_FAIL" },
  { title: "2. Measure next", blurb: "No trusted measurement yet. These cannot be called either way until someone measures.",
    pick: (f) => f.label !== "measured" },
  { title: "3. Meets the numeric threshold", blurb: "Passes the one dimension checked. This is not overall compliance.",
    pick: (f) => f.status === "NUMERIC_SCREEN_PASS" },
];

export function ReportClient({ id }: { id: string }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAudit(id).then(setAudit).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div className="mx-auto max-w-3xl px-5 py-10"><ErrorNote message={error} /></div>;
  if (!audit) return <p className="mx-auto max-w-3xl px-5 py-10 text-muted">Loading the action plan…</p>;

  return (
    <article className="mx-auto max-w-3xl space-y-8 px-5 py-10">
      <div className="no-print flex flex-wrap gap-2">
        <Link className="btn btn-sm" href={`/audits/${id}`}>Back to audit</Link>
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
        <a className="btn btn-sm" href={`${API}/api/audits/${id}/export`} target="_blank" rel="noreferrer">Download JSON</a>
      </div>

      <header>
        <h1 className="font-display text-[2.8rem] font-bold leading-none">Action plan for {audit.property.name}</h1>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[0.95rem]">
          <div><dt className="text-sm text-muted">Address</dt><dd>{audit.property.address ?? "Not recorded"}</dd></div>
          <div><dt className="text-sm text-muted">Audit</dt><dd>{audit.id}</dd></div>
          <div><dt className="text-sm text-muted">Started</dt><dd>{new Date(audit.started_at).toLocaleString()}</dd></div>
        </dl>
      </header>

      {audit.is_synthetic && <SyntheticBanner />}

      <p className="border-l-4 border-ink bg-sheet p-4 text-[0.95rem]">
        <strong>What this is.</strong> A screening of selected dimensions from the 2010 ADA Standards, with the evidence
        behind each check. It is not a certified inspection or a legal compliance determination, and does not replace a
        CASp, RAS or qualified accessibility consultant. Whether a rule applies to this building, and state rules such as
        California Title 24, were not evaluated.
      </p>

      {GROUPS.map((g) => {
        const items = audit.findings.filter(g.pick);
        return (
          <section key={g.title}>
            <h2 className="font-display text-[1.9rem] font-bold leading-none">{g.title}</h2>
            <p className="mt-2 text-muted">{g.blurb}</p>
            {items.length === 0 ? <p className="mt-3 text-[0.95rem]">Nothing in this group.</p> : (
              <ul className="mt-3 space-y-3">
                {items.map((f) => (
                  <li key={f.id} className="sheet p-4 text-[0.95rem]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{f.title}, {f.location}</strong>
                      <StatusBadge status={f.status} />
                    </div>
                    <p className="mt-1">
                      Requirement: {f.required ? `at least ${f.required.value} ${f.required.unit}` : "not determined"}. Observed:{" "}
                      {f.observed ? `${f.observed.value} ${f.observed.unit}` : "unknown"}. {CONFIDENCE[f.confidence] ?? f.confidence}.
                    </p>
                    <p className="mt-1"><strong>Next step:</strong> {f.followup}</p>
                    <p className="mt-1 text-sm text-muted">{f.citation}. Review: {f.review_status.replaceAll("_", " ").toLowerCase()}{f.reviewed_by ? ` by ${f.reviewed_by}` : ""}.</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section>
        <h2 className="font-display text-[1.9rem] font-bold leading-none">Cost and tax</h2>
        <p className="mt-2 text-muted">
          No cost estimates are shown: there are no sourced price assumptions for this property yet. Federal programs
          that may apply to barrier removal (IRC §44 credit, IRC §190 deduction) depend on eligibility; discuss them with
          an accountant.
        </p>
      </section>

      <section>
        <h2 className="font-display text-[1.9rem] font-bold leading-none">Sources used</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[0.95rem]">
          {audit.evidence.length === 0 && <li>No imagery or model was retrieved.</li>}
          {audit.evidence.map((e) => (
            <li key={e.id}>{e.provider} ({e.asset_type.replace("_", " ")}), captured {e.capture_date ?? "unknown"}. {e.rights}.</li>
          ))}
          {audit.data_availability.filter((s) => s.state === "unavailable").map((s) => (
            <li key={s.provider}>{s.provider}: unavailable for this audit.</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
