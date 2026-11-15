/**
 * "How the agent works": the LangChain Deep Agent behind every audit, what it decides,
 * what it never decides, and how it measures doorways from a Matterport scan.
 * Keep this in step with services/api/app/agents/orchestrator.py.
 */

const SUBAGENTS = [
  {
    name: "Property investigator",
    source: "CoStar",
    tools: ["get_property_record"],
    job: "Looks up the property record: use type, year built, surface parking count and which Matterport scans are linked.",
  },
  {
    name: "Exterior inspector",
    source: "Vexcel, USGS fallback",
    tools: ["fetch_aerial_image"],
    job: "Fetches the aerial image. Sponsor imagery first, a clearly labelled public image second. People count stalls on it.",
  },
  {
    name: "Interior inspector",
    source: "Matterport",
    tools: ["list_linked_scans", "load_interior_scan", "measure_doorways"],
    job: "Compares every linked scan, picks one with a floor plan (public areas first), loads it and measures its doorway openings.",
  },
];

function Tool({ name }: { name: string }) {
  return <code className="whitespace-nowrap border border-line bg-concrete px-1.5 py-0.5 text-[0.85rem]">{name}</code>;
}

export function AgentExplainer() {
  return (
    <section id="agent" aria-labelledby="agent-h" className="border-t border-line bg-concrete">
      <div className="mx-auto max-w-6xl space-y-10 px-5 py-16">
        <div className="max-w-[46rem]">
          <p className="font-display text-2xl font-bold text-sign">Under the hood</p>
          <h2 id="agent-h" className="mt-1 font-display text-[2.6rem] font-bold leading-none">How the agent works</h2>
          <p className="mt-4 text-lg">
            Every audit is run by a <strong>LangChain Deep Agent</strong>, built with the <code>deepagents</code> library
            on LangGraph. Claude is the model that does the reasoning, connected through LangChain. One orchestrator
            plans the audit and hands the work to three subagents, each with its own instructions and tools.
          </p>
        </div>

        {/* The graph: orchestrator, three subagents, then the rule engine (not AI) */}
        <ol className="grid gap-px border border-line bg-line" aria-label="How one audit flows through the agent">
          <li className="bg-sheet p-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">1. Orchestrator (Deep Agent)</p>
            <p className="mt-2">
              Writes the plan you see on the audit page, then delegates with the Deep Agents <Tool name="task" /> tool.
              The three subagents can run at the same time.
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5 text-sm"><Tool name="make_plan" /><Tool name="task" /></p>
          </li>
          <li className="grid gap-px bg-line md:grid-cols-3">
            {SUBAGENTS.map((s) => (
              <div key={s.name} className="bg-sheet p-5">
                <p className="text-sm font-semibold uppercase tracking-wide text-muted">2. Subagent · {s.source}</p>
                <h3 className="mt-1 font-display text-[1.5rem] font-bold leading-none">{s.name}</h3>
                <p className="mt-2 text-[0.95rem]">{s.job}</p>
                <p className="mt-3 flex flex-wrap gap-1.5 text-sm">{s.tools.map((t) => <Tool key={t} name={t} />)}</p>
              </div>
            ))}
          </li>
          <li className="bg-sheet p-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">3. Orchestrator again</p>
            <p className="mt-2">
              Checks that the scan and the record describe the same building, then calls the rule engine.
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5 text-sm"><Tool name="cross_check_identity" /><Tool name="run_ada_checks" /></p>
          </li>
          <li className="bg-ink p-5 text-sheet">
            <p className="text-sm font-semibold uppercase tracking-wide opacity-80">4. Rule engine (plain Python, no AI)</p>
            <p className="mt-2">
              Compares each measurement with the 2010 ADA Standards and creates every result. It is covered by tests,
              and it is the only part of Unstuck that decides below threshold, suspected or needs measurement.
            </p>
          </li>
          <li className="bg-sheet p-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">5. Orchestrator writes the summary</p>
            <p className="mt-2">
              A short summary for the owner. If it uses words like “compliant”, “violation” or “certified”, the
              <Tool name="finish" /> tool sends it back to be rewritten.
            </p>
          </li>
        </ol>

        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="font-display text-[1.8rem] font-bold leading-none">How it measures doorways</h3>
            <p className="mt-3">
              When Matterport has drawn a floor plan for a scan, each doorway is stored as an opening in a wall, with a
              width. The interior inspector reads every one, and the code (not the model) converts it to inches.
            </p>
            <p className="mt-3">
              That width is the <strong>frame opening</strong>. The ADA rule (§404.2.3) is about <strong>clear width</strong> with
              the door open 90°, and that is always narrower, because the door and its stops take up part of the gap. So
              the rule engine treats a scan opening like this:
            </p>
            <ul className="mt-3 space-y-2">
              <li className="border-l-4 border-suspect pl-3">
                <strong>Under 31 in: suspected below threshold.</strong> The clear width cannot be wider than the
                opening, so it is very likely under 32 in. We allow 1 in for drawing error. That margin is our choice,
                not a Matterport specification.
              </li>
              <li className="border-l-4 border-review pl-3">
                <strong>31 in or wider: needs measurement.</strong> The door could still be too narrow once it is open,
                so a scan never passes a door.
              </li>
              <li className="border-l-4 border-line pl-3">
                <strong>Under 20 in: a scan error</strong>, not a real doorway. Someone checks that spot in the tour.
              </li>
            </ul>
            <p className="mt-3 text-[0.95rem] text-muted">
              Many scans have no floor plan: 32 of 80 linked scans we sampled had doorways. When a scan has none, the
              agent says so and the door checks wait for a person. A clear width measured by hand in the tour or on site
              always replaces the scan&apos;s opening.
            </p>
          </div>

          <div>
            <h3 className="font-display text-[1.8rem] font-bold leading-none">What the AI decides, and what it never does</h3>
            <div className="mt-3 grid gap-px border border-line bg-line sm:grid-cols-2">
              <div className="bg-sheet p-4">
                <p className="font-semibold">The agent decides</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.95rem]">
                  <li>The plan and the order of steps</li>
                  <li>What to ask each subagent for</li>
                  <li>Which linked 3D scan to load</li>
                  <li>What to do when a source fails</li>
                  <li>The wording of the summary</li>
                </ul>
              </div>
              <div className="bg-sheet p-4">
                <p className="font-semibold">The agent never</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.95rem]">
                  <li>Computes, estimates or makes up a number</li>
                  <li>Creates a result: only the rule engine does</li>
                  <li>Loads a scan not linked to the property</li>
                  <li>Calls a door wide enough from a scan</li>
                  <li>Makes a legal or compliance call</li>
                </ul>
              </div>
            </div>
            <h3 className="mt-8 font-display text-[1.5rem] font-bold leading-none">Guardrails</h3>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[0.95rem]">
              <li>If a tool fails, the error goes back to the agent so it can carry on. A failed tool never stops the audit.</li>
              <li>Limits: 80 steps for the orchestrator, 8 model calls for each subagent and 5 minutes per audit.</li>
              <li>
                If the Deep Agent fails anyway, a fixed scripted pipeline with no AI runs the same steps, and the audit
                page says so.
              </li>
              <li>Every model call, including the subagents&apos;, is counted in the token use shown on the audit page.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
