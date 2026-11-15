"use client";

import { useEffect, useRef, useState } from "react";
import { addMeasurement, getMatterportSdk, type Audit, type Finding } from "@/lib/api";
import { useReviewer } from "@/lib/reviewer";

/**
 * The Matterport tour with measuring wired in. A person draws a line across a door with the tour's own ruler;
 * the line's length is read through the Matterport SDK and saved to that door's check, so nothing is typed.
 * It is still a person's measurement (method "model_metric"): the software reads the line, it does not place it.
 * If the SDK cannot connect (no key, or the key is not registered for this site) the tour still works as a plain embed.
 */

type V3 = { x: number; y: number; z: number };
type Sub = { cancel(): void };
interface MpSdk {
  Measurements: {
    toggleMode(on: boolean): Promise<void>;
    getData(): Promise<{ sid: string; start: V3; end: V3 }[]>;
    data: { subscribe(o: { onCollectionUpdated(c: unknown): void }): Sub };
    mode: { subscribe(cb: (m: { active: boolean }) => void): Sub };
  };
  disconnect?(): void;
}
declare global {
  interface Window { MP_SDK?: { connect(el: HTMLIFrameElement, key: string, version: string): Promise<MpSdk> } }
}

const SDK_SRC = "https://static.matterport.com/showcase-sdk/latest.js";
const REFUSED_KEY = "unstuck.mpSdkRefused";   // remembers, per tab, that Matterport refused the key for this site
const M_TO_IN = 1 / 0.0254;
type Line = { sid: string; meters: number; inches: number };

let sdkScript: Promise<void> | null = null;
function loadSdkScript(): Promise<void> {
  if (window.MP_SDK) return Promise.resolve();
  sdkScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.onload = () => resolve();
    s.onerror = () => { sdkScript = null; reject(new Error("The Matterport SDK script did not load")); };
    document.head.appendChild(s);
  });
  return sdkScript;
}

const WHAT = [
  { name: "door_clear_width_in", label: "Clear width, door open 90°" },
  { name: "door_opening_depth_in", label: "Opening depth" },
];

export function TourMeasure({ src, title, modelId, audit, auditId, selected, onChanged, onLoad }: {
  src: string; title: string; modelId: string | null; audit: Audit; auditId: string; selected: Finding | null;
  onChanged: () => Promise<void>; onLoad?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // undefined = still asking the API for the key, null = no key (plain embed).
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [sdk, setSdk] = useState<MpSdk | null>(null);
  // "refused" = Matterport rejected the key for this site's address; "failed" = anything else. Either way the
  // tour falls back to the plain embed so it keeps working.
  const [problem, setProblem] = useState<"refused" | "failed" | null>(null);
  const [noteOpen, setNoteOpen] = useState(true);
  const [active, setActive] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const doors = audit.property.doors;
  const [doorId, setDoorId] = useState("");
  const [what, setWhat] = useState(WHAT[0].name);
  const [who, setWho] = useReviewer();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    let refused = false;
    try { refused = sessionStorage.getItem(REFUSED_KEY) === location.origin; } catch { /* storage blocked */ }
    if (refused) { queueMicrotask(() => { if (!off) { setProblem("refused"); setKey(null); } }); return () => { off = true; }; }
    getMatterportSdk().then((r) => { if (!off) setKey(r.application_key ?? null); }).catch(() => { if (!off) setKey(null); });
    return () => { off = true; };
  }, []);

  // Connect once the tour has loaded with the key in its address.
  useEffect(() => {
    const el = frame.current;
    if (!key || !el) return;
    let off = false;
    let live: MpSdk | null = null;
    const subs: Sub[] = [];
    const connect = async () => {
      try {
        await loadSdkScript();
        const s = await window.MP_SDK!.connect(el, key, "");
        if (off) { s.disconnect?.(); return; }
        live = s;
        subs.push(s.Measurements.mode.subscribe((m) => setActive(m.active)));
        subs.push(s.Measurements.data.subscribe({
          onCollectionUpdated: () => {
            void s.Measurements.getData().then((rows) => {
              if (off) return;
              setLines(rows.map((r) => {
                const meters = Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y, r.end.z - r.start.z);
                return { sid: r.sid, meters, inches: Math.round(meters * M_TO_IN * 10) / 10 };
              }));
            });
          },
        }));
        setSdk(s);
      } catch (e) {
        if (off) return;
        // Never show the SDK's own message: it echoes the key. Drop the key and reload the tour as a plain embed.
        const refused = /mismatch|referr|authoriz|invalid/i.test(String((e as Error)?.message ?? e));
        if (refused) { try { sessionStorage.setItem(REFUSED_KEY, location.origin); } catch { /* storage blocked */ } }
        setProblem(refused ? "refused" : "failed");
        setKey(null);
      }
    };
    el.addEventListener("load", connect, { once: true });
    return () => {
      off = true;
      el.removeEventListener("load", connect);
      subs.forEach((x) => x.cancel());
      live?.disconnect?.();
    };
  }, [key]);

  if (key === undefined) return <div className="st-tour" role="status" aria-label="Loading the 3D tour" />;

  const line = lines.at(-1) ?? null;
  // Default to the door of the check that is open, when it is one of this property's doors.
  const door = doors.find((d) => d.id === doorId) ?? doors.find((d) => d.id === selected?.location_id) ?? doors[0] ?? null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!line || !door) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await addMeasurement(auditId, {
        location_id: door.id, name: what, value: line.inches, unit: "in", method: "model_metric", reviewed_by: who,
        notes: `Line ${line.sid} drawn in the Matterport tour${modelId ? ` of scan ${modelId}` : ""}: ${line.meters.toFixed(3)} m.`,
      });
      setSaved(`Saved ${line.inches} in as ${what === WHAT[0].name ? "clear width" : "opening depth"} for ${door.label}.`);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <iframe ref={frame} src={key ? `${src}&play=1&qs=1&applicationKey=${encodeURIComponent(key)}` : src}
        allow="xr-spatial-tracking; fullscreen" allowFullScreen title={title} className="st-tour" onLoad={onLoad} />
      {problem && noteOpen && (
        <div className="st-measure" role="note">
          <p>
            {problem === "refused"
              ? "Measuring from this page is off: this site’s address is not registered for the Matterport SDK key."
              : "Measuring from this page is unavailable right now."}{" "}
            The tour’s own ruler still works. Read the length there and enter it on the door check.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => setNoteOpen(false)}>Dismiss</button>
        </div>
      )}
      {key && !problem && (
        <div className="st-measure" role="region" aria-label="Measure a door in the 3D tour">
          {!sdk && <p role="status">Connecting the ruler…</p>}
          {sdk && !active && !line && (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void sdk.Measurements.toggleMode(true)}>
                Measure a door
              </button>
              <p>Draw a line in the tour and its length is saved to the door check. Nothing to type.</p>
            </>
          )}
          {sdk && active && !line && (
            <p role="status">
              In the tour, choose <strong>Add Measurement</strong>, click one side of the clear opening, then the other,
              and <strong>Confirm</strong>. Measure with the door open 90°, from the door’s face to the opposite stop.
            </p>
          )}
          {sdk && line && (
            <form onSubmit={save}>
              <p aria-live="polite">
                <strong className="st-measure-value">{line.inches} in</strong>
                <span> latest line ({line.meters.toFixed(3)} m){lines.length > 1 ? `, ${lines.length} drawn` : ""}</span>
              </p>
              <label>Door
                <select value={door?.id ?? ""} onChange={(e) => setDoorId(e.target.value)}>
                  {doors.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
              <label>This line is the
                <select value={what} onChange={(e) => setWhat(e.target.value)}>
                  {WHAT.map((w) => <option key={w.name} value={w.name}>{w.label}</option>)}
                </select>
              </label>
              <label>Your name
                <input required maxLength={80} value={who} onChange={(e) => setWho(e.target.value)} />
              </label>
              <div className="st-measure-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !door}>Save to door check</button>
                {active && <button type="button" className="btn btn-sm" onClick={() => void sdk.Measurements.toggleMode(false)}>Stop measuring</button>}
                {!active && <button type="button" className="btn btn-sm" onClick={() => void sdk.Measurements.toggleMode(true)}>Measure again</button>}
              </div>
              {saved && <p role="status" className="st-measure-ok">{saved}</p>}
              {error && <p role="alert" className="st-measure-bad">{error}</p>}
              <p>Recorded as measured by you in the 3D tour. Scan measurements are approximate: re-measure on site if it is close to the minimum.</p>
            </form>
          )}
        </div>
      )}
    </>
  );
}
