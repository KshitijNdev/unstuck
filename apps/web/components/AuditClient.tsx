"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EvidenceView } from "@/components/EvidenceView";
import { FindingCard } from "@/components/FindingCard";
import { CoverageCards, ErrorNote, SyntheticBanner } from "@/components/ui";
import { API, getAudit, type AgentEvent, type Audit } from "@/lib/api";

const EVENT_ICON: Record<string, string> = {
  PLANNED: "☰", FETCH_STARTED: "→", FETCH_SUCCESS: "✓", FETCH_FAILURE: "✕", SOURCE_MISSING: "○",
  OBSERVATION_PROPOSED: "✎", RULE_EVALUATED: "=", REVIEW_REQUESTED: "◌", FINDING_APPROVED: "✓", REPORT_READY: "★",
  AGENT_NOTE: "❝",
};

function Timeline({ events, running }: { events: AgentEvent[]; running: boolean }) {
  return (
    <ol aria-live="polite" className="max-h-96 space-y-2 overflow-y-auto pr-2 text-sm">
      {events.map((e) => (
        <li key={e.seq} className="grid grid-cols-[1.5rem_1fr] gap-2">
          <span aria-hidden="true" className="text-center font-mono">{EVENT_ICON[e.type] ?? "·"}</span>
          <div>
            <p>
              <span className="font-semibold">{e.actor.replaceAll("_", " ")}</span>{" "}
              <span className="font-mono text-xs text-muted">{e.type}{e.tool ? ` · ${e.tool}` : ""}{e.retry_count ? ` · retry ${e.retry_count}` : ""}{e.latency_ms != null ? ` · ${e.latency_ms} ms` : ""}</span>
            </p>
            <p className="text-muted">{e.summary}</p>
          </div>
        </li>
      ))}
      {running && <li className="pl-8 text-muted">Working…</li>}
    </ol>
  );
}

export function AuditClient({ id }: { id: string }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const a = await getAudit(id);
      setAudit(a);
      setEvents(a.events);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    const source = new EventSource(`${API}/api/audits/${id}/events`);
    source.addEventListener("agent_event", (msg) => {
      const e: AgentEvent = JSON.parse((msg as MessageEvent).data);
      setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e]));
    });
    source.addEventListener("done", () => { source.close(); refresh(); });
    source.onerror = () => { source.close(); refresh(); };
    return () => source.close();
  }, [id, refresh]);

  const done = audit?.status === "COMPLETE" || audit?.status === "FAILED";
  const selected = audit?.findings.find((f) => f.id === selectedId) ?? null;
  const counts = audit
    ? { measured: audit.findings.filter((f) => f.label === "measured").length,
        suspected: audit.findings.filter((f) => f.label === "suspected").length,
        review: audit.findings.filter((f) => f.label === "review needed").length }
    : null;

  return (
    <div className="space-y-8">
      {error && <ErrorNote message={error} />}

      <section>
        <p className="text-sm text-muted"><Link href="/" className="underline">Start</Link> / Audit {id}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{audit?.property.name ?? "Screening…"}</h1>
        {audit && (
          <p className="mt-1 text-muted">
            {audit.property.address ?? "No address"} · Use type: {audit.property.type ?? "Unknown"} · Year built:{" "}
            {audit.property.year_built ?? "Unknown"}
          </p>
        )}
        {audit?.is_synthetic && <div className="mt-3"><SyntheticBanner /></div>}
      </section>

      <section aria-labelledby="act-h" className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-line bg-card p-4">
          <h2 id="act-h" className="font-display text-xl font-semibold">Activity</h2>
          <p className="mb-3 text-xs text-muted">
            {audit?.engine === "claude_agent"
              ? "A Claude agent chose these steps and tool calls. Check results come from the rule engine, not the model."
              : "Scripted pipeline: fixed steps, no AI model involved."}
          </p>
          <Timeline events={events} running={!done} />
        </div>
        <div className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-display text-xl font-semibold">Plan</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {(audit?.plan ?? []).map((p) => <li key={p}>{p}</li>)}
          </ol>
          {done && audit?.narrative && (
            <figure className="mt-4 rounded-xl border border-line p-3 text-sm">
              <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted">Agent summary · written by AI, check against the results below</figcaption>
              <blockquote className="mt-1">{audit.narrative}</blockquote>
            </figure>
          )}
          {done && audit && audit.usage?.length > 0 && (
            <div className="mt-3 text-xs text-muted">
              {audit.usage.map((u) => {
                const input = u.input_tokens + u.cache_write_tokens + u.cache_read_tokens;
                return (
                  <p key={u.model} title={u.price_note ?? undefined}>
                    AI usage ({u.model}): {u.requests} requests · {input.toLocaleString()} input tokens
                    ({u.cache_read_tokens.toLocaleString()} cached) · {u.output_tokens.toLocaleString()} output tokens
                    {u.est_cost_usd != null ? ` · about $${u.est_cost_usd.toFixed(3)} at list price` : " · no price on file"}
                  </p>
                );
              })}
            </div>
          )}
          {done && counts && (
            <p className="mt-4 rounded-xl bg-paper p-3 text-sm">
              <strong>{audit!.findings.length} checks:</strong> {counts.measured} measured, {counts.suspected} suspected,{" "}
              {counts.review} need review.{" "}
              <Link className="font-semibold underline" href={`/audits/${id}/report`}>Open the action plan</Link>
            </p>
          )}
        </div>
      </section>

      {done && audit && (
        <>
          <section aria-labelledby="cov-h">
            <h2 id="cov-h" className="font-display text-xl font-semibold">Data coverage for this audit</h2>
            <div className="mt-3"><CoverageCards sources={audit.data_availability} /></div>
          </section>

          <section aria-labelledby="ev-h">
            <h2 id="ev-h" className="font-display text-xl font-semibold">Evidence</h2>
            <p className="mb-3 text-sm text-muted">
              {selected ? `Showing: ${selected.title} at ${selected.location}.` : "Choose “Show evidence” on a check below."}
            </p>
            <EvidenceView evidence={audit.evidence} selected={selected} auditId={id} onChanged={refresh} />
          </section>

          <section aria-labelledby="find-h">
            <h2 id="find-h" className="font-display text-xl font-semibold">Checks</h2>
            <ul className="mt-3 space-y-3">
              {audit.findings.map((f) => (
                <FindingCard key={f.id} finding={f} auditId={id} selected={f.id === selectedId}
                  onSelect={() => { setSelectedId(f.id); document.getElementById("ev-h")?.scrollIntoView({ block: "start" }); }}
                  onChanged={refresh} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
