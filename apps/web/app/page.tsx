"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CoverageCards, ErrorNote } from "@/components/ui";
import { createAudit, getSources, type SourceStatus } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [engineNote, setEngineNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", lat: "", lon: "", model: "", authorized: false });

  useEffect(() => {
    getSources()
      .then((r) => { setSources(r.sources); setEngineNote(r.engine_note); })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function start(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const { audit_id } = await createAudit(body);
      router.push(`/audits/${audit_id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const startDemo = () =>
    start({ property_id: "property_demo_001", standard_profile: "ADA_2010_SCREEN", allow_synthetic_fixture: true });

  function startCustom(e: React.FormEvent) {
    e.preventDefault();
    start({
      custom_property: {
        name: form.name,
        address: form.address || null,
        lat: Number(form.lat),
        lon: Number(form.lon),
        matterport_model_id: form.model || null,
      },
      standard_profile: "ADA_2010_SCREEN",
      ownership_authorized: form.authorized,
    });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Find what could keep people out of your building, and what to check first.
        </h1>
        <p className="mt-4 text-lg text-muted">
          Unstuck gathers property records, aerial imagery and 3D scans for one property, runs tested numeric
          checks from the 2010 ADA Standards, and shows the evidence behind each one. Anything it cannot measure
          is sent to a person, never guessed.
        </p>
      </section>

      {error && <ErrorNote message={error} />}

      <section aria-labelledby="start-h" className="grid gap-6 lg:grid-cols-2">
        <h2 id="start-h" className="sr-only">Start a screen</h2>

        <div className="rounded-3xl border border-line bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Try it</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Synthetic demo property</h3>
          <p className="mt-2 text-muted">
            A made-up retail centre with made-up measurements, so you can see every kind of result: below
            threshold, meets threshold, suspected, and needs field measurement. Clearly labelled as synthetic
            throughout.
          </p>
          <button className="btn btn-primary mt-5" onClick={startDemo} disabled={busy}>
            Start demo screen
          </button>
        </div>

        <form onSubmit={startCustom} className="rounded-3xl border border-line bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your property</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">Screen a real commercial property</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium sm:col-span-2">
              Property name
              <input className="field mt-1" required maxLength={120} value={form.name} onChange={set("name")} />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Address <span className="font-normal text-muted">(optional, for your reference)</span>
              <input className="field mt-1" maxLength={200} value={form.address} onChange={set("address")} />
            </label>
            <label className="text-sm font-medium">
              Latitude
              <input className="field mt-1" required type="number" step="any" min={-90} max={90}
                placeholder="34.0522" value={form.lat} onChange={set("lat")} />
            </label>
            <label className="text-sm font-medium">
              Longitude
              <input className="field mt-1" required type="number" step="any" min={-180} max={180}
                placeholder="-118.2437" value={form.lon} onChange={set("lon")} />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Matterport model ID <span className="font-normal text-muted">(optional, needs Matterport keys)</span>
              <input className="field mt-1" pattern="[A-Za-z0-9]{6,20}" value={form.model} onChange={set("model")} />
            </label>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-xl bg-paper p-3 text-sm">
            <input type="checkbox" className="mt-1 size-4" required checked={form.authorized} onChange={set("authorized")} />
            <span>
              I own this property or am authorized to audit it. Unstuck is for owners and managers screening
              their own buildings, not for finding other people&apos;s.
            </span>
          </label>
          <button className="btn btn-primary mt-5" type="submit" disabled={busy}>
            Start screening
          </button>
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
