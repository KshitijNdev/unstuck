"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SpatialWorkspace } from "@/components/SpatialWorkspace";
import { IntegrationsPanel } from "@/components/IntegrationsPanel";
import { builtBeforeAda, ErrorNote } from "@/components/ui";
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

const human = (s: string) => {
  const t = s.replaceAll("_", " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function Timeline({ events, running }: { events: AgentEvent[]; running: boolean }) {
  return (
    <ol aria-live="polite" className="space-y-3 text-[0.95rem]">
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
  const [showIg, setShowIg] = useState(false);
  const igRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showIg) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowIg(false); };
    const onDown = (e: MouseEvent) => { if (!igRef.current?.contains(e.target as Node)) setShowIg(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [showIg]);

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

  const plan = (
    <>
      <p className="lg-sub">
        {!audit
          ? "Loading the plan…"
          : audit.engine === "deep_agent"
            ? "LangChain Deep Agents plan the audit and delegate property, exterior, and interior checks. ADA thresholds come from the deterministic rule engine."
            : audit.usage?.length
              ? "The Deep Agent did not finish; the scripted pipeline completed the checks. Results use the deterministic rule engine."
              : "Scripted pipeline: fixed steps, no AI model involved. Results use the deterministic rule engine."}
      </p>
      <ol className="lg-plan">
        {(audit?.plan ?? []).map((p, i) => <li key={p}><span>{i + 1}</span>{p}</li>)}
      </ol>
    </>
  );

  if (!done) {
    return (
      <div className="wrap au-running">
        {error && <ErrorNote message={error} />}
        <p className="text-[0.95rem] text-muted"><Link href="/" className="underline underline-offset-2">Start</Link> / Audit {id}</p>
        <h1>{audit?.property.name ?? "Loading audit…"}</h1>
        <p className="flex items-center gap-2 text-muted" role="status">
          <span className="inline-block size-2 animate-pulse rounded-full bg-sign" aria-hidden="true" /> Gathering evidence
        </p>
        <div className="au-running-grid">
          <section><h2>Plan</h2>{plan}</section>
          <section><h2>Activity</h2><Timeline events={events} running /></section>
        </div>
      </div>
    );
  }

  const log = audit && (
    <div className="lg">
      {audit.narrative && (
        <figure className="lg-quote">
          <blockquote>{audit.narrative}</blockquote>
          <figcaption>Summary written by the AI agent. Check it against the results.</figcaption>
        </figure>
      )}
      <section><h3>Plan</h3>{plan}</section>
      <section><h3>Activity</h3><Timeline events={events} running={false} /></section>
      <section>
        <h3>Data sources</h3>
        <ul className="lg-sources">
          {audit.data_availability.map((s) => (
            <li key={s.provider}>
              <span className={`lg-dot ${s.state}`} aria-hidden="true" />
              <strong>{s.provider}</strong> <span>{s.state}</span>
              <p>{s.detail}</p>
            </li>
          ))}
        </ul>
      </section>
      {audit.usage?.length > 0 && (
        <section>
          <h3>AI use</h3>
          {audit.usage.map((u) => {
            const input = u.input_tokens + u.cache_write_tokens + u.cache_read_tokens;
            return (
              <p key={u.model} className="lg-sub" title={u.price_note ?? undefined}>
                {u.model}: {u.requests} requests, {input.toLocaleString()} input and {u.output_tokens.toLocaleString()} output tokens
                {u.est_cost_usd != null ? `, about $${u.est_cost_usd.toFixed(3)} at list price` : ""}.
              </p>
            );
          })}
        </section>
      )}
    </div>
  );

  return (
    <div className="app-view">
      <header className="au-bar">
        <Link href="/" className="au-home" aria-label="Unstuck home, start another screening">unstuck</Link>
        <div className="au-id">
          <h1>{audit?.property.name}</h1>
          <p>
            {[audit?.property.address ?? "Address not recorded", audit?.property.type, audit?.property.year_built && `built ${audit.property.year_built}`]
              .filter(Boolean).join(", ")}
          </p>
        </div>
        <div className="au-actions">
          {audit?.is_synthetic && <span className="au-chip" title="This property does not exist and no value was observed at a real building.">Synthetic demo data</span>}
          {audit?.status === "FAILED" && <span className="au-chip bad">Audit stopped early</span>}
          {builtBeforeAda(audit?.property.year_built) && (
            <span className="au-chip ctx" title="Context only, not a finding. Details are on the Property record layer and in the action plan.">
              Context: built before the ADA
            </span>
          )}
          <div className="au-ig" ref={igRef}>
            <button type="button" className="btn btn-sm" aria-expanded={showIg} aria-controls="au-ig-panel" onClick={() => setShowIg(!showIg)}>
              Integrations &amp; AI
            </button>
            {showIg && audit && (
              <div id="au-ig-panel" className="au-ig-panel" role="dialog" aria-label="Integrations and AI status">
                <IntegrationsPanel audit={audit} />
              </div>
            )}
          </div>
          <Link className="btn btn-sm" href={`/audits/${id}/report`}>Action plan</Link>
        </div>
      </header>
      {error && <div className="au-err"><ErrorNote message={error} /></div>}
      {audit && (
        <SpatialWorkspace audit={audit} auditId={id} selected={selected ?? audit.findings[0] ?? null}
          onSelect={setSelectedId} onChanged={refresh} log={log} />
      )}
    </div>
  );
}
