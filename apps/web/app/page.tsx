"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CoverageCards, ErrorNote } from "@/components/ui";
import { createAudit, getSources, searchProperties, type CostarHit, type SourceStatus } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [engineNote, setEngineNote] = useState("");
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
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Find what could keep people out of your building, and what to check first.
        </h1>
        <p className="mt-4 text-lg text-muted">
          Unstuck gathers the property record, the view from above and the 3D scan for one building, runs tested
          numeric checks from the 2010 ADA Standards, and shows the evidence behind each one. Anything it cannot
          measure is sent to a person, never guessed.
        </p>
      </section>

      {error && <ErrorNote message={error} />}

      <section aria-labelledby="pick-h" className="rounded-3xl border border-line bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Screen a building</p>
        <h2 id="pick-h" className="mt-1 font-display text-2xl font-semibold">Choose a commercial property</h2>
        <p className="mt-1 text-sm text-muted">
          Offices, retail, industrial and other non-residential buildings in Houston and Los Angeles that have a
          CoStar record and a Matterport scan. Hackathon data, hackathon use only.
        </p>

        <label className="mt-4 flex items-start gap-3 rounded-xl bg-paper p-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
          <span>
            I own this property, am authorized to audit it, or am using it under the hackathon data terms. Unstuck is
            for owners and managers screening their own buildings, not for finding other people&apos;s.
          </span>
        </label>

        <label className="mt-4 block text-sm font-medium">
          Search by name, address or type
          <input className="field mt-1" type="search" placeholder="e.g. Granada, Wilshire, retail" value={query}
            onChange={(e) => setQuery(e.target.value)} />
        </label>

        {!kitAvailable && (
          <p className="mt-3 text-sm text-muted">The CoStar extract is not loaded, so there is nothing to search. Use the demo or enter coordinates below.</p>
        )}
        <ul className="mt-3 divide-y divide-line" aria-live="polite">
          {hits?.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">{h.name}</p>
                <p className="text-sm text-muted">
                  {[h.address, h.city].filter(Boolean).join(", ")} · {h.type} · built {h.year_built ?? "unknown"} ·{" "}
                  surface parking {h.surface_spaces ?? "unknown"} · {h.model_ids.length} scan{h.model_ids.length === 1 ? "" : "s"}
                </p>
              </div>
              <button className="btn btn-primary btn-sm" disabled={busy || !authorized}
                onClick={() => start({ costar_property_id: h.id, ownership_authorized: authorized })}
                aria-label={`Screen ${h.name}`}>
                Screen
              </button>
            </li>
          ))}
          {hits?.length === 0 && kitAvailable && <li className="py-3 text-sm text-muted">No matching properties.</li>}
        </ul>
        {!authorized && <p className="mt-2 text-sm text-muted">Tick the box above to enable screening.</p>}
      </section>

      <section aria-labelledby="other-h" className="grid gap-6 lg:grid-cols-2">
        <h2 id="other-h" className="sr-only">Other ways to start</h2>

        <div className="rounded-3xl border border-line bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Try it without real data</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Synthetic demo property</h3>
          <p className="mt-2 text-muted">
            A made-up retail centre with made-up measurements, so you can see every kind of result. Clearly labelled
            as synthetic throughout.
          </p>
          <button className="btn mt-5" disabled={busy}
            onClick={() => start({ property_id: "property_demo_001", allow_synthetic_fixture: true })}>
            Start demo screen
          </button>
        </div>

        <form onSubmit={startCustom} className="rounded-3xl border border-line bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Not in the list</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Enter coordinates</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium sm:col-span-2">
              Property name
              <input className="field mt-1" required maxLength={120} value={form.name} onChange={set("name")} />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Address <span className="font-normal text-muted">(optional)</span>
              <input className="field mt-1" maxLength={200} value={form.address} onChange={set("address")} />
            </label>
            <label className="text-sm font-medium">
              Latitude
              <input className="field mt-1" required type="number" step="any" min={-90} max={90} value={form.lat} onChange={set("lat")} />
            </label>
            <label className="text-sm font-medium">
              Longitude
              <input className="field mt-1" required type="number" step="any" min={-180} max={180} value={form.lon} onChange={set("lon")} />
            </label>
          </div>
          <button className="btn mt-5" type="submit" disabled={busy || !authorized}>Start screening</button>
        </form>
      </section>

      <section aria-labelledby="cov-h">
        <h2 id="cov-h" className="font-display text-2xl font-semibold">Data sources right now</h2>
        <p className="mt-1 text-sm text-muted">{engineNote}</p>
        <div className="mt-4">
          {sources ? <CoverageCards sources={sources} /> : !error && <p className="text-muted">Checking sources…</p>}
        </div>
      </section>
    </div>
  );
}
