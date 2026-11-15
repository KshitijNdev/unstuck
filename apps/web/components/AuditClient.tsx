"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EvidenceView } from "@/components/EvidenceView";
import { FindingCard } from "@/components/FindingCard";
import { RouteReplay } from "@/components/RouteReplay";
import { CoverageCards, ErrorNote, SyntheticBanner } from "@/components/ui";
import { API, getAudit, type AgentEvent, type Audit } from "@/lib/api";

const EVENT_ICON: Record<string, string> = {
  PLANNED: "☰", FETCH_STARTED: "→", FETCH_SUCCESS: "✓", FETCH_FAILURE: "✕", SOURCE_MISSING: "○",
  OBSERVATION_PROPOSED: "✎", RULE_EVALUATED: "=", REVIEW_REQUESTED: "◌", FINDING_APPROVED: "✓", REPORT_READY: "★",
  AGENT_NOTE: "❝",
};
const EVENT_TONE: Record<string, string> = {
  FETCH_SUCCESS: "text-pass", FINDING_APPROVED: "text-pass", FETCH_FAILURE: "text-fail",
  REVIEW_REQUESTED: "text-review", REPORT_READY: "text-sign",
};

// Scan doorways that only need measuring are folded away so the list stays readable; suspected ones stay on top.
const folded = (f: Audit["findings"][number]) =>
  f.location_id.startsWith("scan_door_") && f.review_status === "NOT_REVIEWED" &&
  (f.status === "FIELD_VERIFICATION_REQUIRED" || f.status === "INSUFFICIENT_DATA") &&
  (f.confidence === "SCAN_FLOORPLAN" || f.confidence === "NO_MEASUREMENT");

const human = (s: string) => {
  const t = s.replaceAll("_", " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function Timeline({ events, running }: { events: AgentEvent[]; running: boolean }) {
  return (
    <ol aria-live="polite" className="max-h-[26rem] space-y-3 overflow-y-auto pr-2 text-[0.95rem]">
      <AnimatePresence initial={false}>
        {events.map((e) => (
          <motion.li
            key={e.seq}
            layout="position"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="grid grid-cols-[1.5rem_1fr] gap-2"
          >
            <span aria-hidden="true" className={`text-center font-semibold ${EVENT_TONE[e.type] ?? "text-muted"}`}>
              {EVENT_ICON[e.type] ?? "•"}
            </span>
            <div>
              <p className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="font-semibold">{human(e.actor)}</span>
                <span className="text-sm text-muted">{human(e.type)}</span>
                {e.tool && <span className="text-sm text-muted">{e.tool}</span>}
                {e.retry_count > 0 && <span className="text-sm text-review">retry {e.retry_count}</span>}
                {e.latency_ms != null && <span className="text-sm text-muted">{e.latency_ms} ms</span>}
              </p>
              <p className="text-muted">{e.summary}</p>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
      {running && (
        <li className="flex items-center gap-2 pl-8 text-muted">
          <motion.span
            aria-hidden="true"
            className="inline-block size-2 rounded-full bg-sign"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          Working
        </li>
      )}
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

  // Load the saved audit first. A finished audit shows its results at once;
  // the live stream is only opened while the audit is still running.
  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    (async () => {
      let after = 0;
      try {
        const a = await getAudit(id);
        if (cancelled) return;
        setAudit(a);
        setEvents(a.events);
        if (a.status === "COMPLETE" || a.status === "FAILED") return;
        after = a.events.length;
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        return;
      }
      source = new EventSource(`${API}/api/audits/${id}/events?after=${after}`);
      source.addEventListener("agent_event", (msg) => {
        const e: AgentEvent = JSON.parse((msg as MessageEvent).data);
        setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e]));
      });
      source.addEventListener("done", () => { source?.close(); refresh(); });
      source.onerror = () => { source?.close(); refresh(); };
    })();
    return () => { cancelled = true; source?.close(); };
  }, [id, refresh]);

  const done = audit?.status === "COMPLETE" || audit?.status === "FAILED";
  const selected = audit?.findings.find((f) => f.id === selectedId) ?? null;
  const counts = audit
    ? { measured: audit.findings.filter((f) => f.label === "measured").length,
        suspected: audit.findings.filter((f) => f.label === "suspected").length,
        review: audit.findings.filter((f) => f.label === "review needed").length,
        below: audit.findings.filter((f) => f.status === "NUMERIC_SCREEN_FAIL").length }
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-12 px-5 py-10">
      {error && <ErrorNote message={error} />}

      <section>
        <p className="text-[0.95rem] text-muted">
          <Link href="/" className="underline underline-offset-2">Start</Link>
          <span aria-hidden="true"> / </span>
          Audit {id}
        </p>
        <h1 className="mt-2 font-display text-[2.8rem] font-bold leading-none sm:text-[3.4rem]">
          {audit?.property.name ?? "Screening"}
        </h1>
        {audit && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            <div><dt className="text-sm text-muted">Address</dt><dd className="font-medium">{audit.property.address ?? "Not recorded"}</dd></div>
            <div><dt className="text-sm text-muted">Use type</dt><dd className="font-medium">{audit.property.type ?? "Unknown"}</dd></div>
            <div><dt className="text-sm text-muted">Year built</dt><dd className="font-medium">{audit.property.year_built ?? "Unknown"}</dd></div>
          </dl>
        )}
        {audit?.is_synthetic && <div className="mt-5"><SyntheticBanner /></div>}
      </section>

      <section aria-labelledby="act-h" className="grid gap-px border border-line bg-line lg:grid-cols-[1fr_1.15fr]">
        <div className="bg-sheet p-5">
          <h2 id="act-h" className="font-display text-[1.8rem] font-bold leading-none">Plan</h2>
          <p className="mt-2 text-[0.95rem] text-muted">
            {!audit ? "Loading the plan…"
              : audit.engine === "deep_agent"
              ? `A LangChain Deep Agent${audit.usage?.[0]?.model ? ` (${audit.usage[0].model})` : ""} wrote this plan and delegated the work to its property, exterior and interior subagents. Every check result comes from the tested rule engine, not the model.`
              : audit.usage?.length
              ? "The Deep Agent stopped partway, so a fixed scripted pipeline finished the audit. Every check result comes from the rule engine."
              : "Scripted pipeline: fixed steps, no AI model involved. Every check result comes from the rule engine."}
          </p>
          <ol className="mt-4 space-y-2">
            <AnimatePresence initial={false}>
              {(audit?.plan ?? []).map((p, i) => (
                <motion.li key={p} className="grid grid-cols-[1.75rem_1fr] gap-1"
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <span className="font-display text-lg font-bold text-sign">{i + 1}</span>
                  <span>{p}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>

          <AnimatePresence>
            {done && audit?.narrative && (
              <motion.figure key="summary" className="mt-6 border-l-4 border-ink pl-4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <blockquote className="text-[1.05rem]">{audit.narrative}</blockquote>
                <figcaption className="mt-2 text-sm text-muted">Summary written by the AI agent. Check it against the results below.</figcaption>
              </motion.figure>
            )}
          </AnimatePresence>

          {done && counts && (
            <motion.div className="mt-6 flex flex-wrap items-center justify-between gap-4 bg-concrete p-4"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <p>
                <strong>{audit!.findings.length} checks.</strong>{" "}
                {counts.below > 0 && <span className="font-semibold text-fail">{counts.below} below threshold. </span>}
                {counts.measured} measured, {counts.suspected} suspected, {counts.review} need review.
              </p>
              <Link className="btn btn-primary btn-sm" href={`/audits/${id}/report`}>Open the action plan</Link>
            </motion.div>
          )}

          {done && audit && audit.usage?.length > 0 && (
            <div className="mt-4 space-y-1 text-sm text-muted">
              {audit.usage.map((u) => {
                const input = u.input_tokens + u.cache_write_tokens + u.cache_read_tokens;
                return (
                  <p key={u.model} title={u.price_note ?? undefined}>
                    AI use ({u.model}): {u.requests} requests, {input.toLocaleString()} input tokens
                    ({u.cache_read_tokens.toLocaleString()} cached), {u.output_tokens.toLocaleString()} output tokens
                    {u.est_cost_usd != null ? `, about $${u.est_cost_usd.toFixed(3)} at list price` : ", no price on file"}.
                  </p>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-sheet p-5">
          <h2 className="font-display text-[1.8rem] font-bold leading-none">Activity</h2>
          <p className="mb-4 mt-2 text-[0.95rem] text-muted">Every step and tool call, as it happens.</p>
          <Timeline events={events} running={!done} />
        </div>
      </section>

      {done && audit && (
        <>
          <section aria-labelledby="trip-h">
            <h2 id="trip-h" className="font-display text-[2.2rem] font-bold leading-none">The trip in</h2>
            <p className="mb-4 mt-2 text-muted">The same checks, in the order a wheelchair user meets them.</p>
            <RouteReplay findings={audit.findings} />
          </section>

          <section aria-labelledby="ev-h">
            <h2 id="ev-h" className="font-display text-[2.2rem] font-bold leading-none">Evidence</h2>
            <p className="mb-4 mt-2 text-muted">
              {selected ? `Showing ${selected.title.toLowerCase()} at ${selected.location}.` : "Choose “Show evidence” on a check to point at it here."}
            </p>
            <EvidenceView evidence={audit.evidence} selected={selected} auditId={id} onChanged={refresh} />
          </section>

          <section aria-labelledby="find-h">
            <h2 id="find-h" className="font-display text-[2.2rem] font-bold leading-none">Checks</h2>
            <p className="mt-2 text-muted">Most urgent first. Each one compares a single measurement with one threshold.</p>
            <ul className="mt-5 space-y-4">
              {audit.findings.filter((f) => !folded(f)).map((f) => (
                <FindingCard key={f.id} finding={f} auditId={id} selected={f.id === selectedId}
                  onSelect={() => { setSelectedId(f.id); document.getElementById("ev-h")?.scrollIntoView({ block: "start" }); }}
                  onChanged={refresh} />
              ))}
            </ul>
            {audit.findings.some(folded) && (
              <details className="mt-4 sheet p-4">
                <summary className="cursor-pointer font-semibold">
                  {audit.findings.filter(folded).length} more doorways from the scan need a measurement
                </summary>
                <p className="mt-2 text-[0.95rem] text-muted">
                  Their floor-plan openings are wide enough that the clear width could meet the minimum, or the scan&apos;s
                  value is implausible. Nothing is passed from a scan: measure each one to screen it.
                </p>
                <ul className="mt-4 space-y-4">
                  {audit.findings.filter(folded).map((f) => (
                    <FindingCard key={f.id} finding={f} auditId={id} selected={f.id === selectedId}
                      onSelect={() => { setSelectedId(f.id); document.getElementById("ev-h")?.scrollIntoView({ block: "start" }); }}
                      onChanged={refresh} />
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section aria-labelledby="cov-h">
            <h2 id="cov-h" className="font-display text-[1.8rem] font-bold leading-none">Data used in this audit</h2>
            <div className="mt-4"><CoverageCards sources={audit.data_availability} /></div>
          </section>
        </>
      )}
    </div>
  );
}
