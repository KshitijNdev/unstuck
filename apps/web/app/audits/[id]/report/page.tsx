"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAudit(id).then(setAudit).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <ErrorNote message={error} />;
  if (!audit) return <p className="text-muted">Loading report…</p>;

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <div className="no-print flex flex-wrap gap-2">
        <Link className="btn btn-sm" href={`/audits/${id}`}>Back to audit</Link>
        <button className="btn btn-sm btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
        <a className="btn btn-sm" href={`${API}/api/audits/${id}/export`} target="_blank" rel="noreferrer">Download JSON</a>
      </div>

      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Accessibility screening action plan</p>
        <h1 className="font-display text-3xl font-semibold">{audit.property.name}</h1>
        <p className="text-muted">{audit.property.address ?? "No address"} · Audit {audit.id} · started {audit.started_at}</p>
      </header>

      {audit.is_synthetic && <SyntheticBanner />}

      <p className="rounded-xl border border-ink p-3 text-sm">
        <strong>What this is.</strong> A screening of selected dimensions from the 2010 ADA Standards, with the evidence
        behind each check. It is not a certified inspection or a legal compliance determination, and does not replace a
        CASp, RAS or qualified accessibility consultant. Whether a rule applies to this building, and state rules such as
        California Title 24, were not evaluated.
      </p>

      {GROUPS.map((g) => {
        const items = audit.findings.filter(g.pick);
        return (
          <section key={g.title}>
            <h2 className="font-display text-xl font-semibold">{g.title}</h2>
            <p className="text-sm text-muted">{g.blurb}</p>
            {items.length === 0 ? <p className="mt-2 text-sm">Nothing in this group.</p> : (
              <ul className="mt-2 space-y-2">
                {items.map((f) => (
                  <li key={f.id} className="rounded-xl border border-line bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{f.title} · {f.location}</strong>
                      <StatusBadge status={f.status} />
                    </div>
                    <p className="mt-1">
                      Requirement: {f.required ? `≥ ${f.required.value} ${f.required.unit}` : "not determined"} · Observed:{" "}
                      {f.observed ? `${f.observed.value} ${f.observed.unit}` : "unknown"} · {CONFIDENCE[f.confidence] ?? f.confidence}
                    </p>
                    <p className="mt-1"><strong>Next step:</strong> {f.followup}</p>
                    <p className="mt-1 text-xs text-muted">{f.citation} · review: {f.review_status.replaceAll("_", " ").toLowerCase()}{f.reviewed_by ? ` by ${f.reviewed_by}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section>
        <h2 className="font-display text-xl font-semibold">Cost and tax</h2>
        <p className="text-sm text-muted">
          No cost estimates are shown: there are no sourced price assumptions for this property yet. Federal programs
          that may apply to barrier removal (IRC §44 credit, IRC §190 deduction) depend on eligibility; discuss them with
          an accountant.
        </p>
      </section>

      <section>
        <h2 className="font-display text-xl font-semibold">Sources used</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
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
