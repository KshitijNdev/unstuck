"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CAPTIONS, SitePlan } from "@/components/SitePlan";
import { CoverageCards, ErrorNote } from "@/components/ui";
import { createAudit, getSources, getUsage, searchProperties, type CostarHit, type SourceStatus, type UsageTotals } from "@/lib/api";

const STEPS = [
  {
    title: "Start from the record",
    body: "CoStar says what the building is: a retail centre built in 1984 with 120 surface spaces. Use type and age decide which questions matter, and the space count sets how many accessible stalls the lot needs.",
  },
  {
    title: "Count from above",
    body: "On the Vexcel aerial, you mark each stall painted for accessible parking. Table 208.2 asks for five in a lot of 101 to 150 spaces, one of them van accessible. Four are marked here, so the check comes back below threshold.",
  },
  {
    title: "Measure inside",
    body: "Open the Matterport tour at the entrance and measure the door with it open 90°. The minimum is 32 inches clear. A reading within half an inch of the line goes back for a tape measure instead of a verdict.",
  },
  {
    title: "Act on what was measured",
    body: "The action plan sorts every check into act on, measure next and meets threshold, with the source, method and reviewer behind each one. Nothing unmeasured is called a failure.",
  },
];

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [engineNote, setEngineNote] = useState("");
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CostarHit[] | null>(null);
  const [kitAvailable, setKitAvailable] = useState(true);
  const [form, setForm] = useState({ name: "", address: "", lat: "", lon: "" });

  useEffect(() => {
    getSources()
      .then((r) => { setSources(r.sources); setEngineNote(r.engine_note); })
      .catch((e: Error) => setError(e.message));
    getUsage().then(setUsage).catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      searchProperties(query)
        .then((r) => { setHits(r.properties); setKitAvailable(r.available); })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function start(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const { audit_id } = await createAudit({ standard_profile: "ADA_2010_SCREEN", ...body });
      router.push(`/audits/${audit_id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const startDemo = () => start({ property_id: "property_demo_001", allow_synthetic_fixture: true });

  function startCustom(e: React.FormEvent) {
    e.preventDefault();
    start({
      custom_property: { name: form.name, address: form.address || null, lat: Number(form.lat), lon: Number(form.lon) },
      ownership_authorized: authorized,
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      {/* Story: text scrolls on the left, the site plan stays put and follows along */}
      <section id="how" aria-label="How a screening works" className="mx-auto max-w-6xl px-5">
        <div className="grid gap-x-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="sticky top-[57px] z-10 -mx-5 bg-concrete px-5 pb-3 pt-4 lg:order-2 lg:mx-0 lg:self-start lg:px-0 lg:pt-10">
            <div className="mx-auto max-w-[28rem] border border-line bg-[#2f353b] lg:max-w-none">
              <SitePlan step={step} />
            </div>
            <p className="mt-2 hidden min-h-[3rem] text-[0.95rem] text-muted lg:block" aria-hidden="true">
              {CAPTIONS[step]}
            </p>
          </div>

          <div className="lg:order-1">
            <motion.div
              className="flex min-h-[70vh] flex-col justify-center py-12 lg:min-h-[calc(100vh-57px)]"
              onViewportEnter={() => setStep(0)}
              viewport={{ amount: 0.6 }}
            >
              <h1 className="font-display text-[3.4rem] font-bold leading-[0.95] sm:text-[4.6rem] lg:text-[5.4rem]">
                See what could keep people out of your building.
              </h1>
              <p className="mt-6 max-w-[34rem] text-lg text-muted">
                Unstuck screens a commercial property against the 2010 ADA Standards using its CoStar record, Vexcel
                aerial imagery and Matterport 3D scan. Each result shows its evidence, and anything it can&apos;t
                measure goes to a person.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#screen" className="btn btn-primary">Screen a building</a>
                <button className="btn" onClick={startDemo} disabled={busy}>Try the demo property</button>
              </div>
            </motion.div>

            <ol className="pb-[20vh]">
              {STEPS.map((s, i) => {
                const n = i + 1;
                const active = step === n;
                return (
                  <motion.li
                    key={s.title}
                    className="flex min-h-[65vh] flex-col justify-center py-10"
                    onViewportEnter={() => setStep(n)}
                    viewport={{ amount: 0.6 }}
                    initial={false}
                    animate={{ opacity: active ? 1 : 0.32 }}
                    transition={{ duration: 0.35 }}
                  >
                    <p className="font-display text-2xl font-bold text-sign">Step {n} of {STEPS.length}</p>
                    <h2 className="mt-1 font-display text-[2.6rem] font-bold leading-none">{s.title}</h2>
                    <p className="mt-4 max-w-[32rem] text-lg">{s.body}</p>
                    <p className="sr-only">{CAPTIONS[n]}</p>
                  </motion.li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      <div className="border-t border-line bg-sheet">
        <div className="mx-auto max-w-6xl space-y-14 px-5 py-16">
          {error && <ErrorNote message={error} />}

          <section id="screen" aria-labelledby="pick-h" className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
            <div>
              <h2 id="pick-h" className="font-display text-[2.6rem] font-bold leading-none">Screen a building</h2>
              <p className="mt-4 max-w-[30rem] text-muted">
                Offices, retail, industrial and other non-residential buildings in Houston and Los Angeles that have a
                CoStar record and a Matterport scan. Hackathon data, for hackathon use only.
              </p>
            </div>

            <div>
              <label className="flex items-start gap-3 border-l-4 border-sign bg-sign-wash p-4 text-[0.95rem]">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--sign)]" checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)} />
                <span>
                  I own this property, am authorized to audit it, or am using it under the hackathon data terms. Unstuck
                  is for owners and managers screening their own buildings, not for finding other people&apos;s.
                </span>
              </label>

              <label className="mt-5 block font-medium">
                Search by name, address or use type
                <input className="field mt-1.5" type="search" placeholder="Granada, Wilshire, retail" value={query}
                  onChange={(e) => setQuery(e.target.value)} />
              </label>

              {!kitAvailable && (
                <p className="mt-3 text-[0.95rem] text-muted">
                  The CoStar extract isn&apos;t loaded, so there&apos;s nothing to search. Start the demo or enter coordinates below.
                </p>
              )}
              <ul className="mt-4 border-t border-line" aria-live="polite">
                {hits?.map((h) => (
                  <li key={h.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-line-soft py-3.5">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{h.name}</p>
                      <p className="text-[0.95rem] text-muted">{[h.address, h.city].filter(Boolean).join(", ")}</p>
                      <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-sm">
                        <div className="flex gap-1.5"><dt className="text-muted">Use</dt><dd>{h.type}</dd></div>
                        <div className="flex gap-1.5"><dt className="text-muted">Built</dt><dd>{h.year_built ?? "unknown"}</dd></div>
                        <div className="flex gap-1.5"><dt className="text-muted">Surface spaces</dt><dd>{h.surface_spaces ?? "unknown"}</dd></div>
                        <div className="flex gap-1.5"><dt className="text-muted">Scans</dt><dd>{h.model_ids.length}</dd></div>
                      </dl>
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={busy || !authorized}
                      onClick={() => start({ costar_property_id: h.id, ownership_authorized: authorized })}
                      aria-label={`Screen ${h.name}`}>
                      Screen
                    </button>
                  </li>
                ))}
                {hits?.length === 0 && kitAvailable && <li className="py-3.5 text-muted">No properties match that search.</li>}
              </ul>
              {!authorized && (hits?.length ?? 0) > 0 && (
                <p className="mt-3 text-[0.95rem] text-muted">Tick the box above to start screening.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="other-h" className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
            <div>
              <h2 id="other-h" className="font-display text-[2rem] font-bold leading-none">Other ways to start</h2>
            </div>
            <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
              <div className="bg-sheet p-5">
                <h3 className="font-display text-2xl font-bold">Demo property</h3>
                <p className="mt-2 text-[0.95rem] text-muted">
                  A made-up retail centre with made-up measurements, so you can see every kind of result. It&apos;s labelled
                  synthetic everywhere it appears.
                </p>
                <button className="btn mt-5" disabled={busy} onClick={startDemo}>Start the demo screening</button>
              </div>

              <form onSubmit={startCustom} className="bg-sheet p-5">
                <h3 className="font-display text-2xl font-bold">Enter coordinates</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-[0.95rem] font-medium sm:col-span-2">
                    Property name
                    <input className="field mt-1" required maxLength={120} value={form.name} onChange={set("name")} />
                  </label>
                  <label className="text-[0.95rem] font-medium sm:col-span-2">
                    Address <span className="font-normal text-muted">(optional)</span>
                    <input className="field mt-1" maxLength={200} value={form.address} onChange={set("address")} />
                  </label>
                  <label className="text-[0.95rem] font-medium">
                    Latitude
                    <input className="field mt-1" required type="number" step="any" min={-90} max={90} value={form.lat} onChange={set("lat")} />
                  </label>
                  <label className="text-[0.95rem] font-medium">
                    Longitude
                    <input className="field mt-1" required type="number" step="any" min={-180} max={180} value={form.lon} onChange={set("lon")} />
                  </label>
                </div>
                <button className="btn mt-5" type="submit" disabled={busy || !authorized}>Start screening</button>
                {!authorized && <p className="mt-2 text-sm text-muted">Needs the authorization box above.</p>}
              </form>
            </div>
          </section>

          <section aria-labelledby="cov-h" className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
            <div>
              <h2 id="cov-h" className="font-display text-[2rem] font-bold leading-none">Data sources right now</h2>
              <p className="mt-3 text-[0.95rem] text-muted">{engineNote}</p>
              {usage && usage.audits_with_agent > 0 && (
                <p className="mt-3 text-[0.95rem] text-muted">
                  AI use so far: {usage.audits_with_agent} agent audit{usage.audits_with_agent === 1 ? "" : "s"},{" "}
                  {usage.requests} requests, {(usage.input_tokens + usage.cache_write_tokens + usage.cache_read_tokens).toLocaleString()} input
                  and {usage.output_tokens.toLocaleString()} output tokens, about ${usage.est_cost_usd.toFixed(2)} at list price
                  {usage.unpriced_models.length ? ` (plus unpriced: ${usage.unpriced_models.join(", ")})` : ""}.
                </p>
              )}
            </div>
            <div>
              {sources ? <CoverageCards sources={sources} /> : !error && <p className="text-muted">Checking sources…</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
