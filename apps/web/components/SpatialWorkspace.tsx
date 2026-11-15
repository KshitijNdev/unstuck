"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { FindingCard } from "@/components/FindingCard";
import { aerialSources, layerOf, SpatialStage, type Layer } from "@/components/SpatialStage";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { rovingKeys, StatusBadge } from "@/components/ui";
import { startAnalysis, TRIAGE, type Audit, type Finding } from "@/lib/api";
import { RouteReplay } from "@/components/RouteReplay";

type Filter = "all" | "below" | "review" | "meets" | "doors";
const FILTERS: { id: Filter; label: string; test: (f: Finding) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "below", label: "Below threshold", test: (f) => f.status === "NUMERIC_SCREEN_FAIL" },
  { id: "review", label: "Needs a person", test: (f) => f.label !== "measured" },
  { id: "meets", label: "Meets", test: (f) => f.status === "NUMERIC_SCREEN_PASS" },
  // Scan doorways worth a tape measure: everything the scan could not show to be comfortably wide.
  { id: "doors", label: "Doors to measure", test: (f) => !!f.observed?.triage && f.observed.triage !== "likely_wide" },
];
type Tab = "checks" | "suggestions" | "log" | "trip";
const REVIEWER_KEY = "unstuck.reviewer";
const INSET = 440 + 16 * 2;  // floating inspector width plus its margins
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

export function SpatialWorkspace({ audit, auditId, selected, onSelect, onChanged, log }: {
  audit: Audit; auditId: string; selected: Finding | null; onSelect: (id: string) => void;
  onChanged: () => Promise<void>; log: React.ReactNode;
}) {
  const [layer, setLayer] = useState<Layer>("aerial");
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<Tab>("checks");
  const [aerialId, setAerialId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [askPublic, setAskPublic] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The workspace only renders after the audit loads in the browser, so localStorage is available here.
  const [reviewer, setReviewerState] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? "");
  const setReviewer = (v: string) => { setReviewerState(v); localStorage.setItem(REVIEWER_KEY, v); };
  const openRef = useRef<HTMLLIElement>(null);
  const narrow = useNarrow();

  const sources = aerialSources(audit);
  const site = sources.find((e) => e.id === aerialId) ?? sources[0];
  const run = site?.geometry?.ai;
  const running = audit.evidence.some((e) => e.geometry?.ai?.status === "running");
  const pending = (run?.candidates ?? []).filter((c) => c.status === "suggested").length;
  const visible = audit.findings.filter(FILTERS.find((f) => f.id === filter)!.test);
  const count = (t: (f: Finding) => boolean) => audit.findings.filter(t).length;
  const band = (...names: string[]) => count((f) => names.includes(f.observed?.triage ?? ""));
  const doorBands = { first: band("narrow", "likely_narrow"), either: band("measure"), wide: band("likely_wide"),
    total: band("narrow", "likely_narrow", "measure", "likely_wide") };

  // Poll only while Gemini is working; the run writes its progress to the audit.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void onChanged(); }, 1500);
    return () => clearInterval(t);
  }, [running, onChanged]);

  useEffect(() => {
    const li = openRef.current;
    li?.parentElement?.scrollTo({ top: li.offsetTop, behavior: "smooth" });
  }, [selected?.id]);

  const choose = (f: Finding) => {
    onSelect(f.id);
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
  const blocked = site?.provider === "Vexcel";  // the server enforces this too; asking first avoids a pointless refusal
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
          {run?.status === "complete" ? "Analyze again" : "Analyze imagery"}
        </button>
      )}
      {askPublic && (
        <div className="st-pop" role="dialog" aria-label="Vexcel imagery can’t be analyzed">
          <p>Vexcel’s hackathon terms don’t say its imagery may be sent to a third-party AI service, so Unstuck won’t send it.</p>
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
    { id: "log", label: "Activity" },
    { id: "trip", label: "Trip" },
  ];

  return (
    <section id="workspace" aria-label="Inspection workspace" className="sw-grid no-print">
      <SpatialStage audit={audit} auditId={auditId} selected={selected} layer={layer} setLayer={setLayer}
        onSelect={(id) => { const f = audit.findings.find((x) => x.id === id); if (f) { choose(f); setTab("checks"); } }}
        onChanged={onChanged} aerialId={site?.id ?? null} setAerialId={setAerialId}
        focusId={focusId} onFocus={focusCandidate} analysis={analyzeControl} inset={narrow ? 0 : INSET} />

      <section className="sw-panel" aria-labelledby="sw-h">
        <h2 id="sw-h" className="sr-only">Inspector</h2>
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
            <span className={count(FILTERS[1].test) ? "bad" : ""}><b>{count(FILTERS[1].test)}</b>below threshold</span>
            <span><b>{count(FILTERS[2].test)}</b>need a person</span>
            <span><b>{count((f) => f.label === "measured")}</b>measured</span>
          </div>
          {doorBands.total > 0 && (
            <p className="sw-triage">
              <strong>{doorBands.total} scan doorways sorted by width.</strong>{" "}
              {doorBands.first} to measure first, {doorBands.either} could go either way, {doorBands.wide} likely wide
              enough. Estimates from the floor plan; none is passed until measured.
            </p>
          )}
          <div className="sw-filters" role="group" aria-label="Filter checks">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span>{count(f.test)}</span>
              </button>
            ))}
          </div>
          <ul className="sw-list">
            {visible.map((f) => {
              const index = audit.findings.indexOf(f) + 1;
              const on = selected?.id === f.id;
              return (
                <li key={f.id} ref={on ? openRef : undefined} className={on ? "open" : ""}>
                  {!on && (
                    <button type="button" className="sw-row" onClick={() => choose(f)}>
                      <span className="sw-num">{index}</span>
                      <span className="sw-row-text">
                        <strong>{f.title}</strong>
                        <span>{f.location}{f.observed?.triage ? ` · ${TRIAGE[f.observed.triage]}` : ""}</span>
                      </span>
                      <StatusBadge status={f.status} />
                    </button>
                  )}
                  {on && (
                    <motion.ul className="sw-card" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                      <FindingCard finding={f} auditId={auditId} selected onSelect={() => choose(f)} onChanged={onChanged} />
                    </motion.ul>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && audit.findings.length > 0 && <li className="sw-none">No checks match this filter.</li>}
            {audit.findings.length === 0 && <li className="sw-none">No checks were evaluated. The audit found no usable evidence.</li>}
          </ul>
        </div>

        <div id="sw-suggestions" role="tabpanel" aria-labelledby="sw-tab-suggestions" hidden={tab !== "suggestions"} className="sw-tabpanel">
          <SuggestionsPanel auditId={auditId} site={site} run={run} reviewer={reviewer} setReviewer={setReviewer}
            focusId={focusId} onFocus={focusCandidate} onChanged={onChanged} error={aiError}
            analyze={canAnalyze && !running ? (blocked ? (
              <>
                <p>This is Vexcel imagery, which Unstuck won’t send to a third-party AI service. The public USGS image of the same site can be analyzed instead.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => analyze(true)}>Analyze public image</button>
              </>
            ) : <button type="button" className="btn btn-primary btn-sm" onClick={() => analyze(false)}>Analyze imagery</button>) : null} />
        </div>

        <div id="sw-log" role="tabpanel" aria-labelledby="sw-tab-log" tabIndex={0} hidden={tab !== "log"} className="sw-tabpanel sw-log">{log}</div>

        <div id="sw-trip" role="tabpanel" aria-labelledby="sw-tab-trip" hidden={tab !== "trip"} className="sw-tabpanel">
          {/* Mounted only while open so the replay starts from the kerb each time. */}
          {tab === "trip" && <RouteReplay findings={audit.findings} compact />}
        </div>
      </section>
    </section>
  );
}
