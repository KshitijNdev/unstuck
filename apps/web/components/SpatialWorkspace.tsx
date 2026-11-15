"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { FindingCard, placeLabel } from "@/components/FindingCard";
import { aerialSources, layerOf, SpatialStage, type Layer } from "@/components/SpatialStage";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { RouteReplay } from "@/components/RouteReplay";
import { rovingKeys, StatusBadge } from "@/components/ui";
import { acceptScanEstimates, getSources, startAnalysis, TRIAGE, type Audit, type Finding, feetInches, doorwayNumber, isScanEstimate } from "@/lib/api";
import { useReviewer } from "@/lib/reviewer";

type Filter = "all" | "below" | "review" | "meets" | "doors";
const FILTERS: { id: Filter; label: string; test: (f: Finding) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "below", label: "Below minimum", test: (f) => f.status === "NUMERIC_SCREEN_FAIL" },
  { id: "review", label: "Needs review", test: (f) => f.label !== "measured" },
  { id: "meets", label: "Meets", test: (f) => f.status === "NUMERIC_SCREEN_PASS" },
  // Scan doorways worth a tape measure: everything the scan could not show to be comfortably wide.
  { id: "doors", label: "Doors to measure", test: (f) => !!f.observed?.triage && f.observed.triage !== "likely_wide" },
];
type Tab = "checks" | "suggestions" | "log" | "trip";
const NARROW = "(max-width: 900px)";  // matches spatial.css: below this the inspector stacks under the stage

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
type Group = "type" | "floor" | "scan" | "review";
const REVIEW: Record<Finding["review_status"], string> = {
  NOT_REVIEWED: "Not reviewed", APPROVED: "Reviewed", REJECTED: "Rejected", NEEDS_FIELD_VISIT: "Needs a field visit",
};
/** The bucket a finding falls in for each grouping. Exported for tests. */
export function groupKey(f: Finding, by: Group, audit: Audit): string {
  if (by === "type") return f.title;
  if (by === "review") return REVIEW[f.review_status] ?? f.review_status;
  if (by === "floor") return f.location.match(/Floor [^,(]+/)?.[0].trim() ?? "Site, parking and entrance";
  const model = audit.property.doors.find((d) => d.id === f.location_id)?.model_id;
  return model ? `Matterport scan ${model}` : "Not from a scan";
}
const INSET = 440 + 16 * 2;  // floating inspector width plus its margins; the wide view covers the stage, so it keeps this inset

export function SpatialWorkspace({ audit, auditId, selected, onSelect, onChanged, log }: {
  audit: Audit; auditId: string; selected: Finding | null; onSelect: (id: string) => void;
  onChanged: () => Promise<void>; log: React.ReactNode;
}) {
  const [layer, setLayer] = useState<Layer>("aerial");
  const [vexcelAiAllowed, setVexcelAiAllowed] = useState(false);
  useEffect(() => {
    getSources().then((s) => setVexcelAiAllowed(!!s.vexcel_ai_allowed)).catch(() => {});
  }, []);
  const narrow = useNarrow();
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<Tab>("checks");
  const [group, setGroup] = useState<Group>("type");
  const [order, setOrder] = useState<"urgent" | "walk">("urgent");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [wide, setWide] = useState(false);
  const [aerialId, setAerialId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [askPublic, setAskPublic] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The workspace only renders after the audit loads in the browser, so localStorage is available here.
  const [reviewer, setReviewer] = useReviewer();
  const openRef = useRef<HTMLLIElement>(null);
  const lastSelected = useRef<string | null>(null);

  const sources = aerialSources(audit);
  const site = sources.find((e) => e.id === aerialId) ?? sources[0];
  const run = site?.geometry?.ai;
  const running = audit.evidence.some((e) => e.geometry?.ai?.status === "running");
  const pending = (run?.candidates ?? []).filter((c) => c.status === "suggested").length;
  const visible = audit.findings.filter(FILTERS.find((f) => f.id === filter)!.test);
  const count = (t: (f: Finding) => boolean) => audit.findings.filter(t).length;
  const band = (...names: string[]) => count((f) => names.includes(f.observed?.triage ?? ""));
  const doorBands = { first: band("narrow", "likely_narrow"), either: band("measure"), wide: band("likely_wide"),
    total: band("narrow", "likely_narrow", "measure", "likely_wide"),
    mesh: count((f) => f.observed?.mesh_gap_in != null), offers: count((f) => f.observed?.accept_clear_in != null) };
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  async function acceptEstimates(e: React.FormEvent) {
    e.preventDefault();
    setAccepting(true);
    setAcceptError(null);
    try { await acceptScanEstimates(auditId, reviewer); await onChanged(); }
    catch (err) { setAcceptError((err as Error).message); }
    finally { setAccepting(false); }
  }
  // Walking order: scan doorways by their number, which follows the floor plan, so neighbours sit together.
  const listed = order === "walk"
    ? [...visible].sort((a, b) => (doorwayNumber(a.location) ?? -1) - (doorwayNumber(b.location) ?? -1))
    : visible;
  const groups = new Map<string, Finding[]>();
  for (const f of listed) { const k = groupKey(f, group, audit); groups.set(k, [...(groups.get(k) ?? []), f]); }
  const toggle = (k: string) => setClosed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Poll only while Gemini is working; the run writes its progress to the audit.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void onChanged(); }, 1500);
    return () => clearInterval(t);
  }, [running, onChanged]);

  useEffect(() => {
    const li = openRef.current;
    // Scroll only when the selection changes after the page opened, so the counts stay in view on load (and the
    // effect running twice in development does not count as a change).
    if (lastSelected.current !== null && lastSelected.current !== selected?.id) li?.scrollIntoView({ block: "start", behavior: "smooth" });  // start, not nearest: a tall card would otherwise show only its bottom
    lastSelected.current = selected?.id ?? null;
  }, [selected?.id]);

  const choose = (f: Finding) => {
    onSelect(f.id);
    setClosed((c) => { const k = groupKey(f, group, audit); if (!c.has(k)) return c; const n = new Set(c); n.delete(k); return n; });
    setFocusId(null);
    setLayer(layerOf(f) === "interior" && !audit.evidence.some((e) => e.asset_type === "tour") ? "aerial" : layerOf(f));
  };

  const focusCandidate = (id: string | null) => {
    setFocusId(id);
    if (id) { setLayer("aerial"); setTab("suggestions"); }
  };

  async function analyze(usePublic: boolean) {
    setAskPublic(false);
    setAiError(null);
    try {
      const r = await startAnalysis(auditId, usePublic ? { use_public_imagery: true } : { evidence_id: site?.id });
      setAerialId(r.evidence_id);
      setFocusId(null);
      setTab("suggestions");
      await onChanged();
    } catch (e) {
      setAiError((e as Error).message);
      setTab("suggestions");
    }
  }

  const canAnalyze = site?.asset_type === "aerial_image" && !site.is_synthetic;
  // Vexcel AI analysis only when the operator sets VEXCEL_ALLOW_AI_PROCESSING=1; the server enforces it either way.
  const blocked = site?.provider === "Vexcel" && !vexcelAiAllowed;
  const progress = run?.status === "running" ? run.progress : null;
  const analyzeControl = (
    <div className="st-analyze">
      {progress ? (
        <div className="st-progress" role="status" aria-live="polite">
          <span className="st-spin" aria-hidden="true" />
          {progress.done === 0 && progress.view.startsWith("fetch") ? "Fetching image" : `Analyzing ${progress.view}`}
          <span className="st-progress-bar"><span style={{ width: `${(progress.done / (progress.total || 1)) * 100}%` }} /></span>
        </div>
      ) : pending > 0 ? (
        <button type="button" className="st-tool primary" onClick={() => setTab("suggestions")}>
          Review {pending} suggestion{pending === 1 ? "" : "s"}
        </button>
      ) : (
        <button type="button" className={`st-tool ${run?.status === "complete" ? "" : "primary"}`} disabled={!canAnalyze || running}
          title={canAnalyze ? "Find candidate accessible-parking features with Gemini" : "Only real aerial imagery can be analyzed"}
          onClick={() => (blocked ? setAskPublic(!askPublic) : analyze(false))} aria-expanded={blocked ? askPublic : undefined}>
          {run?.status === "complete" ? "Analyze again" : "Analyze parking"}
        </button>
      )}
      {askPublic && (
        <div className="st-pop" role="dialog" aria-label="Vexcel imagery can’t be analyzed">
          <p>Vexcel imagery isn’t cleared for third-party AI analysis on this server, so Unstuck won’t send it.</p>
          <p>Analyze the public USGS image of the same site instead? Suggestions stay attached to that image.</p>
          <div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => analyze(true)}>Analyze public image</button>
            <button type="button" className="btn btn-sm" onClick={() => setAskPublic(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "checks", label: "Findings", badge: audit.findings.length },
    { id: "suggestions", label: "AI review", badge: pending || undefined },
    { id: "log", label: "Agent activity" },
    { id: "trip", label: "Trip" },
  ];

  return (
    <section id="workspace" aria-label="Inspection workspace" className="sw-grid no-print">
      <SpatialStage audit={audit} auditId={auditId} selected={selected} layer={layer} setLayer={setLayer}
        onSelect={(id) => { const f = audit.findings.find((x) => x.id === id); if (f) { choose(f); setTab("checks"); } }}
        onChanged={onChanged} aerialId={site?.id ?? null} setAerialId={setAerialId}
        focusId={focusId} onFocus={focusCandidate} analysis={analyzeControl} inset={narrow ? 0 : INSET} />

      <aside className={`sw-panel ${wide && tab === "checks" ? "wide" : ""}`} aria-label="Inspector">
        <div className="sw-tabs" role="tablist" aria-label="Inspector" onKeyDown={rovingKeys("tab")}>
          {tabs.map((t) => (
            <button key={t.id} id={`sw-tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`sw-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>
              {t.label}{t.badge != null && <span className="sw-badge">{t.badge}</span>}
            </button>
          ))}
        </div>

        <div id="sw-checks" role="tabpanel" aria-labelledby="sw-tab-checks" hidden={tab !== "checks"} className="sw-tabpanel">
          <div className="sw-tally" aria-label="Result summary">
            <span className={count(FILTERS[1].test) ? "bad" : ""}><b>{count(FILTERS[1].test)}</b>below minimum</span>
            <span><b>{count(FILTERS[2].test)}</b>need review</span>
            <span title="Values a person recorded or a trusted source supplied. Scan frame openings, accepted scan estimates and AI suggestions are not counted.">
              <b>{count((f) => f.label === "measured" && !isScanEstimate(f))}</b>verified measurements</span>
            {count(isScanEstimate) > 0 && (
              <span title="Doorways screened on a scan dimension that a person accepted. Nobody measured these doors.">
                <b>{count(isScanEstimate)}</b>accepted estimates</span>
            )}
          </div>
          {doorBands.total > 0 && (
            <div className="sw-triage">
              <p>
                <strong>{doorBands.total} scan doorways sorted by width.</strong>{" "}
                {doorBands.first} to measure first, {doorBands.either} could go either way, {doorBands.wide} likely wide
                enough.{" "}
                {doorBands.mesh > 0
                  ? `The scan's 3D mesh confirmed ${doorBands.mesh} of the openings.`
                  : "Estimates from the floor plan."}{" "}
                None is passed until a person measures or accepts it.
              </p>
              {doorBands.offers > 0 && (
                <form onSubmit={acceptEstimates}>
                  <label>Your name
                    <input required maxLength={80} value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
                  </label>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={accepting}>
                    Accept {doorBands.offers} scan {doorBands.offers === 1 ? "estimate" : "estimates"}
                  </button>
                  <p>
                    Records the scan&apos;s lower-bound clear width for the {doorBands.offers} mesh-confirmed wide{" "}
                    {doorBands.offers === 1 ? "doorway" : "doorways"} under your name, in place of measuring each one.
                  </p>
                </form>
              )}
              {acceptError && <p role="alert" className="sw-triage-bad">{acceptError}</p>}
            </div>
          )}
          <div className="sw-filters" role="group" aria-label="Filter checks">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span>{count(f.test)}</span>
              </button>
            ))}
          </div>
          <div className="sw-groupbar">
            <label>Group by{" "}
              <select value={group} onChange={(e) => { setGroup(e.target.value as Group); setClosed(new Set()); }}>
                <option value="type">Issue type</option><option value="floor">Floor</option>
                <option value="scan">Scan</option><option value="review">Review status</option>
              </select>
            </label>
            <label>Order{" "}
              <select value={order} onChange={(e) => setOrder(e.target.value as "urgent" | "walk")}>
                <option value="urgent">Most urgent first</option><option value="walk">Walking order</option>
              </select>
            </label>
            <button type="button" className="sw-wide-btn" aria-pressed={wide} onClick={() => setWide(!wide)}>
              {wide ? "Back to map" : "Expand list"}
            </button>
          </div>
          <div className="sw-body">
          <div className="sw-list">
            {[...groups].map(([k, items]) => (
              <section key={k} className="sw-group">
                <button type="button" className="sw-group-head" aria-expanded={!closed.has(k)} onClick={() => toggle(k)}>
                  <span>{k}</span><em>{items.length}</em>
                  {items.some((f) => f.status === "NUMERIC_SCREEN_FAIL") && <i className="bad">{items.filter((f) => f.status === "NUMERIC_SCREEN_FAIL").length} below</i>}
                </button>
                {!closed.has(k) && (
                  <ul>
                    {items.map((f) => {
                      const index = audit.findings.indexOf(f) + 1;
                      const on = selected?.id === f.id;
                      return (
                        <li key={f.id} ref={on ? openRef : undefined} className={on ? "open" : ""}>
                          {(!on || wide) && (
                            <button type="button" className={`sw-row ${on ? "on" : ""}`} aria-current={on || undefined} onClick={() => choose(f)}>
                              <span className="sw-num">{index}</span>
                              <span className="sw-row-text"><strong>{f.title}</strong>
                                <span>{placeLabel(f.location)}{f.observed?.triage ? ` · ${feetInches(f.observed.value)} opening · ${TRIAGE[f.observed.triage]}` : ""}</span></span>
                              <StatusBadge status={f.status} />
                            </button>
                          )}
                          {on && !wide && (
                            <motion.ul className="sw-card" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                              <FindingCard finding={f} auditId={auditId} selected onSelect={() => choose(f)} onChanged={onChanged} />
                            </motion.ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
            {visible.length === 0 && audit.findings.length > 0 && <p className="sw-none">No checks match this filter.</p>}
            {audit.findings.length === 0 && <p className="sw-none">No checks were evaluated. The audit found no usable evidence.</p>}
          </div>
          {wide && selected && (
            <ul className="sw-card sw-detail">
              <FindingCard finding={selected} auditId={auditId} selected onSelect={() => {}} onChanged={onChanged} />
            </ul>
          )}
          </div>
        </div>

        <div id="sw-suggestions" role="tabpanel" aria-labelledby="sw-tab-suggestions" hidden={tab !== "suggestions"} className="sw-tabpanel">
          <SuggestionsPanel auditId={auditId} site={site} run={run} reviewer={reviewer} setReviewer={setReviewer}
            focusId={focusId} onFocus={focusCandidate} onChanged={onChanged} error={aiError}
            analyze={canAnalyze && !running ? (blocked ? (
              <>
                <p>This Vexcel imagery isn’t cleared for third-party AI analysis on this server. The public USGS image of the same site can be analyzed instead.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => analyze(true)}>Analyze public image</button>
              </>
            ) : <button type="button" className="btn btn-primary btn-sm" onClick={() => analyze(false)}>Analyze parking</button>) : null} />
        </div>

        <div id="sw-log" role="tabpanel" aria-labelledby="sw-tab-log" tabIndex={0} hidden={tab !== "log"} className="sw-tabpanel sw-log">{log}</div>

        <div id="sw-trip" role="tabpanel" aria-labelledby="sw-tab-trip" hidden={tab !== "trip"} className="sw-tabpanel">
          {/* Mounted only while open so the replay starts from the kerb each time. */}
          {tab === "trip" && <RouteReplay findings={audit.findings} compact />}
        </div>
      </aside>
    </section>
  );
}
