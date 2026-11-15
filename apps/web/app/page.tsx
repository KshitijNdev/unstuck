"use client";

import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IntegrationsPanel } from "@/components/IntegrationsPanel";
import { Pipeline } from "@/components/Pipeline";
import type { Shot } from "@/components/LandingScene";
import Link from "next/link";
import { copyAudit, createAudit, getFeatured, getSources, searchProperties, type CostarHit, type FeaturedAudit, type Integration } from "@/lib/api";

const LandingScene = dynamic(() => import("@/components/LandingScene"), { ssr: false });

const EASE = [0.22, 1, 0.36, 1] as const;
const PINS = [
  { id: "parking", side: "left", label: "Accessible parking", note: "Stalls and the access aisle are counted on Vexcel imagery, by you or from Gemini suggestions you accept." },
  { id: "entrance", side: "up", label: "Entrance door", note: "Clear width is measured by hand in the Matterport tour. It is never estimated from a photo." },
  { id: "route", side: "right", label: "Curb ramp and route", note: "Routes from parking to the door are flagged for a person to check on site." },
] as const;
type PinId = (typeof PINS)[number]["id"];

/** The scroll story. Counts are a labelled demonstration on an illustrative lot, computed with Table 208.2. */
const STORY: { shot: Shot; side: "left" | "right" | "center"; kicker: string; title: string; body: string; facts?: [string, string][]; demo?: boolean; pipeline?: boolean }[] = [
  { shot: "s-record", side: "left", kicker: "2  Property intelligence", title: "CoStar says what the building is.",
    body: "Use type and age decide which questions matter. The surface-space count sets how many accessible stalls the lot needs.",
    facts: [["Surface spaces (CoStar)", "120"], ["Use", "Retail, built 1984"]], demo: true },
  { shot: "s-confirmed", side: "right", kicker: "3  Parking analysis", title: "Only confirmed stalls are counted.",
    body: "AI can suggest accessible stalls on permitted imagery, but a suggestion never counts. A reviewer confirms each one; here four are confirmed and one ordinary stall is rejected.",
    facts: [["Accessible spaces confirmed", "4"], ["Suggestions rejected", "1"]], demo: true },
  { shot: "s-ghost", side: "left", kicker: "4  Missing accessible space", title: "A fifth accessible space is required.",
    body: "Table 208.2 requires 5 accessible spaces for a lot of 101 to 150 spaces, and at least 1 of them must be van-accessible (§208.2.4). Four are observed, so the check comes back below the minimum.",
    facts: [["Required accessible spaces", "5"], ["Accessible spaces observed", "4"], ["Additional space needed", "1"], ["Van-accessible required", "1"]], demo: true },
  { shot: "s-ramp", side: "left", kicker: "5  Accessible route", title: "From the aisle, up the curb ramp, to the door.",
    body: "The accessible route runs from the access aisle across the lot, up the curb ramp and along the walk to the entrance. Curb ramps follow §406, and their running slope may not exceed 1:12 (§405.2). Slope is measured on site, never from imagery.",
    facts: [["Maximum running slope", "1:12"], ["Measured slope", "Not measured"]], demo: true },
  { shot: "s-door", side: "left", kicker: "6  Entrance and doorway", title: "The door is measured, never guessed.",
    body: "A scan’s floor plan gives the frame opening, which only flags a doorway to check. Clear width is measured with the door open 90°: at least 32 in (§404.2.3), or 36 in when the opening is deeper than 24 in. Readings within half an inch go back for a tape measure." },
  { shot: "s-agents", side: "center", kicker: "7  AI and evidence", title: "AI and evidence", body: "", pipeline: true },
  { shot: "s-act", side: "right", kicker: "8  Start inspecting", title: "Screen a real property.",
    body: "Search the CoStar extract, open the inspection workspace, and every check lands in Act on, Verify or Passed a check, with its source, method and reviewer. Nothing is called a failure without a measurement." },
];

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
  const [needsAuth, setNeedsAuth] = useState(false);  // a screen was attempted without the authorization tick
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<CostarHit[] | null>(null);
  const [kitAvailable, setKitAvailable] = useState(true);
  const [active, setActive] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [chapter, setChapter] = useState(-1);  // -1 = the hero; 0..n = scroll story chapters, n = agents
  const storyRefs = useRef<(HTMLElement | null)[]>([]);
  const [pin, setPin] = useState<PinId | null>(null);        // explored shot (click), drives the camera
  const [hoverPin, setHoverPin] = useState<PinId | null>(null);  // note only, never moves the camera
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [igOpen, setIgOpen] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [featured, setFeatured] = useState<FeaturedAudit[]>([]);
  const [form, setForm] = useState({ name: "", address: "", lat: "", lon: "" });
  const pinEls = useRef<Record<string, HTMLElement | null>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const igRef = useRef<HTMLDivElement>(null);
  const heroAuthRef = useRef<HTMLInputElement>(null);
  const sheetAuthRef = useRef<HTMLInputElement>(null);

  // Next keeps this page mounted in a hidden <Activity> after router.push (cacheComponents), so state
  // survives a return via Back or the logo. Clear the transient launch state when the page is hidden.
  // The authorization tick is per screening, so it resets too.
  useLayoutEffect(() => () => {
    setLaunching(false);
    setError(null);
    setAuthorized(false);
    setNeedsAuth(false);
  }, []);

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
  // Finished screenings the team pinned: they open instantly and need no sponsor or AI call, a safety net for demos.
  useEffect(() => { getFeatured().then((r) => setFeatured(r.audits)).catch(() => setFeatured([])); }, []);

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
  const storyShot: Shot | null = chapter < 0 ? null : STORY[Math.min(chapter, STORY.length - 1)].shot;
  const shot: Shot = !entered ? "entry" : launching ? "launch" : selected ? "selected" : storyShot ?? pin ?? (showResults ? "search" : "intro");
  const pinsOn = entered && chapter < 0 && !selected && !showResults && !launching;
  // Positive offset moves the building right of the copy; negative centres it left of the preview sheet.
  const side = chapter < 0 ? "left" : STORY[Math.min(chapter, STORY.length - 1)].side;
  const offset = selected ? -270 : side === "left" ? 330 : side === "center" ? 0 : -330;

  // The landing is a deck: one slide per viewport. CSS scroll-snap with scroll-snap-stop: always lets the browser
  // guarantee that one wheel notch or one trackpad swipe lands on exactly the next slide; the slide index follows scrollTop.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setChapter(Math.round(deck.scrollTop / deck.clientHeight) - 1));
    };
    deck.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { deck.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  const goTo = useCallback((slide: number) => {
    const deck = deckRef.current;
    if (!deck) return;
    const n = deck.querySelectorAll(".lx-slide").length;
    const i = Math.max(0, Math.min(n - 1, slide));
    deck.scrollTo({ top: i * deck.clientHeight, behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);

  // One gesture = one slide. A gesture is a run of wheel events with no gap longer than 220 ms (trackpad inertia
  // included); it moves exactly one slide in its direction, however large or long it is. Panels that can still
  // scroll in that direction (results, the agents card, the integrations panel) keep their wheel input.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    let acc = 0, stepped = false, idle = 0, lockedUntil = 0, stepAt = 0, lastAbs = 0, lastSign = 0;
    const canScroll = (el: HTMLElement | null, dy: number) => {
      for (let n = el; n && n !== deck; n = n.parentElement) {
        const st = getComputedStyle(n);
        if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1) {
          if (dy > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0) return true;
        }
      }
      return false;
    };
    const onWheel = (e: WheelEvent) => {
      if (deck.style.overflowY === "hidden" || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      if (canScroll(e.target as HTMLElement, e.deltaY)) return;
      e.preventDefault();
      const now = performance.now(), mag = Math.abs(e.deltaY), sign = Math.sign(e.deltaY);
      // Momentum only ever decays. A delta that jumps well above the decaying tail, or reverses, after the step
      // has had time to land is a new, deliberate swipe, not more of the old one.
      if (stepped && now - stepAt > 320 && mag >= 10 && (sign !== lastSign || mag > lastAbs * 1.8)) { stepped = false; acc = 0; }
      lastAbs = mag; lastSign = sign;
      clearTimeout(idle);
      idle = window.setTimeout(() => { acc = 0; stepped = false; }, 220);
      if (stepped || now < lockedUntil) return;
      acc += e.deltaY;
      if (Math.abs(acc) < 24) return;
      stepped = true;
      stepAt = now;
      lockedUntil = now + 450;
      goTo(Math.round(deck.scrollTop / deck.clientHeight) + Math.sign(acc));
    };
    deck.addEventListener("wheel", onWheel, { passive: false });
    return () => { deck.removeEventListener("wheel", onWheel); clearTimeout(idle); };
  }, [goTo]);

  // Keyboard paging, one slide per key press. Typing in the search, forms and panels is never intercepted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (selectedId !== null || t.closest("input, textarea, select, [role=dialog], .lx-results")) return;
      const cur = chapter + 1;
      const map: Record<string, number> = { ArrowDown: cur + 1, PageDown: cur + 1, " ": cur + 1, ArrowUp: cur - 1, PageUp: cur - 1, Home: 0, End: 99 };
      if (!(e.key in map) || (e.key === " " && t.closest("button, a"))) return;
      e.preventDefault();
      goTo(map[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chapter, goTo, selectedId]);

  // A property preview owns the screen: back to the first slide, deck scrolling paused until it closes.
  useEffect(() => {
    const deck = deckRef.current;
    if (!selected || !deck) return;
    deck.scrollTo({ top: 0 });
    deck.style.overflowY = "hidden";
    return () => { deck.style.overflowY = ""; };
  }, [selected]);

  const toSearch = () => { goTo(0); setTimeout(() => inputRef.current?.focus({ preventScroll: true }), reduced ? 0 : 650); };

  const start = (body: Record<string, unknown>) => launch(() => createAudit({ standard_profile: "ADA_2010_SCREEN", ...body }));
  // A featured original is read-only; the visitor gets their own copy, made from stored results with no provider calls.
  const openFeatured = (id: string) => launch(() => copyAudit(id));

  async function launch(open: () => Promise<{ audit_id: string }>) {
    setLaunching(true);
    setError(null);
    try {
      const [{ audit_id }] = await Promise.all([
        open(),
        new Promise((r) => setTimeout(r, reduced ? 0 : 750)),  // let the camera finish its dive
      ]);
      router.push(`/audits/${audit_id}`);
      // The router keeps this page's state for back/home navigation; clear the launch so it never returns stuck behind the veil.
      setTimeout(() => { setLaunching(false); setSelectedId(null); setPin(null); }, 1200);
    } catch (e) {
      setError((e as Error).message);
      setLaunching(false);
    }
  }

  // The server enforces the tick too (403); this explains a refused click instead of a silently dead button.
  function requireAuth(box: React.RefObject<HTMLInputElement | null>) {
    if (authorized) return true;
    setNeedsAuth(true);
    box.current?.focus();
    return false;
  }

  function onAuthChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAuthorized(e.target.checked);
    if (e.target.checked) setNeedsAuth(false);
  }

  function choose(h: CostarHit) {
    setNeedsAuth(false);
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
    <div className="lx" data-shot={shot} ref={deckRef}>
      <div className={`lx-scene ${ready ? "on" : ""}`}>
        <LandingScene shot={shot} offset={offset} reduced={reduced} pins={pinEls} onReady={() => setReady(true)} />
      </div>
      <div className={`lx-pins story ${["s-ghost", "s-door", "s-ramp", "s-record", "s-confirmed"].includes(shot) ? "on" : ""}`} aria-hidden="true">
        <div ref={(el) => { pinEls.current.building = el; }} className="lx-pin tag" style={{ ["--d" as string]: "0.35s" }}>
          {shot === "s-record" && <span className="lx-tag">Demo record: retail, built 1984, 120 surface spaces</span>}
        </div>
        <div ref={(el) => { pinEls.current.lot = el; }} className="lx-pin tag" style={{ ["--d" as string]: "0.35s" }}>
          {shot === "s-confirmed" && <span className="lx-tag">4 accessible spaces confirmed</span>}
        </div>
        <div ref={(el) => { pinEls.current.ramp = el; }} className="lx-pin tag" style={{ ["--d" as string]: "0.2s" }}>
          {shot === "s-ramp" && <span className="lx-tag">Curb ramp: slope measured on site (1:12 maximum)</span>}
        </div>
        <div ref={(el) => { pinEls.current.ghost = el; }} className="lx-pin tag" style={{ ["--d" as string]: "0.2s" }}>
          {shot === "s-ghost" && <span className="lx-tag ghost">Additional space needed</span>}
        </div>
        <div ref={(el) => { pinEls.current.door = el; }} className="lx-pin tag" style={{ ["--d" as string]: "0.2s" }}>
          {shot === "s-door" && <span className="lx-tag">Clear door width: 32 in minimum</span>}
        </div>
      </div>

      <div className={`lx-pins ${pinsOn ? "on" : ""}`} role="group" aria-label="What a screening checks" inert={!pinsOn}>
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

      <section className="lx-slide lx-slide-hero" aria-label="Search" />

      <header className="lx-nav">
        <motion.span className="lx-logo" {...enter(0.15)}>
          <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden="true">
            <rect x="1" y="1" width="14" height="24" fill="currentColor" />
            <path d="M17 1v24M25 1v24" stroke="currentColor" strokeWidth="2" />
            <path d="M17 7l8-6M17 14l8-6M17 21l8-6" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          unstuck
        </motion.span>
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
                <input ref={heroAuthRef} type="checkbox" checked={authorized} onChange={onAuthChange} />
                <span>I own this property or am authorized to screen it under the hackathon data terms</span>
              </label>
              {needsAuth && !authorized && <p className="lx-hint" role="alert">Tick the box to confirm you’re authorized.</p>}
            </motion.div>

            {error && <p className="lx-error" role="alert">{error}</p>}

            <motion.div className="lx-alt" {...enter(0.7)}>
              <button type="button" onClick={() => start({ property_id: "property_demo_001", allow_synthetic_fixture: true })} disabled={launching}>
                Open the demo property
              </button>
              <button type="button" aria-expanded={coordsOpen} onClick={() => setCoordsOpen(!coordsOpen)}>Enter coordinates</button>
              <Link href="/portfolio">Triage a portfolio</Link>
            </motion.div>
            {featured.length > 0 && !showResults && !coordsOpen && (
              <motion.section className="lx-recent" aria-labelledby="lx-recent-title" {...enter(0.8)}>
                <h2 id="lx-recent-title">Finished screenings <span>open instantly, with your own copy to edit</span></h2>
                <ul>
                  {featured.slice(0, 3).map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => openFeatured(a.id)} disabled={launching}>
                        <strong>{a.name}</strong>
                        <span>
                          {[a.type, a.year_built && `built ${a.year_built}`].filter(Boolean).join(", ")}
                          {a.is_synthetic ? " · synthetic demo" : ""}
                        </span>
                        <span className="lx-recent-counts">
                          <i className="act">{a.counts.act} to act on</i><i className="verify">{a.counts.verify} to verify</i><i className="pass">{a.counts.passed} passed</i>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.section>
            )}
            <AnimatePresence initial={false}>
              {coordsOpen && (
                <motion.form key="coords" className="lx-coords" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.25, ease: EASE }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!requireAuth(heroAuthRef)) return;
                    start({ custom_property: { name: form.name, address: form.address || null, lat: Number(form.lat), lon: Number(form.lon) }, ownership_authorized: authorized });
                  }}>
                  <div className="lx-coords-grid">
                    <label className="wide">Property name<input className="field" required maxLength={120} value={form.name} onChange={set("name")} /></label>
                    <label className="wide">Address <em>(optional)</em><input className="field" maxLength={200} value={form.address} onChange={set("address")} /></label>
                    <label>Latitude<input className="field" required type="number" step="any" min={-90} max={90} value={form.lat} onChange={set("lat")} /></label>
                    <label>Longitude<input className="field" required type="number" step="any" min={-180} max={180} value={form.lon} onChange={set("lon")} /></label>
                  </div>
                  <button className="btn btn-sm" type="submit" disabled={launching}>Start screening</button>
                  {!authorized && <span>Tick the authorization box above first.</span>}
                </motion.form>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Scene pins: positioned every frame by the scene, explained on hover or focus. */}
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
            <button type="button" className="lx-back" onClick={() => { setNeedsAuth(false); setSelectedId(null); setTimeout(() => inputRef.current?.focus(), 50); }}>
              ← Back to search
            </button>
            <p className="lx-kicker">CoStar {selected.id} · {selected.type}{selected.year_built ? ` · built ${selected.year_built}` : ""}</p>
            <h2 id="lx-sheet-title">{selected.name}</h2>
            <p className="lx-address">{[selected.address, selected.city].filter(Boolean).join(", ") || "Address not recorded"}. {selected.surface_spaces ?? "Unknown"} surface spaces.</p>
            <h3>What this screening will use</h3>
            <Coverage hit={selected} />
            <div className="lx-go">
              <label className={`lx-auth inline ${authorized ? "on" : ""}`}>
                <input ref={sheetAuthRef} type="checkbox" checked={authorized} onChange={onAuthChange} />
                <span>I’m authorized to screen this property</span>
              </label>
              {needsAuth && !authorized && <p className="lx-hint" role="alert">Tick the box to confirm you’re authorized.</p>}
              <button type="button" className="btn btn-primary" disabled={launching}
                onClick={() => { if (requireAuth(sheetAuthRef)) start({ costar_property_id: selected.id, ownership_authorized: authorized }); }}>
                {launching ? "Opening the inspection…" : "Screen this property"}
              </button>
            </div>
            {error && <p className="lx-error" role="alert">{error}</p>}
          </motion.aside>
        )}
      </AnimatePresence>

      <motion.p className="lx-disclaim" {...enter(0.9)}>
        {selected ? "Illustrative building, not this property’s geometry."
          : chapter >= 0 && chapter < STORY.length && STORY[chapter].demo ? "Demonstration on an illustrative site. Not a real property or real imagery."
          : "Illustrative city and site, not real property geometry. Screening, not certification."}
      </motion.p>

      {!selected && (
        <nav className="lx-dots" aria-label="Story chapters">
          {["The neighbourhood", ...STORY.map((c) => c.title)].map((label, i) => (
            <button key={label} type="button" aria-label={label} title={label} aria-current={chapter + 1 === i ? "step" : undefined} onClick={() => goTo(i)} />
          ))}
        </nav>
      )}

      {!selected && (
        <div className="lx-story">
          {STORY.map((c, i) => c.pipeline ? (
            <section key={c.shot} ref={(el) => { storyRefs.current[i] = el; }} className="lx-chapter lx-slide center agents" aria-label="AI and evidence">
              <motion.div className="lx-card pipeline" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ amount: 0.3 }} transition={{ duration: 0.5, ease: EASE }}>
                <Pipeline />
              </motion.div>
            </section>
          ) : (            <section key={c.shot} ref={(el) => { storyRefs.current[i] = el; }} className={`lx-chapter lx-slide ${c.side}`} aria-labelledby={`lx-ch-${i}`}>
              <motion.div className="lx-card" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ amount: 0.5 }} transition={{ duration: 0.5, ease: EASE }}>
                <p className="lx-card-kicker">{c.kicker}</p>
                <h2 id={`lx-ch-${i}`}>{c.title}</h2>
                <p>{c.body}</p>
                {c.facts && (
                  <dl className="lx-facts">
                    {c.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                  </dl>
                )}
                {c.demo && <p className="lx-demo">Illustrative demonstration, not a real property.</p>}
                {i === STORY.length - 1 && (
                  <div className="lx-card-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={toSearch}>Search a property</button>
                    <button type="button" className="btn btn-sm" onClick={() => start({ property_id: "property_demo_001", allow_synthetic_fixture: true })} disabled={launching}>Open the demo property</button>
                  </div>
                )}
              </motion.div>
            </section>
          ))}
        </div>
      )}
      <AnimatePresence>{launching && <motion.div className="lx-veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduced ? 0 : 0.35, duration: 0.4 }} />}</AnimatePresence>
    </div>
    </MotionConfig>
  );
}
