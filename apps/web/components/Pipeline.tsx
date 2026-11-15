"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AgentExplainer } from "@/components/AgentExplainer";
import { getSources, type Integration } from "@/lib/api";

type Stage = {
  id: string; name: string; providers: Integration["provider"][];
  does: string; limits: string; agents?: [string, string][]; callout?: { title: string; body: string };
};

/** The real pipeline, in order. Keep in step with services/api/app/agents/orchestrator.py and the rules engine. */
const STAGES: Stage[] = [
  { id: "record", name: "CoStar record", providers: ["costar"],
    does: "Reads the property record: use type, year built, surface-space count and which Matterport scans are linked.",
    limits: "Hackathon extract for Houston and Los Angeles. A missing field stays unknown; nothing is guessed.",
    agents: [["Property investigator", "get_property_record"]] },
  { id: "evidence", name: "Vexcel and Matterport", providers: ["vexcel", "matterport"],
    does: "Fetches the aerial orthophoto (about 7.5 cm per pixel) and loads a linked 3D scan with its floor plan.",
    limits: "Vexcel imagery is never sent to an AI service without written approval. The public USGS image is used for AI instead.",
    agents: [["Exterior inspector", "fetch_aerial_image"], ["Interior inspector", "list_linked_scans · load_interior_scan · measure_doorways"]],
    callout: { title: "Frame opening is not clear door width",
      body: "The scan’s floor plan gives the opening between door frames. Clear door width is measured with the door open 90°, from the face of the door to the opposite stop, so it is narrower. Scan widths flag doorways to check; a hand measurement decides." } },
  { id: "ai", name: "Gemini and Deep Agents", providers: ["claude", "gemini"],
    does: "A LangChain Deep Agent plans each audit and delegates to three sub-agents. Gemini suggests parking features on permitted imagery.",
    limits: "Models plan and suggest. They never decide a check, and every suggestion waits for a person to accept it.",
    agents: [["Orchestrator", "plans, delegates, writes the summary"], ["Vision", "Gemini candidates on permitted imagery"]] },
  { id: "rules", name: "ADA checks", providers: [],
    does: "Tested rules apply the 2010 ADA Standards: Table 208.2 stall counts, §404.2.3 clear width and §403.5.1 route width.",
    limits: "Only trusted measurements reach a verdict. Readings within half an inch of a minimum go back for a tape measure." },
  { id: "review", name: "Human review", providers: [],
    does: "A person confirms stalls, records measurements and marks findings reviewed. The report shows who did what, with the evidence.",
    limits: "Screening, not certification. Applicability, exceptions and state rules need a qualified professional." },
];

const NAME: Record<Integration["provider"], string> = { costar: "CoStar", vexcel: "Vexcel", matterport: "Matterport", gemini: "Gemini", claude: "Deep Agents" };
const STATE: Record<Integration["state"], string> = { verified: "Verified", configured: "Configured", failed: "Check failed", unavailable: "Unavailable" };

export function Pipeline() {
  const [rows, setRows] = useState<Integration[] | null>(null);
  const [active, setActive] = useState(0);
  const [details, setDetails] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => { getSources().then((r) => setRows(r.integrations)).catch(() => setRows(null)); }, []);
  const stage = STAGES[active];
  const state = (p: Integration["provider"]) => rows?.find((r) => r.provider === p);

  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (active + d + STAGES.length) % STAGES.length;
    setActive(n);
    tabs.current[n]?.focus();
  };

  return (
    <div className="pl">
      <header className="pl-head">
        <p className="lx-card-kicker">7  AI and evidence</p>
        <h2>From a property record to a reviewed finding.</h2>
      </header>

      <div className="pl-track" role="tablist" aria-label="Pipeline stages" onKeyDown={onKey}>
        {STAGES.map((s, i) => (
          <button key={s.id} ref={(el) => { tabs.current[i] = el; }} role="tab" type="button" aria-selected={i === active}
            aria-controls="pl-panel" tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)} className="pl-node">
            <span className="pl-step">{i + 1}</span>
            <strong>{s.name}</strong>
            <span className="pl-states">
              {s.providers.length === 0 ? <em>Built in</em> : s.providers.map((p) => {
                const r = state(p);
                return <em key={p} className={r?.state ?? "unknown"}>{NAME[p]}: {r ? STATE[r.state] : "…"}</em>;
              })}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={stage.id} id="pl-panel" role="tabpanel" className="pl-panel"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
          <div>
            <h3>What it does</h3>
            <p>{stage.does}</p>
            <h3>Limits</h3>
            <p>{stage.limits}</p>
          </div>
          <div>
            {stage.agents && (
              <>
                <h3>Agents and tools</h3>
                <ul className="pl-agents">{stage.agents.map(([a, t]) => <li key={a}><strong>{a}</strong><code>{t}</code></li>)}</ul>
              </>
            )}
            {stage.callout && <div className="pl-callout"><strong>{stage.callout.title}</strong><p>{stage.callout.body}</p></div>}
            {stage.id === "ai" && (
              <p className="pl-note">
                {state("claude")?.state === "unavailable"
                  ? "No Anthropic key is set on this server, so audits run the same steps on the scripted pipeline. Every tool call still appears in Agent activity."
                  : "Every tool call, with its timing, appears in the audit’s Agent activity tab and trip replay."}
              </p>
            )}
            {!stage.agents && !stage.callout && <p className="pl-note">Results open in the inspection workspace and the action plan, each with its source, method and reviewer.</p>}
          </div>
        </motion.div>
      </AnimatePresence>

      {stage.id === "ai" && (
        <>
          <button type="button" className="pl-more" aria-expanded={details} onClick={() => setDetails(!details)}>
            {details ? "Hide technical details" : "Technical details: how the Deep Agent is built"}
          </button>
          {details && <div className="pl-details"><AgentExplainer /></div>}
        </>
      )}
    </div>
  );
}
