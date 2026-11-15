"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorNote } from "@/components/ui";
import { createAudit, getPortfolio, type Portfolio, type PortfolioRow } from "@/lib/api";

type SortKey = "points" | "name" | "type" | "year_built" | "surface_spaces" | "required_accessible" | "scans";
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Building" },
  { key: "type", label: "Use" },
  { key: "year_built", label: "Built", numeric: true },
  { key: "surface_spaces", label: "Surface spaces", numeric: true },
  { key: "required_accessible", label: "Accessible stalls, at least", numeric: true },
  { key: "scans", label: "3D scans", numeric: true },
  { key: "points", label: "Measure first", numeric: true },
];

function compare(a: PortfolioRow, b: PortfolioRow, key: SortKey) {
  const x = a[key], y = b[key];
  if (x == null && y == null) return 0;
  if (x == null) return 1;   // unknowns sort last in both directions
  if (y == null) return -1;
  return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
}

export function PortfolioClient() {
  const router = useRouter();
  const [data, setData] = useState<Portfolio | null>(null);
  const [owner, setOwner] = useState<number | null | undefined>(undefined);  // undefined = pick the largest owner once loaded
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "points", desc: true });
  const [error, setError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [launching, setLaunching] = useState<number | null>(null);
  const authRef = useRef<HTMLInputElement>(null);

  // Next keeps this page mounted in a hidden <Activity> after router.push; never come back stuck mid-launch.
  useLayoutEffect(() => () => { setLaunching(null); setAuthorized(false); setNeedsAuth(false); }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      getPortfolio(owner ?? null, query)
        .then((p) => {
          setError(null);
          if (owner === undefined && p.owners.length) { setOwner(p.owners[0].id); return; }  // refetch for that owner
          setData(p);
        })
        .catch((e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [owner, query]);

  const rows = useMemo(() => {
    if (!data) return [];
    const r = [...data.properties].sort((a, b) => compare(a, b, sort.key));
    if (sort.desc) r.reverse();
    // Unknowns stay at the bottom whichever way the column is sorted.
    return [...r.filter((x) => x[sort.key] != null), ...r.filter((x) => x[sort.key] == null)];
  }, [data, sort]);

  async function screen(row: PortfolioRow) {
    if (!authorized) { setNeedsAuth(true); authRef.current?.focus(); return; }
    setLaunching(row.id);
    setError(null);
    try {
      const { audit_id } = await createAudit({ standard_profile: "ADA_2010_SCREEN", costar_property_id: row.id, ownership_authorized: true });
      router.push(`/audits/${audit_id}`);
    } catch (e) {
      setError((e as Error).message);
      setLaunching(null);
    }
  }

  const t = data?.totals;
  return (
    <div className="pf wrap">
      <header className="pf-head">
        <p className="rp-kicker">Portfolio triage</p>
        <h1>What to measure first</h1>
        <p className="pf-lede">
          What the CoStar record and data coverage already say about each building, before any screening runs and with no AI
          calls. Minimum accessible stalls come from Table 208.2 of the 2010 ADA Standards for the recorded surface spaces.
        </p>
      </header>

      <div className="pf-controls">
        <label>
          Owner
          <select className="field" value={owner ?? ""} onChange={(e) => setOwner(e.target.value ? Number(e.target.value) : null)}>
            <option value="">All indexed properties</option>
            {data?.owners.map((o) => <option key={o.id} value={o.id}>CoStar owner {o.id} · {o.buildings} buildings</option>)}
          </select>
        </label>
        <label>
          Filter
          <input className="field" type="search" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} placeholder="Name, address, city or use" />
        </label>
      </div>
      <p className="pf-fine">CoStar identifies owners by company ID; owner names are not in the hackathon extract. {data?.rights}.</p>

      {error && <ErrorNote message={error} />}
      {data && !data.available && <ErrorNote message="The CoStar extract isn’t loaded on this server, so there is nothing to triage." />}

      {t && t.buildings > 0 && (
        <dl className="pf-totals">
          <div><dt>Buildings</dt><dd>{t.buildings}</dd></div>
          <div><dt>Accessible stalls to verify, at least (recorded lots only)</dt><dd>{t.required_accessible}</dd></div>
          <div><dt>Lot size not recorded</dt><dd>{t.lot_unknown}</dd></div>
          <div><dt>Built before 1992</dt><dd>{t.pre_ada}</dd></div>
          <div><dt>No 3D scan</dt><dd>{t.no_scan}</dd></div>
        </dl>
      )}

      <div className="pf-auth">
        <label className={`lx-auth inline ${authorized ? "on" : ""}`}>
          <input ref={authRef} type="checkbox" checked={authorized} onChange={(e) => { setAuthorized(e.target.checked); if (e.target.checked) setNeedsAuth(false); }} />
          <span>I own these properties or am authorized to screen them under the hackathon data terms</span>
        </label>
        {needsAuth && !authorized && <p className="lx-hint" role="alert">Tick the box to confirm you’re authorized, then choose Screen again.</p>}
      </div>

      {data && (
        <div className="pf-table-wrap" tabIndex={0} role="region" aria-label="Buildings, sortable">
          <table className="pf-table">
            <caption className="sr-only">Buildings sorted by {COLUMNS.find((c) => c.key === sort.key)?.label}, {sort.desc ? "highest" : "lowest"} first</caption>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"} className={c.numeric ? "num" : ""}>
                    <button type="button" onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : !!c.numeric })}>
                      {c.label}<span aria-hidden="true">{sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}</span>
                    </button>
                  </th>
                ))}
                <th scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <strong>{r.name}</strong>
                    <span>{[r.address, r.city].filter(Boolean).join(", ") || "Address not recorded"}</span>
                  </th>
                  <td>{r.type ?? "Unknown"}</td>
                  <td className="num">{r.year_built ?? "?"}{r.pre_ada && <span className="pf-chip" title="Context only, not a finding">pre-ADA</span>}</td>
                  <td className="num">{r.surface_spaces ?? "?"}</td>
                  <td className="num">{r.required_accessible ?? "?"}{r.required_van ? <span className="pf-sub">{r.required_van} van</span> : null}</td>
                  <td className="num">{r.scans || "None"}</td>
                  <td className="num">
                    <b>{r.points}</b>
                    {r.reasons.length > 0 && <ul className="pf-reasons">{r.reasons.map((x) => <li key={x.code}>+{x.points} {x.label}</li>)}</ul>}
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm" disabled={launching !== null} onClick={() => screen(r)}>
                      {launching === r.id ? "Opening…" : "Screen"}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={COLUMNS.length + 1} className="pf-none">No buildings match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <section className="pf-how" aria-labelledby="pf-how">
        <h2 id="pf-how">How the order works</h2>
        <p>
          A measuring order, not a risk score: it says where a person with a tape measure learns the most first, and it never
          creates a finding. Points: surface spaces not recorded +3; built before 1992 +2; no 3D scan, so every door needs a
          tape measure +2; at least 9 accessible stalls to verify +2 (5 to 8: +1); year built not recorded +1; no Vexcel
          aerial +1.
        </p>
        <p>
          Stall minimums assume the recorded surface spaces form one lot. Table 208.2 applies to each parking facility
          separately, so several lots need at least as many, and garages are not counted here. Screening a building runs the
          full check with imagery and its scan. <Link href="/" className="underline underline-offset-2">Search a single property</Link>.
        </p>
      </section>
    </div>
  );
}
