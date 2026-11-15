"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ErrorNote } from "@/components/ui";
import { chooseModel, evidenceUrl, saveMarkups, suggestMarkups, type Evidence, type Finding, type Pin, type StallSuggestion } from "@/lib/api";

function Provenance({ ev }: { ev: Evidence }) {
  const scale = ev.scale as { native_resolution?: number; units?: string; note?: string } | null;
  return (
    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-[0.95rem]">
      <dt className="text-muted">Source</dt>
      <dd>
        {ev.provider}, {ev.is_synthetic ? "synthetic" : ev.is_sponsor_source ? "sponsor data" : "public fallback"}
      </dd>
      <dt className="text-muted">Captured</dt>
      <dd>{ev.capture_date ?? "Unknown"}</dd>
      {scale?.native_resolution && (
        <>
          <dt className="text-muted">Resolution</dt>
          <dd>{scale.native_resolution} {scale.units}/pixel</dd>
        </>
      )}
      {scale?.note && (<><dt className="text-muted">Resolution</dt><dd>{scale.note}</dd></>)}
      <dt className="text-muted">Rights</dt>
      <dd>{ev.rights ?? "Unknown"}</dd>
      {ev.quality && (<><dt className="text-muted">Limits</dt><dd>{ev.quality}</dd></>)}
    </dl>
  );
}

function Schematic({ ev, selected }: { ev: Evidence; selected: Finding | null }) {
  const regions = ev.geometry?.regions ?? [];
  const W = 600, H = 400;
  const hit = regions.find((r) => r.id === selected?.location_id);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" className="w-full border border-line bg-[#2f353b]"
      aria-label={`Synthetic site schematic. ${hit ? `Highlighted: ${hit.label}.` : "No location highlighted."}`}>
      {regions.map((r) => {
        const on = r.id === selected?.location_id;
        const fill = r.kind === "building" ? "#f7f7f3" : r.kind === "lot" ? "#3d444b" : "#d4d6cf";
        return (
          <g key={r.id}>
            <rect x={r.x * W} y={r.y * H} width={r.w * W} height={r.h * H} rx={6} fill={fill}
              stroke={on ? "var(--sign)" : "#8a9197"} strokeWidth={on ? 5 : 1.5} strokeDasharray={on ? "10 5" : undefined} />
            <text x={r.x * W + 8} y={r.y * H + (r.kind === "door" ? -6 : 20)} fontSize={r.kind === "door" ? 12 : 14}
              fontWeight={on ? 700 : 500} fill={r.kind === "lot" ? "#f7f7f3" : "#17212b"}>
              {on ? "▶ " : ""}{r.label}
            </text>
          </g>
        );
      })}
      <text x={W - 10} y={H - 10} textAnchor="end" fontSize={13} fontWeight={600} fill="#f7f7f3">
        Synthetic schematic, not imagery
      </text>
    </svg>
  );
}

/** Aerial image with a person's marks for accessible stalls. Marks become the observed counts. */
function AerialMarkup({ ev, auditId, onChanged, marking, setMarking }: {
  ev: Evidence; auditId: string; onChanged: () => Promise<void>; marking: boolean; setMarking: (v: boolean) => void;
}) {
  const saved = ev.geometry?.pins ?? null;
  const [pins, setPins] = useState<Pin[]>(saved ?? []);
  const [kind, setKind] = useState<Pin["kind"]>("accessible");
  const [who, setWho] = useState(ev.geometry?.pins_by ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AI suggestions are proposals only. They sit apart from the marks until the person accepts each one.
  const [ideas, setIdeas] = useState<StallSuggestion[] | null>(null);
  const [ideaNote, setIdeaNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const shown = marking ? pins : saved ?? [];
  const vans = shown.filter((p) => p.kind === "van").length;

  function place(e: React.MouseEvent<HTMLDivElement>) {
    if (!marking) return;
    const box = e.currentTarget.getBoundingClientRect();
    setPins([...pins, { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height, kind }]);
  }

  async function suggest() {
    setLooking(true);
    setError(null);
    try {
      const res = await suggestMarkups(auditId);
      // Skip anything sitting on a mark the person already placed (within about one stall).
      setIdeas(res.suggestions.filter((s) => !pins.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 0.012)));
      setIdeaNote(res.notes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLooking(false);
    }
  }

  const accept = (list: StallSuggestion[]) => {
    setPins([...pins, ...list.map((s) => ({ x: s.x, y: s.y, kind: s.kind, suggested: true }))]);
    setIdeas((ideas ?? []).filter((s) => !list.includes(s)));
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveMarkups(auditId, pins, who);
      setMarking(false);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className={`relative overflow-hidden border border-line ${marking ? "cursor-crosshair" : ""}`} onClick={place}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote provider imagery, not optimizable */}
        <img src={evidenceUrl(ev.view_url!)} className="block aspect-square w-full select-none object-cover" draggable={false}
          alt={`Aerial image from ${ev.provider} centred on the property, captured ${ev.capture_date ?? "on an unknown date"}. ${shown.length} accessible stall mark(s) placed by a person.`} />
        {shown.map((p, i) => (
          <button key={i} type="button" disabled={!marking}
            onClick={(e) => { e.stopPropagation(); setPins(pins.filter((_, j) => j !== i)); }}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            aria-label={`Mark ${i + 1}: ${p.kind === "van" ? "van-accessible" : "accessible"} stall${marking ? ". Activate to remove." : ""}`}
            className={`absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center border-2 border-white text-xs font-bold text-white shadow ${
              p.kind === "van" ? "rounded-md bg-suspect" : "rounded-full bg-brand"}`}>
            {p.kind === "van" ? "V" : "A"}
          </button>
        ))}
        <AnimatePresence>
          {marking && (ideas ?? []).map((s, i) => (
            <motion.button key={`${s.x}-${s.y}`} type="button" title={s.cue}
              onClick={(e) => { e.stopPropagation(); accept([s]); }}
              style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
              initial={{ opacity: 0, scale: 2.2, x: "-50%", y: "-50%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.6, x: "-50%", y: "-50%" }}
              transition={{ type: "spring", stiffness: 380, damping: 24, delay: i * 0.12 }}
              aria-label={`Suggestion ${i + 1}: possible ${s.kind === "van" ? "van-accessible" : "accessible"} stall. The model saw: ${s.cue}. Activate to accept.`}
              className="absolute flex size-8 items-center justify-center rounded-full border-2 border-dashed border-white bg-ink/55 text-sm font-bold text-white shadow">
              ?
            </motion.button>
          ))}
        </AnimatePresence>
        {looking && (
          <motion.div aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-white/35 to-transparent"
            initial={{ top: "-10%" }} animate={{ top: "100%" }} transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }} />
        )}
      </div>

      {!marking && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.95rem] text-muted">
            {saved
              ? `${saved.length} accessible stall(s) marked by ${ev.geometry?.pins_by}, ${vans} of them van-accessible.`
              : "No one has marked accessible stalls on this image yet."}
          </p>
          <button className="btn btn-sm no-print" onClick={() => { setPins(saved ?? []); setIdeas(null); setMarking(true); }}>
            {saved ? "Edit marks" : "Mark accessible stalls"}
          </button>
        </div>
      )}

      {marking && (
        <form onSubmit={save} className="no-print mt-3 space-y-3 border-l-4 border-sign bg-sign-wash p-4 text-[0.95rem]">
          <p>
            Click each stall painted with the wheelchair symbol or a striped access aisle. Click a mark to remove it.
            What you mark is recorded as counted by you. AI suggestions count only once you accept them.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-sm" type="button" onClick={suggest} disabled={looking}>
              {looking ? "Looking at the image…" : ideas ? "Suggest again" : "Suggest stalls with AI"}
            </button>
            {ideas && ideas.length > 0 && (
              <>
                <button className="btn btn-sm" type="button" onClick={() => accept(ideas)}>Accept all {ideas.length}</button>
                <button className="btn btn-sm" type="button" onClick={() => setIdeas([])}>Dismiss</button>
              </>
            )}
          </div>
          {ideas && (
            <p aria-live="polite">
              {ideas.length > 0
                ? `${ideas.length} possible stall(s) shown as dashed “?” marks. Click each one you agree with. `
                : "No suggestions left to review. "}
              The model can miss stalls and guess wrong, so check the whole lot yourself.
              {ideaNote && ` It noted: ${ideaNote}`}
            </p>
          )}
          <fieldset className="flex flex-wrap gap-4">
            <legend className="font-medium">Next mark is a</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === "accessible"} onChange={() => setKind("accessible")} />
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">A</span>
              Accessible stall
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" checked={kind === "van"} onChange={() => setKind("van")} />
              <span className="inline-flex size-5 items-center justify-center rounded-md bg-suspect text-[10px] font-bold text-white">V</span>
              Van-accessible stall
            </label>
          </fieldset>
          <p className="font-medium" aria-live="polite">
            {pins.length} accessible stall(s) marked, {pins.filter((p) => p.kind === "van").length} van-accessible.
            {pins.length === 0 && " Saving with none marked records that you looked and found none."}
          </p>
          {error && <ErrorNote message={error} />}
          <div className="flex flex-wrap items-end gap-3">
            <label className="font-medium">
              Your name
              <input className="field mt-1" required maxLength={80} value={who} onChange={(e) => setWho(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Save counts and re-run checks</button>
            <button className="btn btn-sm" type="button" onClick={() => setMarking(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function EvidenceView({ evidence, selected, auditId, onChanged }: {
  evidence: Evidence[]; selected: Finding | null; auditId: string; onChanged: () => Promise<void>;
}) {
  const [marking, setMarking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const site = evidence.find((e) => e.asset_type === "schematic" || e.asset_type === "aerial_image");
  const tour = evidence.find((e) => e.asset_type === "tour");
  const record = evidence.find((e) => e.asset_type === "record");
  const linked = ((record?.geometry?.summary as { model_ids?: string[] } | undefined)?.model_ids) ?? [];
  const summary = tour?.geometry?.summary as
    { model_id?: string; name?: string; address?: string; panos?: number; classifications?: string[];
      has_floor_plan?: boolean; doorways?: { width_in: number | null }[] } | undefined;
  const doorways = summary?.doorways ?? [];
  const widths = doorways.map((d) => d.width_in).filter((w): w is number => w != null);

  async function pick(modelId: string) {
    setSwitching(true);
    setError(null);
    try { await chooseModel(auditId, modelId); await onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setSwitching(false); }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section aria-labelledby="site-h" className={`sheet p-5 ${marking ? "lg:col-span-2" : ""}`}>
        <h3 id="site-h" className="font-display text-[1.6rem] font-bold leading-none">From above</h3>
        {!site && <p className="mt-3 text-[0.95rem] text-muted">No aerial image for this site. Exterior checks rely on what a person records.</p>}
        {site?.asset_type === "schematic" && <div className="mt-2"><Schematic ev={site} selected={selected} /></div>}
        {site?.asset_type === "aerial_image" && site.view_url && (
          <AerialMarkup key={`${site.id}-${site.geometry?.pins?.length ?? "none"}`} ev={site} auditId={auditId}
            onChanged={onChanged} marking={marking} setMarking={setMarking} />
        )}
        {site && <Provenance ev={site} />}
      </section>

      <section aria-labelledby="tour-h" className="sheet p-5">
        <h3 id="tour-h" className="font-display text-[1.6rem] font-bold leading-none">Inside</h3>
        {error && <div className="mt-2"><ErrorNote message={error} /></div>}
        {!tour && (
          <p className="mt-3 text-[0.95rem] text-muted">
            No authorized 3D model is linked to this property. Door widths need a tape measure on site; nothing is
            estimated from a tour of a different building.
          </p>
        )}
        {tour && (
          <>
            {tour.view_url ? (
              <iframe key={tour.provider_asset_id} src={tour.view_url} allow="xr-spatial-tracking; fullscreen" allowFullScreen
                title={`Matterport 3D tour of ${summary?.name ?? "the property"}`}
                className="mt-3 aspect-video w-full border border-line" />
            ) : (
              <p className="mt-3 text-[0.95rem] text-muted">This model is private, so its tour cannot be embedded.</p>
            )}
            <p className="mt-3 font-semibold">{summary?.name}</p>
            <p className="text-[0.95rem] text-muted">
              {summary?.address ?? "Address unknown"}. {summary?.panos ?? 0} scan positions.
              {summary?.classifications?.length ? ` Matterport classifies it as ${summary.classifications.join(", ").replaceAll("_", " ")}.` : ""}
            </p>
            {linked.length > 1 && (
              <label className="no-print mt-3 block text-[0.95rem] font-medium">
                CoStar links {linked.length} scans to this property. Showing:
                <select className="field mt-1" disabled={switching} value={summary?.model_id ?? ""} onChange={(e) => pick(e.target.value)}>
                  {linked.map((m, i) => <option key={m} value={m}>Scan {i + 1} of {linked.length} ({m})</option>)}
                </select>
              </label>
            )}
            <p className="mt-3 text-[0.95rem]">
              {doorways.length > 0
                ? <>The interior inspector measured <strong>{doorways.length} doorway opening{doorways.length === 1 ? "" : "s"}</strong> in
                    this scan&apos;s floor plan{widths.length ? `, ${Math.min(...widths)} to ${Math.max(...widths)} in wide` : ""}. These
                    are frame openings: clear width with the door open is narrower, so a scan can flag a narrow doorway but
                    never pass one.</>
                : summary?.has_floor_plan
                  ? "This scan's floor plan has no doorways, so no door could be measured from it."
                  : "This scan has no floor plan, so no doorway could be measured from it."}
              {linked.length > 1 && doorways.length === 0 ? " Another linked scan may have one: switch scans above." : ""}
            </p>
            <p className="mt-2 text-[0.95rem] text-muted">
              To confirm a door: open the tour&apos;s measurement tool, measure the clear opening with the door open 90°, then
              record it on that door&apos;s check as “Measured by hand in the 3D tour”.
            </p>
            <Provenance ev={tour} />
          </>
        )}
      </section>
    </div>
  );
}
