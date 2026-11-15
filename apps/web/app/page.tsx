"use client";

import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IntegrationsPanel } from "@/components/IntegrationsPanel";
import type { Shot } from "@/components/LandingScene";
import { createAudit, getSources, searchProperties, type CostarHit, type Integration } from "@/lib/api";

const LandingScene = dynamic(() => import("@/components/LandingScene"), { ssr: false });

const EASE = [0.22, 1, 0.36, 1] as const;
const PINS = [
  { id: "parking", side: "left", label: "Accessible parking", note: "Stalls and the access aisle are counted on Vexcel imagery, by you or from Gemini suggestions you accept." },
  { id: "entrance", side: "up", label: "Entrance door", note: "Clear width is measured by hand in the Matterport tour. It is never estimated from a photo." },
  { id: "route", side: "right", label: "Curb ramp and route", note: "Routes from parking to the door are flagged for a person to check on site." },
] as const;
type PinId = (typeof PINS)[number]["id"];

function Coverage({ hit }: { hit: CostarHit }) {
  const rows: [string, boolean, string][] = [
    ["CoStar record", true, `${hit.type}, built ${hit.year_built ?? "year unknown"}, ${hit.surface_spaces ?? "unknown"} surface spaces`],
    ["Vexcel aerial", !!hit.vexcel_region, hit.vexcel_region ? `Inside the ${hit.vexcel_region} geofence, about 7.5 cm per pixel` : "Outside the hackathon geofence. The public USGS image is used instead."],
    ["Matterport scan", hit.model_ids.length > 0, hit.model_ids.length ? `${hit.model_ids.length} linked scan${hit.model_ids.length === 1 ? "" : "s"}. Door widths are measured by hand.` : "No linked scan"],
    ["Gemini suggestions", true, "Permitted imagery only, never Vexcel. Suggestions wait for your review."],
  ];
  return (
    <ul className="lx-cover">
      {rows.map(([name, ok, detail], i) => (
        <motion.li key={name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.05, duration: 0.3, ease: EASE }}>
          <span className={`lx-dot ${ok ? "ok" : ""}`} aria-hidden="true" />
          <div><strong>{name}</strong><p>{detail}</p></div>
        </motion.li>
      ))}
    </ul>
  );
}

export default function Home() {
  const router = useRouter();
  const reduced = !!useReducedMotion();
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<CostarHit[] | null>(null);
  const [kitAvailable, setKitAvailable] = useState(true);
  const [active, setActive] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pin, setPin] = useState<PinId | null>(null);        // explored shot (click), drives the camera
  const [hoverPin, setHoverPin] = useState<PinId | null>(null);  // note only, never moves the camera
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [igOpen, setIgOpen] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [form, setForm] = useState({ name: "", address: "", lat: "", lon: "" });
  const pinEls = useRef<Record<string, HTMLElement | null>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const igRef = useRef<HTMLDivElement>(null);

  // The scene starts on a far, high shot; once it is drawn the camera flies in (the entrance).
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setEntered(true), reduced ? 0 : 120);
    return () => clearTimeout(t);
  }, [ready, reduced]);

  useEffect(() => {
    if (!pin) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPin(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin]);

  useEffect(() => { getSources().then((r) => setIntegrations(r.integrations)).catch(() => setIntegrations(null)); }, [igOpen]);

  useEffect(() => {
    const t = setTimeout(() => {
      searchProperties(query)
        .then((r) => { setHits(r.properties); setKitAvailable(r.available); setActive(0); })
        .catch((e: Error) => { setHits([]); setError(e.message); });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!igOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIgOpen(false); };
    const onDown = (e: MouseEvent) => { if (!igRef.current?.contains(e.target as Node)) setIgOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [igOpen]);

  const selected = hits?.find((h) => h.id === selectedId) ?? null;
  const showResults = !selected && (focused || query.length > 0) && hits !== null;
  const shot: Shot = !entered ? "entry" : launching ? "launch" : selected ? "selected" : pin ?? (showResults ? "search" : "intro");
  // Positive offset moves the building right of the copy; negative centres it left of the preview sheet.
  const offset = selected ? -270 : 330;

  async function start(body: Record<string, unknown>) {
    setLaunching(true);
    setError(null);
    try {
      const [{ audit_id }] = await Promise.all([
        createAudit({ standard_profile: "ADA_2010_SCREEN", ...body }),
        new Promise((r) => setTimeout(r, reduced ? 0 : 750)),  // let the camera finish its dive
      ]);
      router.push(`/audits/${audit_id}`);
    } catch (e) {
      setError((e as Error).message);
      setLaunching(false);
    }
  }

  function choose(h: CostarHit) {
    setSelectedId(h.id);
    setPin(null);
    setHoverPin(null);
    inputRef.current?.blur();
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!hits?.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === "Enter") { e.preventDefault(); choose(hits[active] ?? hits[0]); }
    if (e.key === "Escape") { setQuery(""); inputRef.current?.blur(); }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const verified = integrations?.filter((r) => r.state === "verified").length ?? 0;
  const gemini = integrations?.find((r) => r.provider === "gemini");
  // Same initial markup on server and client; MotionConfig drops the movement for reduced-motion users.
  const enter = (delay: number) => ({ initial: { opacity: 0, y: 16 }, animate: entered ? { opacity: 1, y: 0 } : {}, transition: { delay: reduced ? 0 : delay, duration: reduced ? 0.2 : 0.7, ease: EASE } });

  return (
    <MotionConfig reducedMotion="user">
    <div className="lx" data-shot={shot}>
      <div className={`lx-scene ${ready ? "on" : ""}`}>
        <LandingScene shot={shot} offset={offset} reduced={reduced} pins={pinEls} onReady={() => setReady(true)} />
      </div>

      <header className="lx-nav">
        <motion.span className="lx-logo" {...enter(0.15)}>unstuck</motion.span>
        <div className="lx-ig" ref={igRef}>
          <motion.button type="button" className="lx-chip" aria-expanded={igOpen} onClick={() => setIgOpen(!igOpen)} {...enter(0.25)}>
            <span className={`lx-dot ${gemini?.state === "verified" || gemini?.state === "configured" ? "ok" : ""}`} aria-hidden="true" />
            {integrations ? `${verified} of ${integrations.length} verified${gemini ? ` · Gemini ${gemini.state === "unavailable" ? "off" : gemini.state}` : ""}` : "Integrations"}
          </motion.button>
          <AnimatePresence>
            {igOpen && (
              <motion.div className="lx-ig-panel" role="dialog" aria-label="Integrations and AI status"
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                <IntegrationsPanel />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <AnimatePresence mode="popLayout">
        {!selected && (
          <motion.section key="hero" className="lx-hero" aria-labelledby="lx-title"
            exit={{ opacity: 0, x: reduced ? 0 : -24, transition: { duration: 0.25, ease: EASE } }}>
            <h1 id="lx-title">
              <motion.span {...enter(0.25)}>Find what keeps people</motion.span>
              <motion.span {...enter(0.33)}>out of a building.</motion.span>
            </h1>
            <motion.p className="lx-lede" {...enter(0.45)}>
              Screen a commercial property against the 2010 ADA Standards from its CoStar record, Vexcel aerial and Matterport
              scan. Anything that can’t be measured goes to a person.
            </motion.p>

            <motion.div className={`lx-bar ${showResults ? "open" : ""}`} {...enter(0.55)}>
              <form className="lx-field" role="search" onSubmit={(e) => { e.preventDefault(); if (hits?.[active]) choose(hits[active]); }}>
                <label className="sr-only" htmlFor="lx-q">Search CoStar properties</label>
                <input id="lx-q" ref={inputRef} type="search" autoComplete="off" placeholder="Search CoStar by name, address or use" value={query}
                  onChange={(e) => setQuery(e.target.value)} onFocus={() => { setFocused(true); setPin(null); }} onBlur={() => setTimeout(() => setFocused(false), 120)}
                  onKeyDown={onSearchKey} role="combobox" aria-expanded={showResults} aria-controls="lx-results"
                  aria-activedescendant={showResults && hits?.[active] ? `lx-r-${hits[active].id}` : undefined} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!hits?.length}>Search</button>
              </form>
              <AnimatePresence initial={false}>
                {showResults && (
                  <motion.div key="results" className="lx-results-wrap" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.28, ease: EASE }}>
                    <p className="lx-count">{!kitAvailable ? "The CoStar extract isn’t loaded on this server." : `${hits!.length} CoStar ${hits!.length === 1 ? "property" : "properties"} with a Matterport scan`}</p>
                    <ul id="lx-results" role="listbox" aria-label="CoStar properties" className="lx-results">
                      {hits!.map((h, i) => (
                        <li key={h.id} id={`lx-r-${h.id}`} role="option" aria-selected={i === active}
                          onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(h)}>
                          <strong>{h.name}</strong>
                          <span className="lx-meta">
                            {[h.address, h.city].filter(Boolean).join(", ")} · {h.type} · {h.surface_spaces ?? "?"} spaces
                            <i className={h.vexcel_region ? "ok" : ""}>Vexcel</i>
                            <i className={h.model_ids.length ? "ok" : ""}>Matterport</i>
                          </span>
                        </li>
                      ))}
                      {hits!.length === 0 && kitAvailable && <li className="lx-none">No properties match “{query}”. Try a street or a use type such as retail.</li>}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
              <label className={`lx-auth ${authorized ? "on" : ""}`}>
                <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
                <span>I own this property or am authorized to screen it under the hackathon data terms</span>
              </label>
            </motion.div>

            {error && <p className="lx-error" role="alert">{error}</p>}

            <motion.div className="lx-alt" {...enter(0.7)}>
              <button type="button" onClick={() => start({ property_id: "property_demo_001", allow_synthetic_fixture: true })} disabled={launching}>
                Open the demo property
              </button>
              <button type="button" aria-expanded={coordsOpen} onClick={() => setCoordsOpen(!coordsOpen)}>Enter coordinates</button>
            </motion.div>
            <AnimatePresence initial={false}>
              {coordsOpen && (
                <motion.form key="coords" className="lx-coords" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.25, ease: EASE }}
                  onSubmit={(e) => { e.preventDefault(); start({ custom_property: { name: form.name, address: form.address || null, lat: Number(form.lat), lon: Number(form.lon) }, ownership_authorized: authorized }); }}>
                  <div className="lx-coords-grid">
                    <label className="wide">Property name<input className="field" required maxLength={120} value={form.name} onChange={set("name")} /></label>
                    <label className="wide">Address <em>(optional)</em><input className="field" maxLength={200} value={form.address} onChange={set("address")} /></label>
                    <label>Latitude<input className="field" required type="number" step="any" min={-90} max={90} value={form.lat} onChange={set("lat")} /></label>
                    <label>Longitude<input className="field" required type="number" step="any" min={-180} max={180} value={form.lon} onChange={set("lon")} /></label>
                  </div>
                  <button className="btn btn-sm" type="submit" disabled={launching || !authorized}>Start screening</button>
                  {!authorized && <span>Tick the authorization box first.</span>}
                </motion.form>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Scene pins: positioned every frame by the scene, explained on hover or focus. */}
      <div className={`lx-pins ${entered && !selected && !showResults && !launching ? "on" : ""}`} aria-label="What a screening checks">
        {PINS.map((p, i) => (
          <div key={p.id} ref={(el) => { pinEls.current[p.id] = el; }} className={`lx-pin ${p.side}`} style={{ ["--d" as string]: `${0.9 + i * 0.12}s` }}>
            <button type="button" aria-pressed={pin === p.id} aria-describedby={hoverPin === p.id || pin === p.id ? `lx-note-${p.id}` : undefined}
              onMouseEnter={() => setHoverPin(p.id)} onMouseLeave={() => setHoverPin(null)} onFocus={() => setHoverPin(p.id)} onBlur={() => setHoverPin(null)}
              onClick={() => setPin(pin === p.id ? null : p.id)}>
              <span className="lx-pin-dot" aria-hidden="true" />{p.label}
            </button>
            <AnimatePresence>
              {(hoverPin === p.id || pin === p.id) && (
                <motion.p id={`lx-note-${p.id}`} role="tooltip" className="lx-pin-note" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}>
                  {p.note}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {pin && !selected && (
          <motion.button key="overview" type="button" className="lx-overview" onClick={() => setPin(null)}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
            Back to overview <kbd>Esc</kbd>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selected && (
          <motion.aside key={selected.id} className="lx-sheet" aria-labelledby="lx-sheet-title"
            initial={{ opacity: 0, x: reduced ? 0 : 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : 28 }}
            transition={{ duration: 0.34, ease: EASE }}>
            <button type="button" className="lx-back" onClick={() => { setSelectedId(null); setTimeout(() => inputRef.current?.focus(), 50); }}>
              ← Back to search
            </button>
            <p className="lx-kicker">CoStar {selected.id} · {selected.type}{selected.year_built ? ` · built ${selected.year_built}` : ""}</p>
            <h2 id="lx-sheet-title">{selected.name}</h2>
            <p className="lx-address">{[selected.address, selected.city].filter(Boolean).join(", ") || "Address not recorded"}. {selected.surface_spaces ?? "Unknown"} surface spaces.</p>
            <h3>What this screening will use</h3>
            <Coverage hit={selected} />
            <div className="lx-go">
              <button className="btn btn-primary" disabled={launching || !authorized}
                onClick={() => start({ costar_property_id: selected.id, ownership_authorized: authorized })}>
                {launching ? "Opening the inspection…" : "Screen this property"}
              </button>
              <label className={`lx-auth inline ${authorized ? "on" : ""}`}>
                <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
                <span>I’m authorized to screen this property</span>
              </label>
            </div>
            {error && <p className="lx-error" role="alert">{error}</p>}
          </motion.aside>
        )}
      </AnimatePresence>

      <motion.p className="lx-disclaim" {...enter(0.9)}>
        {selected ? "Illustrative building, not this property’s geometry." : "Illustrative building. Screening, not certification."}
      </motion.p>
      <AnimatePresence>{launching && <motion.div className="lx-veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduced ? 0 : 0.35, duration: 0.4 }} />}</AnimatePresence>
    </div>
    </MotionConfig>
  );
}
