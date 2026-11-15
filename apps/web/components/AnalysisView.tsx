"use client";

import { useEffect, useRef, useState } from "react";
import { AgentExplainer } from "@/components/AgentExplainer";
import { placeLabel } from "@/components/FindingCard";
import { buildStops, RouteReplay } from "@/components/RouteReplay";
import { StatusBadge } from "@/components/ui";
import { STATUS, type AgentEvent, type Audit, type FindingStatus } from "@/lib/api";

type Tab = "overview" | "steps" | "trip" | "ai" | "tech";
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "What was found and how" },
  { id: "steps", label: "Agent steps", hint: "Every step, in order" },
  { id: "trip", label: "Trip replay", hint: "The route a visitor takes" },
  { id: "ai", label: "AI review", hint: "Gemini image suggestions" },
  { id: "tech", label: "Technical details", hint: "IDs, engine, architecture" },
];
const ACTOR: Record<string, string> = {
  orchestrator: "Orchestrator", property_investigator: "Property investigator", exterior_inspector: "Exterior inspector",
  interior_inspector: "Interior inspector", rules_evaluator: "Rule engine", rule_engine: "Rule engine", reviewer: "Reviewer",
};
const STEP: Record<string, string> = {
  PLANNED: "Planned", FETCH_STARTED: "Requested", FETCH_SUCCESS: "Received", FETCH_FAILURE: "Failed", SOURCE_MISSING: "Not available",
  OBSERVATION_PROPOSED: "Proposed", RULE_EVALUATED: "Checked", REVIEW_REQUESTED: "Needs a person", FINDING_APPROVED: "Approved",
  REPORT_READY: "Report ready", AGENT_NOTE: "Note",
};
/** Pipeline stages in the order they run, with the actor that does each. */
const STAGES = [
  { name: "Property record", actor: "property_investigator" }, { name: "Aerial imagery", actor: "exterior_inspector" },
  { name: "3D scan", actor: "interior_inspector" }, { name: "ADA checks", actor: "rules_evaluator" },
];
const bad = (e: AgentEvent) => e.type === "FETCH_FAILURE" || !!e.error_class;
const human = (s: string) => { const t = s.replaceAll("_", " ").toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
/** "Clear door width at X: SUSPECTED_VISUAL_BARRIER." -> text plus a status the badge can show. */
const ruleResult = (summary: string) => {
  const m = summary.match(/^(.*): ([A-Z_]+)\.$/);
  return m && m[2] in STATUS ? { text: m[1], status: m[2] as FindingStatus } : { text: summary, status: null };
};
/** Any stray enum in an event summary becomes its plain label. */
const plain = (s: string) => s
  .replace(/\b[A-Z]+(?:_[A-Z]+)+\b/g, (k) => (k in STATUS ? STATUS[k as FindingStatus].text : human(k)))
  .replace(/\b(UNKNOWN|MISMATCH|CONSISTENT)\b/g, (k) => k.toLowerCase());

export const engineLabel = (a: Audit) =>
  a.engine === "deep_agent" ? "Deep Agents" : a.usage?.length ? "Scripted (agent fell back)" : "Scripted pipeline";

function stageState(events: AgentEvent[], actor: string) {
  const mine = events.filter((e) => e.actor === actor || (actor === "rules_evaluator" && e.actor === "rule_engine"));
  if (mine.some(bad)) return { tone: "fail", label: "Failed" };
  if (mine.some((e) => e.type === "FETCH_SUCCESS" || e.type === "RULE_EVALUATED")) return { tone: "ok", label: "Done" };
  if (mine.some((e) => e.type === "SOURCE_MISSING")) return { tone: "miss", label: "Not available" };
  return { tone: "idle", label: "Not run" };
}

function Steps({ events }: { events: AgentEvent[] }) {
  const [problems, setProblems] = useState(false);
  const shown = problems ? events.filter((e) => bad(e) || e.type === "SOURCE_MISSING" || e.type === "REVIEW_REQUESTED") : events;
  // Fold each run of rule checks into one expandable row so 30 checks don't bury the data steps.
  const rows: (AgentEvent | AgentEvent[])[] = [];
  for (const e of shown) {
    const last = rows[rows.length - 1];
    if (e.type === "RULE_EVALUATED" && Array.isArray(last)) last.push(e);
    else rows.push(e.type === "RULE_EVALUATED" ? [e] : e);
  }
  return (
    <>
      <div className="av-toolbar">
        <div className="av-seg" role="group" aria-label="Show steps">
          <button type="button" aria-pressed={!problems} onClick={() => setProblems(false)}>All steps <span>{events.length}</span></button>
          <button type="button" aria-pressed={problems} onClick={() => setProblems(true)}>Needs attention</button>
        </div>
      </div>
      <ol className="av-steps">
        {rows.map((r) => {
          if (!Array.isArray(r)) {
            return (
              <li key={r.seq} className={`av-step ${bad(r) ? "fail" : r.type === "SOURCE_MISSING" ? "miss" : ""}`}>
                <span className="av-step-n">{r.seq}</span>
                <div className="av-step-body">
                  <p className="av-step-head"><strong>{ACTOR[r.actor] ?? human(r.actor)}</strong><em>{STEP[r.type] ?? human(r.type)}</em>
                    {r.tool && <code>{r.tool}</code>}</p>
                  <p>{plain(r.summary)}{r.error_class ? ` (${r.error_class})` : ""}</p>
                </div>
                <time>{r.latency_ms != null ? `${r.latency_ms} ms` : new Date(r.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
              </li>
            );
          }
          const counts = new Map<string, number>();
          r.forEach((e) => { const s = ruleResult(e.summary).status; if (s) counts.set(STATUS[s].text, (counts.get(STATUS[s].text) ?? 0) + 1); });
          return (
            <li key={r[0].seq} className="av-step">
              <span className="av-step-n">{r[0].seq}</span>
              <details className="av-step-body">
                <summary className="av-step-head"><strong>Rule engine</strong><em>Ran {r.length} ADA check{r.length === 1 ? "" : "s"}</em>
                  <span className="av-step-counts">{[...counts].map(([k, n]) => `${n} ${k.toLowerCase()}`).join(" · ")}</span>
                  {/* Summary lines (such as how scan doorways were sorted) stay readable without opening the list. */}
                  {r.filter((e) => !ruleResult(e.summary).status).map((e) => <span key={`n${e.seq}`} className="av-step-note">{plain(e.summary)}</span>)}
                </summary>
                <ul className="av-rules">
                  {r.filter((e) => ruleResult(e.summary).status).map((e) => { const x = ruleResult(e.summary); return (
                    <li key={e.seq}><span>{placeLabel(x.text)}</span>{x.status && <StatusBadge status={x.status} />}</li>
                  ); })}
                </ul>
              </details>
              <time>{new Date(r[0].timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
            </li>
          );
        })}
        {rows.length === 0 && <li className="av-empty">{problems ? "Nothing needs attention." : "No steps recorded."}</li>}
      </ol>
    </>
  );
}

/** Full-screen view of how an audit was produced: the engine, every step, the trip, AI suggestions and raw details. */
export function AnalysisView({ audit, events, onClose, onOpenFinding }: {
  audit: Audit; events: AgentEvent[]; onClose: () => void; onOpenFinding: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const f = audit.findings;
  const n = (t: (x: (typeof f)[number]) => boolean) => f.filter(t).length;
  const runs = audit.evidence.filter((e) => e.geometry?.ai);
  const failures = events.filter(bad).length;
  const deep = audit.engine === "deep_agent";

  return (
    <div className="av" role="dialog" aria-modal="true" aria-labelledby="av-title">
      <nav className="av-nav" aria-label="Analysis sections">
        <div className="av-nav-head">
          <h2 id="av-title">Analysis and evidence</h2>
          <p>{audit.property.name}</p>
        </div>
        <div role="tablist" aria-orientation="vertical">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} aria-controls="av-panel" onClick={() => setTab(t.id)}>
              <strong>{t.label}</strong><span>{t.hint}</span>
            </button>
          ))}
        </div>
        <p className={`av-engine ${deep ? "ok" : ""}`}>
          <strong>Engine: {engineLabel(audit)}</strong>
          {deep ? "LangChain Deep Agents planned this audit and chose each tool call." : "No AI model planned this audit. The fixed pipeline ran the same steps in order."}
        </p>
        <button ref={closeRef} type="button" className="btn btn-sm av-back" onClick={onClose}>Back to workspace</button>
      </nav>

      <div id="av-panel" role="tabpanel" className="av-panel">
        <div className="av-inner">
          <header className="av-title"><h3>{TABS.find((t) => t.id === tab)!.label}</h3></header>

          {tab === "overview" && (
            <>
              <dl className="av-stats">
                <div><dt>Checks run</dt><dd>{f.length}</dd></div>
                <div className={n((x) => x.status === "NUMERIC_SCREEN_FAIL") ? "fail" : ""}><dt>Below minimum</dt><dd>{n((x) => x.status === "NUMERIC_SCREEN_FAIL")}</dd></div>
                <div className="review"><dt>Need a site check</dt><dd>{n((x) => x.label !== "measured")}</dd></div>
                <div><dt>Verified measurements</dt><dd>{n((x) => x.label === "measured")}</dd></div>
              </dl>
              <p className="av-note">Verified measurements are values a person recorded or a trusted source supplied. Scan frame openings
                and AI suggestions never count as verified.</p>

              <h4>How this audit ran</h4>
              <ol className="av-flow">
                {STAGES.map((s, i) => {
                  const st = stageState(events, s.actor);
                  return (
                    <li key={s.name} className={st.tone}>
                      <span className="av-flow-n">{i + 1}</span><strong>{s.name}</strong><em>{st.label}</em>
                    </li>
                  );
                })}
                <li className="idle"><span className="av-flow-n">5</span><strong>Human review</strong><em>{n((x) => x.review_status !== "NOT_REVIEWED")} of {f.length} reviewed</em></li>
              </ol>
              {failures > 0 && (
                <p className="av-note">{failures} step{failures === 1 ? "" : "s"} failed. <button type="button" className="av-link" onClick={() => setTab("steps")}>See the steps</button></p>
              )}

              {audit.narrative && <blockquote className="av-quote">{audit.narrative}<cite>Written by the AI agent. Check it against the results.</cite></blockquote>}

              <h4>Data sources</h4>
              <ul className="av-sources">
                {audit.data_availability.map((s) => (
                  <li key={s.provider} className={s.state}>
                    <p><span className={`lg-dot ${s.state}`} aria-hidden="true" /><strong>{s.provider}</strong><em>{s.state === "connected" ? "Connected" : human(s.state)}</em></p>
                    <p>{s.detail}</p>
                  </li>
                ))}
              </ul>
            </>
          )}

          {tab === "steps" && (
            <>
              {!deep && <p className="av-note av-lead">Scripted pipeline: these steps ran in a fixed order and no AI model chose them. The agent names show which part of the pipeline did the work.</p>}
              <Steps events={events} />
            </>
          )}

          {tab === "trip" && (
            <div className="av-trip stack">
              <section className="av-card">
                <RouteReplay findings={f} />
                <p className="av-note">An illustrative route, not the surveyed site layout.</p>
              </section>
              <section>
                <h4>Stops on the way in</h4>
                <ol className="av-stops">
                  {buildStops(f).map((s, i) => (
                    <li key={s.key}>
                      <span className="av-flow-n">{i + 1}</span>
                      <span className="av-stop-text"><strong>{s.finding.title}</strong><em>{placeLabel(s.finding.location)}</em></span>
                      <StatusBadge status={s.finding.status} />
                      <button type="button" className="btn btn-sm" onClick={() => onOpenFinding(s.finding.id)}>Open</button>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )}

          {tab === "ai" && (
            <>
              <p className="av-note av-lead">Gemini looks for parking features on images Unstuck is allowed to send. A suggestion only counts
                once a person accepts it. Vexcel imagery is never sent without written approval.</p>
              {runs.length === 0 ? (
                <p className="av-empty av-card">No imagery has been analyzed for this audit yet. To run Gemini, go back to the workspace and open its AI review tab.</p>
              ) : runs.map((e) => {
                const ai = e.geometry!.ai!;
                const c = ai.candidates ?? [];
                const k = (s: string) => c.filter((x) => x.status === s).length;
                return (
                  <section key={e.id} className="av-card av-run">
                    <header>
                      <strong>{e.provider} image</strong>
                      <span className={`av-pill ${ai.status}`}>{ai.status === "complete" ? "Analyzed" : human(ai.status)}</span>
                      <em>{ai.model}</em>
                    </header>
                    {ai.status === "failed" && <p className="av-note">{ai.error?.message ?? "No reason recorded."}</p>}
                    {ai.status === "complete" && c.length === 0 && <p className="av-note">No reliable detections. At this resolution Gemini could not pick out stalls or symbols with confidence, so nothing was suggested.</p>}
                    {c.length > 0 && (
                      <dl className="av-stats small">
                        <div><dt>Suggested</dt><dd>{c.length}</dd></div>
                        <div><dt>Accepted</dt><dd>{k("accepted")}</dd></div>
                        <div><dt>Rejected</dt><dd>{k("rejected")}</dd></div>
                        <div className="review"><dt>Waiting for review</dt><dd>{k("suggested")}</dd></div>
                      </dl>
                    )}
                  </section>
                );
              })}
            </>
          )}

          {tab === "tech" && (
            <div className="av-trip">
              <section className="av-card">
                <h4>Run</h4>
                <dl className="av-kv">
                  <div><dt>Audit</dt><dd><code>{audit.id}</code></dd></div>
                  <div><dt>Engine</dt><dd><code>{audit.engine}</code></dd></div>
                  <div><dt>Standard</dt><dd><code>{audit.standard_profile}</code></dd></div>
                  <div><dt>Started</dt><dd>{new Date(audit.started_at).toLocaleString()}</dd></div>
                  <div><dt>Evidence items</dt><dd>{audit.evidence.length}</dd></div>
                  <div><dt>Recorded measurements</dt><dd>{audit.measurements?.length ?? 0}</dd></div>
                  <div><dt>Steps logged</dt><dd>{events.length}</dd></div>
                </dl>
                {audit.usage?.map((u) => (
                  <p key={u.model} className="av-note">{u.model}: {u.requests} requests, {u.output_tokens.toLocaleString()} output tokens.</p>
                ))}
              </section>
              <section className="av-card"><h4>How the Deep Agent is built</h4><AgentExplainer /></section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
